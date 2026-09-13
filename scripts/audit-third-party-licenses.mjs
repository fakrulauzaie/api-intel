import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';

const repositoryRoot = resolve(import.meta.dirname, '..');
const reportPath = resolve(repositoryRoot, 'docs/legal/dependency-license-inventory.json');
const allowedLicenses = new Set([
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'ISC',
  'MIT',
  'Python-2.0',
]);
const licenseFilePattern = /^(?:copying|licen[cs]e|notice)(?:[._-].*)?$/iu;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

function packagePathParts(name) {
  return name.split('/');
}

async function resolvePackageManifest(name, fromDirectory) {
  let cursor = fromDirectory;
  while (true) {
    const candidate = join(cursor, 'node_modules', ...packagePathParts(name), 'package.json');
    try {
      return await realpath(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`Cannot resolve installed package ${name} from ${fromDirectory}.`);
}

async function dependencyClosure(rootNames) {
  const pending = [];
  for (const name of rootNames) {
    pending.push(await resolvePackageManifest(name, repositoryRoot));
  }

  const manifests = new Map();
  while (pending.length > 0) {
    const manifestPath = pending.pop();
    if (manifests.has(manifestPath)) continue;
    const manifest = await readJson(manifestPath);
    manifests.set(manifestPath, manifest);

    const required = Object.keys(manifest.dependencies ?? {});
    const optional = Object.keys(manifest.optionalDependencies ?? {});
    for (const name of [...new Set([...required, ...optional])].sort()) {
      try {
        pending.push(await resolvePackageManifest(name, dirname(manifestPath)));
      } catch (error) {
        if (optional.includes(name)) continue;
        throw error;
      }
    }
  }
  return manifests;
}

function declaredLicense(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter(Boolean)
      .join(' OR ');
  }
  return '<missing>';
}

function repositoryUrl(manifest) {
  if (typeof manifest.repository === 'string') return manifest.repository;
  if (typeof manifest.repository?.url === 'string') return manifest.repository.url;
  return null;
}

async function licenseFiles(packageDirectory) {
  const entries = await readdir(packageDirectory, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !licenseFilePattern.test(entry.name)) continue;
    records.push({
      name: entry.name,
      sha256: await sha256File(join(packageDirectory, entry.name)),
    });
  }
  return records.sort(({ name: left }, { name: right }) => left.localeCompare(right));
}

async function assetRecord(packageName, sourcePath, destinations) {
  const manifest = await readJson(await resolvePackageManifest(packageName, repositoryRoot));
  return {
    package: packageName,
    version: manifest.version,
    declaredLicense: declaredLicense(manifest),
    sourcePath,
    destinations,
    sha256: await sha256File(resolve(repositoryRoot, sourcePath)),
  };
}

async function buildReport() {
  const project = await readJson(resolve(repositoryRoot, 'package.json'));
  if (project.license !== 'Apache-2.0') {
    throw new Error(`Expected project license Apache-2.0, received ${String(project.license)}.`);
  }

  const productionNames = Object.keys(project.dependencies ?? {}).sort();
  const developmentNames = Object.keys(project.devDependencies ?? {}).sort();
  const productionDirectPaths = new Set(
    await Promise.all(productionNames.map((name) => resolvePackageManifest(name, repositoryRoot))),
  );
  const developmentDirectPaths = new Set(
    await Promise.all(developmentNames.map((name) => resolvePackageManifest(name, repositoryRoot))),
  );
  const production = await dependencyClosure(productionNames);
  const complete = await dependencyClosure([...productionNames, ...developmentNames].sort());
  const packages = [];
  for (const [manifestPath, manifest] of complete) {
    const license = declaredLicense(manifest);
    if (!allowedLicenses.has(license)) {
      throw new Error(
        `License review required for ${manifest.name}@${manifest.version}: ${license}.`,
      );
    }
    packages.push({
      name: manifest.name,
      version: manifest.version,
      scope: production.has(manifestPath) ? 'production' : 'development',
      direct: productionDirectPaths.has(manifestPath) || developmentDirectPaths.has(manifestPath),
      declaredLicense: license,
      repository: repositoryUrl(manifest),
      licenseFiles: await licenseFiles(dirname(manifestPath)),
    });
  }
  packages.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  );

  const byLicense = {};
  const byScope = { production: 0, development: 0 };
  for (const entry of packages) {
    byLicense[entry.declaredLicense] = (byLicense[entry.declaredLicense] ?? 0) + 1;
    byScope[entry.scope] += 1;
  }

  return {
    schemaVersion: '1.0.0',
    project: {
      name: project.name,
      version: project.version,
      license: project.license,
      licenseFile: {
        path: 'LICENSE',
        sha256: await sha256File(resolve(repositoryRoot, 'LICENSE')),
      },
    },
    input: {
      packageManager: 'pnpm',
      lockfile: 'pnpm-lock.yaml',
      lockfileSha256: await sha256File(resolve(repositoryRoot, 'pnpm-lock.yaml')),
      environment: {
        platform: process.platform,
        architecture: process.arch,
      },
    },
    policy: {
      allowedDeclaredLicenses: [...allowedLicenses].sort(),
      unresolvedLicenseCount: 0,
      note: 'Declared SPDX values and packaged license texts are evidence inputs, not legal advice.',
    },
    summary: {
      packages: packages.length,
      byScope,
      byDeclaredLicense: Object.fromEntries(
        Object.entries(byLicense).sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
    redistributedAssets: [
      await assetRecord('cytoscape', 'node_modules/cytoscape/dist/cytoscape.min.js', [
        'action-dist/cytoscape.min.js',
        'gitlab-dist/cytoscape.min.js',
      ]),
      await assetRecord('libpg-query', 'node_modules/libpg-query/wasm/libpg-query.wasm', [
        'action-dist/libpg-query.wasm',
        'gitlab-dist/libpg-query.wasm',
      ]),
    ],
    packages,
  };
}

const report = await buildReport();
const prettierConfig = (await resolveConfig(reportPath)) ?? {};
const serialized = await format(`${JSON.stringify(report, null, 2)}\n`, {
  ...prettierConfig,
  parser: 'json',
});
const mode = process.argv[2] ?? '--check';
if (mode === '--write') {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, serialized, 'utf8');
  process.stdout.write(`Wrote ${relative(repositoryRoot, reportPath)}.\n`);
} else if (mode === '--check') {
  const existing = await readFile(reportPath, 'utf8');
  const recorded = JSON.parse(existing);
  const sameEnvironment =
    recorded.input?.environment?.platform === report.input.environment.platform &&
    recorded.input?.environment?.architecture === report.input.environment.architecture;
  const sharedEvidenceMatches =
    recorded.project?.license === report.project.license &&
    recorded.project?.licenseFile?.sha256 === report.project.licenseFile.sha256 &&
    recorded.input?.lockfileSha256 === report.input.lockfileSha256 &&
    JSON.stringify(recorded.redistributedAssets) === JSON.stringify(report.redistributedAssets);
  if (!sharedEvidenceMatches || (sameEnvironment && existing !== serialized)) {
    throw new Error(
      'Dependency license inventory is stale. Run `pnpm run audit:licenses:write` and review the diff.',
    );
  }
  process.stdout.write(
    sameEnvironment
      ? 'Dependency license inventory is current and contains no unresolved licenses.\n'
      : `Current ${report.input.environment.platform}-${report.input.environment.architecture} dependency graph contains no unresolved licenses; the checked inventory records ${recorded.input.environment.platform}-${recorded.input.environment.architecture}.\n`,
  );
} else {
  throw new Error(`Unknown mode ${mode}; expected --check or --write.`);
}
