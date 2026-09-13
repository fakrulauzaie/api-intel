import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const contractPath = resolve(repositoryRoot, 'packaging/release/provider-artifact-contract.json');
const manifestPath = resolve(repositoryRoot, 'packaging/release/reproducible-artifacts.json');
const temporaryParent = resolve(repositoryRoot, '.tmp');

function parseMode() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 1 || !['--check', '--write'].includes(arguments_[0])) {
    throw new Error('Usage: node scripts/verify-provider-artifacts.mjs --check|--write');
  }
  return arguments_[0];
}

function normalize(path) {
  return path.replaceAll('\\', '/');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalStringify(value) {
  return `${JSON.stringify(
    value,
    (_key, entry) => {
      if (entry === null || Array.isArray(entry) || typeof entry !== 'object') return entry;
      return Object.fromEntries(
        Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)),
      );
    },
    2,
  )}\n`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function filesIn(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
      ({ name: left }, { name: right }) => left.localeCompare(right),
    )) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Provider distribution contains a non-regular entry: ${path}`);
    }
  }
  await visit(root);
  return files;
}

async function fileRecords(root) {
  return Promise.all(
    (await filesIn(root)).map(async (path) => {
      const bytes = await readFile(path);
      return {
        path: normalize(relative(root, path)),
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      };
    }),
  );
}

function distributionFingerprint(records) {
  const projection = records.map(({ path, sha256: digest }) => ({
    path,
    contentHash: `sha256:${digest}`,
  }));
  return `sha256:${sha256(canonicalStringify(projection))}`;
}

async function run(executable, arguments_, cwd = repositoryRoot) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, arguments_, {
      cwd,
      env: process.env,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${basename(executable)} failed (${signal ?? code ?? 'unknown'}).`));
    });
  });
}

