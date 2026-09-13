import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { format, resolveConfig } from 'prettier';

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, '..');
const contractPath = resolve(repositoryRoot, 'packaging/npm/distribution-contract.json');
const privateReportPath = resolve(repositoryRoot, 'packaging/npm/package-contents.json');
const publicReportPath = resolve(repositoryRoot, 'packaging/npm/public-package-contents.json');
const temporaryRoot = resolve(repositoryRoot, '.tmp/npm-package-audit');
const inheritedNpmExecPath = process.env.npm_execpath;
const npmCli =
  inheritedNpmExecPath && /(?:^|[\\/])npm(?:-cli)?\.js$/iu.test(inheritedNpmExecPath)
    ? inheritedNpmExecPath
    : resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function packageManifestPath(name) {
  return resolve(repositoryRoot, 'node_modules', ...name.split('/'), 'package.json');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

function runtimeJavaScript(path) {
  return path.startsWith('dist/') && path.endsWith('.js');
}

function classify(path) {
  if (runtimeJavaScript(path)) return 'runtime_javascript';
  if (path.startsWith('schemas/')) return 'data_export';
  if (path === 'LICENSE' || path === 'THIRD_PARTY_NOTICES.md') return 'legal';
  if (path.startsWith('docs/legal/')) return 'legal_evidence';
  if (path === 'README.md') return 'package_documentation';
  if (path === 'package.json') return 'manifest';
  throw new Error(`Cannot classify packed file ${path}.`);
}

function parseMode() {
  const modes = process.argv.slice(2);
  if (
    modes.length !== 1 ||
    !['--check', '--write', '--check-public', '--write-public'].includes(modes[0])
  ) {
    throw new Error(
      'Usage: node scripts/verify-npm-package.mjs --check|--write|--check-public|--write-public',
    );
  }
  return modes[0];
}

async function verifyAssetContract(contract, packedFiles) {
  for (const asset of contract.assets) {
    const assetManifest = await readJson(packageManifestPath(asset.package));
    if (assetManifest.version !== asset.version) {
      throw new Error(
        `Distribution asset ${asset.id} expects ${asset.package}@${asset.version}, ` +
          `received ${String(assetManifest.version)}.`,
      );
    }
    const sourceHash = await sha256File(resolve(repositoryRoot, asset.sourcePath));
    if (sourceHash !== asset.sha256) {
      throw new Error(`Source hash drifted for distribution asset ${asset.id}.`);
    }
    if (asset.distributions.npm.strategy !== 'runtime_dependency') {
      throw new Error(`npm asset ${asset.id} must resolve from its runtime dependency.`);
    }
    if (asset.distributions.npm.copiedPaths.length !== 0) {
      throw new Error(`npm asset ${asset.id} unexpectedly declares copied paths.`);
    }
    for (const provider of ['githubAction', 'gitlab']) {
      const distribution = asset.distributions[provider];
      if (distribution.strategy !== 'copied_once' || distribution.copiedPaths.length !== 1) {
        throw new Error(`${provider} asset ${asset.id} must declare exactly one copied path.`);
      }
      const copiedHash = await sha256File(resolve(repositoryRoot, distribution.copiedPaths[0]));
      if (copiedHash !== asset.sha256) {
        throw new Error(`${provider} asset ${asset.id} does not match its reviewed source.`);
      }
    }
  }

  const copiedAssetNames = new Set(
    contract.assets.flatMap((asset) =>
      Object.values(asset.distributions).flatMap((distribution) =>
        distribution.copiedPaths.map((path) => normalizePath(path).split('/').at(-1)),
      ),
    ),
  );
  const duplicated = packedFiles.filter((path) => copiedAssetNames.has(path.split('/').at(-1)));
  if (duplicated.length > 0) {
    throw new Error(`npm tarball duplicates dependency-owned assets: ${duplicated.join(', ')}.`);
  }
}

async function createPack(directory, packageRoot) {
  const cache = resolve(directory, 'npm-cache');
  await mkdir(cache, { recursive: true });
  const { stdout } = await execFile(
    process.execPath,
    [
      npmCli,
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      directory,
      '--cache',
      cache,
    ],
    { cwd: packageRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('npm pack did not return exactly one package record.');
  }
  return result[0];
}

async function verifyArchive(directory, pack) {
  const bytes = await readFile(resolve(directory, pack.filename));
  const shasum = createHash('sha1').update(bytes).digest('hex');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (shasum !== pack.shasum || integrity !== pack.integrity) {
    throw new Error('npm pack archive digests do not match the generated tarball bytes.');
  }
}

async function buildReport(contract, pack, packageRoot, publicPackage) {
  const manifest = await readJson(resolve(packageRoot, 'package.json'));
  if (contract.schemaVersion !== '1.0.0') {
    throw new Error('Unknown npm distribution contract version.');
  }
  if (contract.runtimeFilePattern !== 'dist/**/*.js') {
    throw new Error('Unknown npm runtime file pattern.');
  }
  if (new Set(contract.allowedExactFiles).size !== contract.allowedExactFiles.length) {
    throw new Error('npm exact-file allowlist contains duplicates.');
  }
  if (manifest.name !== contract.packageName || manifest.version !== contract.packageVersion) {
    throw new Error('Package identity does not match the distribution contract.');
  }
  if (publicPackage) {
    if (Object.hasOwn(manifest, 'private')) {
      throw new Error('The staged public candidate must omit the private manifest property.');
    }
  } else if (manifest.private !== true) {
    throw new Error('The private source manifest publication guard must remain enabled.');
  }
  if (JSON.stringify(manifest.exports) !== JSON.stringify(contract.dataExports)) {
    throw new Error('Package exports do not match the reviewed data-only surface.');
  }
  if (manifest.main !== undefined || manifest.types !== undefined) {
    throw new Error('A JavaScript or declaration entrypoint has not been approved for alpha.');
  }

  const packedPaths = pack.files.map(({ path }) => normalizePath(path)).sort();
  const allowedExact = new Set(contract.allowedExactFiles);
  const unexpected = packedPaths.filter(
    (path) => !allowedExact.has(path) && !runtimeJavaScript(path),
  );
  if (unexpected.length > 0) {
    throw new Error(`Unexpected npm package files: ${unexpected.join(', ')}.`);
  }
  const missing = [...allowedExact].filter((path) => !packedPaths.includes(path)).sort();
  if (missing.length > 0) {
    throw new Error(`Required npm package files are missing: ${missing.join(', ')}.`);
  }
  if (packedPaths.some((path) => path.endsWith('.map') || path.endsWith('.d.ts'))) {
    throw new Error('Source maps and declarations are not part of the CLI-first alpha surface.');
  }
  for (const forbiddenPrefix of [
    'action-dist/',
    'gitlab-dist/',
    'packaging/',
    'scripts/',
    'src/',
    'templates/',
    'test/',
  ]) {
    if (packedPaths.some((path) => path.startsWith(forbiddenPrefix))) {
      throw new Error(`npm package includes forbidden provider or source path ${forbiddenPrefix}.`);
    }
  }
  for (const target of Object.values(contract.dataExports)) {
    if (!packedPaths.includes(normalizePath(target))) {
      throw new Error(`Export target ${target} is missing from the npm package.`);
    }
  }
  if (pack.entryCount !== packedPaths.length) {
    throw new Error('npm pack entry count disagrees with its file inventory.');
  }
  if (pack.entryCount > contract.budgets.maximumFileCount) {
    throw new Error(`npm package exceeds the ${contract.budgets.maximumFileCount} file budget.`);
  }
  if (pack.size > contract.budgets.maximumPackedBytes) {
    throw new Error(
      `npm package exceeds the ${contract.budgets.maximumPackedBytes} byte packed budget.`,
    );
  }
  if (pack.unpackedSize > contract.budgets.maximumUnpackedBytes) {
    throw new Error(
      `npm package exceeds the ${contract.budgets.maximumUnpackedBytes} byte unpacked budget.`,
    );
  }

  await verifyAssetContract(contract, packedPaths);

  const files = [];
  for (const path of packedPaths) {
    const record = pack.files.find((entry) => normalizePath(entry.path) === path);
    const bytes = await readFile(resolve(packageRoot, path));
    if (record.size !== bytes.byteLength) {
      throw new Error(`Packed metadata size drifted from source file ${path}.`);
    }
    files.push({ path, size: record.size, sha256: sha256(bytes), role: classify(path) });
  }

  return {
    schemaVersion: '1.0.0',
    package: { name: manifest.name, version: manifest.version, surface: contract.surface },
    archive: {
      filename: pack.filename,
      fileCount: pack.entryCount,
      packedBytes: pack.size,
      unpackedBytes: pack.unpackedSize,
      shasum: pack.shasum,
      integrity: pack.integrity,
    },
    budgets: contract.budgets,
    dataExports: contract.dataExports,
    assets: contract.assets.map((asset) => ({
      id: asset.id,
      npmStrategy: asset.distributions.npm.strategy,
      githubActionCopies: asset.distributions.githubAction.copiedPaths,
      gitlabCopies: asset.distributions.gitlab.copiedPaths,
      sha256: asset.sha256,
    })),
    files,
  };
}

async function preparePublicPackageRoot(directory, contract) {
  const packageRoot = resolve(directory, 'public-package');
  await mkdir(packageRoot, { recursive: true });
  const manifest = await readJson(resolve(repositoryRoot, 'package.json'));
  if (manifest.private !== true) {
    throw new Error('Explicit public-package verification must start from guarded private source.');
  }
  delete manifest.private;
  await writeFile(resolve(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const path of contract.allowedExactFiles) {
    if (path === 'package.json') continue;
    const destination = resolve(packageRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(repositoryRoot, path), destination);
  }
  await cp(resolve(repositoryRoot, 'dist'), resolve(packageRoot, 'dist'), {
    recursive: true,
    force: false,
  });
  return packageRoot;
}

async function main() {
  const mode = parseMode();
  await mkdir(temporaryRoot, { recursive: true });
  const resolvedTemporaryRoot = await realpath(temporaryRoot);
  const temporaryDirectory = await mkdtemp(resolve(resolvedTemporaryRoot, 'pack-'));
  const relativeTemporaryDirectory = relative(resolvedTemporaryRoot, temporaryDirectory);
  if (relativeTemporaryDirectory.startsWith('..') || relativeTemporaryDirectory === '') {
    throw new Error('Refusing to use an unverified npm pack temporary directory.');
  }

  try {
    const contract = await readJson(contractPath);
    const sourceManifest = await readJson(resolve(repositoryRoot, 'package.json'));
    const explicitPublic = mode === '--check-public' || mode === '--write-public';
    const stagedPublic = !Object.hasOwn(sourceManifest, 'private');
    const publicPackage = explicitPublic || stagedPublic;
    const packageRoot = explicitPublic
      ? await preparePublicPackageRoot(temporaryDirectory, contract)
      : repositoryRoot;
    const reportPath = publicPackage ? publicReportPath : privateReportPath;
    const writeMode = mode === '--write' || mode === '--write-public';
    const pack = await createPack(temporaryDirectory, packageRoot);
    await access(resolve(temporaryDirectory, pack.filename));
    await verifyArchive(temporaryDirectory, pack);
    const report = await buildReport(contract, pack, packageRoot, publicPackage);
    const prettierConfig = (await resolveConfig(reportPath)) ?? {};
    const serialized = await format(JSON.stringify(report), {
      ...prettierConfig,
      filepath: reportPath,
    });
    if (writeMode) {
      await writeFile(reportPath, serialized, 'utf8');
      process.stdout.write(`Wrote ${normalizePath(relative(repositoryRoot, reportPath))}.\n`);
    } else {
      const retained = await readFile(reportPath, 'utf8');
      if (retained !== serialized) {
        throw new Error(
          publicPackage
            ? 'Checked-in public npm package contents are stale; run npm run pack:public-contents:write.'
            : 'Checked-in npm package contents are stale; run npm run pack:contents:write.',
        );
      }
      process.stdout.write(
        `npm package verified: ${report.archive.fileCount} files, ` +
          `${report.archive.packedBytes} packed bytes, ${report.archive.unpackedBytes} unpacked bytes.\n`,
      );
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();
