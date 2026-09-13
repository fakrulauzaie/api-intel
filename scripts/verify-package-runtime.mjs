import { access, readFile, readdir, realpath } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(repositoryRoot, 'src');
const distributionRoot = resolve(repositoryRoot, 'dist');
const packagePath = resolve(repositoryRoot, 'package.json');
const contractPath = resolve(repositoryRoot, 'packaging/npm/runtime-contract.json');
const installLifecycleScripts = ['preinstall', 'install', 'postinstall'];
const builtinSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => (name.startsWith('node:') ? name : `node:${name}`)),
]);

function normalizePath(path) {
  return path.replaceAll('\\', '/');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function listFiles(root) {
  const result = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort(({ name: left }, { name: right }) =>
      left.localeCompare(right),
    )) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(normalizePath(relative(root, path)));
    }
  }
  await visit(root);
  return result;
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function importedSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return specifiers;
}

function expectedDistributionFiles(sourceFiles) {
  const expected = new Set();
  for (const source of sourceFiles) {
    if (!source.endsWith('.ts') || source.endsWith('.d.ts')) continue;
    const stem = source.slice(0, -3);
    for (const suffix of ['.js', '.js.map', '.d.ts', '.d.ts.map']) {
      expected.add(`${stem}${suffix}`);
    }
  }
  return expected;
}