function sameRecords(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertProviderShape(name, provider, records) {
  const paths = records.map(({ path }) => path);
  const missing = provider.requiredFiles.filter((path) => !paths.includes(path));
  if (missing.length > 0) throw new Error(`${name} distribution misses: ${missing.join(', ')}.`);
  const chunks = paths.filter((path) => new RegExp(provider.chunkPattern, 'u').test(path));
  if (chunks.length === 0) throw new Error(`${name} distribution contains no ncc chunks.`);
  const unexpectedMaps = paths.filter((path) => path.endsWith('.map'));
  if (unexpectedMaps.length > 0) {
    throw new Error(`${name} distribution unexpectedly contains source maps.`);
  }
}

async function assertAssets(distributionContract) {
  for (const asset of distributionContract.assets) {
    const source = await readFile(resolve(repositoryRoot, asset.sourcePath));
    if (sha256(source) !== asset.sha256) {
      throw new Error(`Reviewed source hash drifted for ${asset.id}.`);
    }
    for (const provider of ['githubAction', 'gitlab']) {
      const copiedPaths = asset.distributions[provider].copiedPaths;
      if (asset.distributions[provider].strategy !== 'copied_once' || copiedPaths.length !== 1) {
        throw new Error(`${asset.id} must be copied exactly once into ${provider}.`);
      }
      const copied = await readFile(resolve(repositoryRoot, copiedPaths[0]));
      if (!source.equals(copied))
        throw new Error(`${copiedPaths[0]} differs from ${asset.sourcePath}.`);
    }
  }
}

async function assertProviderMetadata(contract) {
  const [action, dockerfile, component] = await Promise.all([
    readFile(resolve(repositoryRoot, 'action.yml'), 'utf8'),
    readFile(resolve(repositoryRoot, contract.container.dockerfile), 'utf8'),
    readFile(resolve(repositoryRoot, 'templates/api-intel/template.yml'), 'utf8'),
  ]);
  if (!action.includes('using: composite') || !action.includes('action-dist/index.js')) {
    throw new Error('GitHub action metadata does not invoke the checked distribution.');
  }
  if (!action.includes('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a')) {
    throw new Error('GitHub artifact upload action is not pinned to the reviewed commit.');
  }
  if (action.includes('pull-requests: write') || action.includes('GITHUB_TOKEN')) {
    throw new Error('GitHub action metadata exceeds its read-only provider boundary.');
  }
  if (!component.includes('regex: ^.+@sha256:[a-f0-9]{64}$')) {
    throw new Error('GitLab component no longer requires a digest-pinned OCI image.');
  }
  if (!component.includes(`default: ${contract.container.bundledEntrypoint}`)) {
    throw new Error('GitLab component entrypoint drifted from the container contract.');
  }
  if (!dockerfile.includes('ARG NODE_IMAGE') || !dockerfile.includes('COPY gitlab-dist/')) {
    throw new Error(
      'GitLab Dockerfile no longer declares its base or complete distribution input.',
    );
  }
  if (!dockerfile.includes(`USER ${contract.container.runtimeUser}`)) {
    throw new Error(
      `GitLab image must default to unprivileged UID/GID ${contract.container.runtimeUser}.`,
    );
  }
}

async function buildManifest(contract, distributionContract, packageContents) {
  const manifest = await readJson(resolve(repositoryRoot, 'package.json'));
  const inputs = await Promise.all(
    contract.metadataInputs.map(async (path) => {
      const bytes = await readFile(resolve(repositoryRoot, path));
      return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
    }),
  );
  const providers = {};
  for (const [name, provider] of Object.entries(contract.providers)) {
    const records = await fileRecords(resolve(repositoryRoot, provider.directory));
    assertProviderShape(name, provider, records);
    providers[name] = {
      directory: provider.directory,
      fileCount: records.length,
      fingerprint: distributionFingerprint(records),
      files: records,
    };
  }
  return {
    schemaVersion: '1.0.0',
    contractSha256: sha256(await readFile(contractPath)),
    toolchain: {
      node: manifest.engines.node,
      packageManager: manifest.packageManager,
      ncc: manifest.devDependencies['@vercel/ncc'],
      typescript: manifest.dependencies.typescript,
    },
    providers,
    reviewedAssets: distributionContract.assets.map(({ id, sourcePath, sha256: digest }) => ({
      id,
      sourcePath,
      sha256: digest,
    })),
    metadataInputs: inputs,
    npmPackageManifest: {
      path: 'packaging/npm/package-contents.json',
      name: packageContents.package.name,
      version: packageContents.package.version,
      fileCount: packageContents.archive.fileCount,
      packedBytes: packageContents.archive.packedBytes,
      unpackedBytes: packageContents.archive.unpackedBytes,
      shasum: packageContents.archive.shasum,
      integrity: packageContents.archive.integrity,
    },
    container: contract.container,
    browser: contract.browser,
  };
}

async function rebuildAndCompare(contract, temporaryRoot) {
  for (const [name, provider] of Object.entries(contract.providers)) {
    const rebuiltRelative = normalize(relative(repositoryRoot, resolve(temporaryRoot, name)));
    await run(process.execPath, [
      resolve(repositoryRoot, provider.buildScript),
      '--output',
      rebuiltRelative,
    ]);
    const [retained, rebuilt] = await Promise.all([
      fileRecords(resolve(repositoryRoot, provider.directory)),
      fileRecords(resolve(temporaryRoot, name)),
    ]);
    if (!sameRecords(retained, rebuilt)) {
      const retainedByPath = new Map(retained.map((record) => [record.path, record]));
      const rebuiltByPath = new Map(rebuilt.map((record) => [record.path, record]));
      const drift = [...new Set([...retainedByPath.keys(), ...rebuiltByPath.keys()])]
        .filter(
          (path) =>
            JSON.stringify(retainedByPath.get(path)) !== JSON.stringify(rebuiltByPath.get(path)),
        )
        .sort();
      throw new Error(`${name} checked distribution is stale: ${drift.join(', ')}.`);
    }
  }
}

async function main() {
  const mode = parseMode();
  const [contract, distributionContract, packageContents] = await Promise.all([
    readJson(contractPath),
    readJson(resolve(repositoryRoot, 'packaging/npm/distribution-contract.json')),
    readJson(resolve(repositoryRoot, 'packaging/npm/package-contents.json')),
  ]);
  if (contract.schemaVersion !== '1.0.0') throw new Error('Unknown provider artifact contract.');
  await assertAssets(distributionContract);
  await assertProviderMetadata(contract);

  await mkdir(temporaryParent, { recursive: true });
  const temporaryRoot = await mkdtemp(resolve(temporaryParent, 'provider-build-'));
  try {
    await rebuildAndCompare(contract, temporaryRoot);
    const generated = `${JSON.stringify(await buildManifest(contract, distributionContract, packageContents), null, 2)}\n`;
    if (mode === '--write') {
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, generated, 'utf8');
      process.stdout.write('Wrote packaging/release/reproducible-artifacts.json.\n');
    } else {
      const retained = await readFile(manifestPath, 'utf8');
      if (retained !== generated) {
        throw new Error(
          'Provider artifact manifest is stale; run npm run artifacts:write and review it.',
        );
      }
      process.stdout.write('Provider distributions and canonical artifact manifest verified.\n');
    }
  } finally {
    const canonicalTemporary = await realpath(temporaryRoot).catch(() => null);
    const canonicalParent = await realpath(temporaryParent);
    if (canonicalTemporary !== null) {
      const path = relative(canonicalParent, canonicalTemporary);
      if (
        path !== '' &&
        !path.startsWith('..') &&
        basename(canonicalTemporary).startsWith('provider-build-')
      ) {
        await rm(canonicalTemporary, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  }
}

await main();