function assertEqualSets(actual, expected, label) {
  const missing = [...expected].filter((value) => !actual.has(value)).sort();
  const unexpected = [...actual].filter((value) => !expected.has(value)).sort();
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} mismatch. Missing: ${missing.join(', ') || '<none>'}. ` +
        `Unexpected: ${unexpected.join(', ') || '<none>'}.`,
    );
  }
}

function packagePathParts(name) {
  return name.split('/');
}

async function resolvePackageManifest(name, fromDirectory) {
  let cursor = fromDirectory;
  while (true) {
    const candidate = resolve(cursor, 'node_modules', ...packagePathParts(name), 'package.json');
    try {
      return await realpath(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`Cannot resolve installed runtime package ${name}.`);
}

async function verifyDependencyLifecycle(rootNames) {
  const pending = await Promise.all(
    rootNames.map((name) => resolvePackageManifest(name, repositoryRoot)),
  );
  const visited = new Set();
  while (pending.length > 0) {
    const manifestPath = pending.pop();
    if (manifestPath === undefined || visited.has(manifestPath)) continue;
    visited.add(manifestPath);
    const manifest = await readJson(manifestPath);
    const installHooks = installLifecycleScripts.filter(
      (name) => typeof manifest.scripts?.[name] === 'string',
    );
    if (installHooks.length > 0) {
      throw new Error(
        `Runtime package ${manifest.name}@${manifest.version} declares consumer install ` +
          `scripts: ${installHooks.join(', ')}.`,
      );
    }
    const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}));
    const children = [
      ...new Set([...Object.keys(manifest.dependencies ?? {}), ...optional]),
    ].sort();
    for (const name of children) {
      try {
        pending.push(await resolvePackageManifest(name, dirname(manifestPath)));
      } catch (error) {
        if (!optional.has(name)) throw error;
      }
    }
  }
  return visited.size;
}

async function verifyEmittedImports(declaredDependencies, distributionFiles) {
  const importedPackages = new Set();
  for (const path of distributionFiles.filter((candidate) => candidate.endsWith('.js'))) {
    const absolutePath = resolve(distributionRoot, path);
    const source = await readFile(absolutePath, 'utf8');
    for (const specifier of importedSpecifiers(source)) {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(absolutePath), specifier);
        const targetRelative = normalizePath(relative(distributionRoot, target));
        if (targetRelative.startsWith('../') || targetRelative === '..') {
          throw new Error(`Emitted import escapes dist: ${path} -> ${specifier}.`);
        }
        await access(target);
      } else if (!builtinSpecifiers.has(specifier)) {
        importedPackages.add(packageNameFromSpecifier(specifier));
      }
    }
  }
  const undeclared = [...importedPackages].filter((name) => !declaredDependencies.has(name)).sort();
  if (undeclared.length > 0) {
    throw new Error(`Emitted runtime imports are undeclared: ${undeclared.join(', ')}.`);
  }
  return importedPackages;
}

export async function verifyPackageRuntime() {
  const [manifest, contract, sourceFiles, distributionFiles] = await Promise.all([
    readJson(packagePath),
    readJson(contractPath),
    listFiles(sourceRoot),
    listFiles(distributionRoot),
  ]);

  if (contract.schemaVersion !== '1.1.0') throw new Error('Unknown npm runtime contract version.');
  if (manifest.name !== contract.packageName)
    throw new Error('Package name violates the contract.');
  const stagedPublicCandidate =
    process.env.API_INTEL_PUBLIC_CANDIDATE === '1' || !Object.hasOwn(manifest, 'private');
  if (stagedPublicCandidate) {
    if (Object.hasOwn(manifest, 'private')) {
      throw new Error('The staged public candidate must omit the private manifest property.');
    }
  } else if (manifest.private !== contract.sourceManifestMustRemainPrivate) {
    throw new Error('The private source package manifest guard drifted.');
  }
  if (manifest.license !== 'Apache-2.0') throw new Error('Package license must be Apache-2.0.');
  if (manifest.description !== contract.publicMetadata.description) {
    throw new Error('Package description violates the selected public identity.');
  }
  if (manifest.author !== contract.publicMetadata.author)
    throw new Error('Package author drifted.');
  assertEqualSets(
    new Set(manifest.maintainers ?? []),
    new Set(contract.publicMetadata.maintainers),
    'Maintainers',
  );
  assertEqualSets(
    new Set(manifest.keywords ?? []),
    new Set(contract.publicMetadata.keywords),
    'Keywords',
  );
  if (JSON.stringify(manifest.bin) !== JSON.stringify(contract.bins)) {
    throw new Error('Package bins violate the reviewed contract.');
  }
  if (JSON.stringify(manifest.exports) !== JSON.stringify(contract.exports)) {
    throw new Error('Package exports violate the reviewed data-only contract.');
  }
  for (const name of installLifecycleScripts) {
    if (manifest.scripts?.[name] !== undefined) {
      throw new Error(`Consumer install lifecycle script ${name} is prohibited.`);
    }
  }
  if (manifest.scripts?.prepack !== 'npm run build && npm run pack:verify') {
    throw new Error('prepack must rebuild and then verify the package runtime.');
  }
  if (manifest.scripts?.['pack:verify'] !== 'node scripts/verify-package-runtime.mjs') {
    throw new Error('pack:verify must use the reviewed runtime verifier.');
  }
  if ((manifest.files ?? []).includes('dist/**/*.js') !== true) {
    throw new Error(
      'The package file list must contain only emitted runtime JavaScript from dist.',
    );
  }
  for (const field of contract.destinationMetadata.fields) {
    if (manifest[field] !== undefined) {
      throw new Error(`${field} must remain absent until the sanitized public repository exists.`);
    }
  }
  if (contract.destinationMetadata.fundingStatus !== 'not_applicable') {
    throw new Error('Funding metadata has not been approved.');
  }
  for (const field of ['main', 'types']) {
    if (manifest[field] !== undefined) {
      throw new Error(`${field} is outside the approved CLI-first alpha surface.`);
    }
  }

  const runtimeEntries = contract.runtimeDependencies;
  const declaredDependencies = new Set(Object.keys(manifest.dependencies ?? {}));
  const contractedDependencies = new Set(runtimeEntries.map(({ name }) => name));
  assertEqualSets(declaredDependencies, contractedDependencies, 'Runtime dependencies');
  if (manifest.devDependencies?.typescript !== undefined) {
    throw new Error('TypeScript must not remain classified as a development-only dependency.');
  }

  const require = createRequire(import.meta.url);
  for (const entry of runtimeEntries) {
    if (manifest.dependencies[entry.name] !== entry.version) {
      throw new Error(`Runtime dependency ${entry.name} is not pinned to ${entry.version}.`);
    }
    require.resolve(entry.probe);
    const installed = await readJson(await resolvePackageManifest(entry.name, repositoryRoot));
    if (installed.version !== entry.version) {
      throw new Error(
        `Installed ${entry.name}@${installed.version} does not match ${entry.version}.`,
      );
    }
  }

  const expectedFiles = expectedDistributionFiles(sourceFiles);
  assertEqualSets(new Set(distributionFiles), expectedFiles, 'Compiled dist file set');
  const importedPackages = await verifyEmittedImports(declaredDependencies, distributionFiles);
  const dependencyPackages = await verifyDependencyLifecycle([...declaredDependencies].sort());

  const packageVersionSource = await readFile(resolve(distributionRoot, 'version.js'), 'utf8');
  if (!packageVersionSource.includes(`TOOL_VERSION = '${manifest.version}'`)) {
    throw new Error('Built tool version does not match package.json.');
  }
  for (const path of Object.values(contract.bins)) {
    const entry = await readFile(resolve(repositoryRoot, path), 'utf8');
    if (!entry.startsWith('#!/usr/bin/env node\n')) {
      throw new Error(`Executable ${path} is missing its portable Node shebang.`);
    }
  }

  return {
    emittedFiles: distributionFiles.length,
    emittedRuntimeImports: importedPackages.size,
    runtimePackages: dependencyPackages,
  };
}

function isDirectExecution() {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectExecution()) {
  const result = await verifyPackageRuntime();
  process.stderr.write(
    `Package runtime verified: ${result.emittedFiles} emitted files, ` +
      `${result.emittedRuntimeImports} imported packages, ` +
      `${result.runtimePackages} production dependency packages; consumer install hooks: 0.\n`,
  );
}
