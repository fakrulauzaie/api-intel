import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');

function isContained(parent, child) {
  const value = relative(parent, child);
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`));
}

function outputDirectoryFromArguments(defaultName, arguments_) {
  if (arguments_.length === 0) return resolve(repositoryRoot, defaultName);
  if (arguments_.length !== 2 || arguments_[0] !== '--output') {
    throw new Error(`Usage: --output <repository-relative temporary output directory>`);
  }
  const output = resolve(repositoryRoot, arguments_[1]);
  const temporaryBuildRoot = resolve(repositoryRoot, '.tmp');
  if (!isContained(temporaryBuildRoot, output) || output === temporaryBuildRoot) {
    throw new Error('Alternate provider output must remain below the repository .tmp directory.');
  }
  return output;
}

async function copyNonEmpty(source, destination, label) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const copied = await stat(destination);
  if (copied.size === 0) throw new Error(`The bundled ${label} file is empty.`);
  return copied.size;
}

export async function buildProviderDistribution({ arguments_, defaultName, entrypoint, label }) {
  const outputDirectory = outputDirectoryFromArguments(defaultName, arguments_);
  if (!isContained(repositoryRoot, outputDirectory) || outputDirectory === repositoryRoot) {
    throw new Error(`Refusing to clean a ${label} output outside the repository.`);
  }
  await rm(outputDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

  const ncc = resolve(repositoryRoot, 'node_modules/@vercel/ncc/dist/ncc/cli.js');
  const result = spawnSync(
    process.execPath,
    [
      ncc,
      'build',
      entrypoint,
      '-o',
      outputDirectory,
      '--minify',
      '--license',
      'THIRD_PARTY_LICENSES.txt',
    ],
    {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  await mkdir(outputDirectory, { recursive: true });
  const wasmSize = await copyNonEmpty(
    resolve(repositoryRoot, 'node_modules/libpg-query/wasm/libpg-query.wasm'),
    resolve(outputDirectory, 'libpg-query.wasm'),
    'libpg-query WASM asset',
  );
  process.stdout.write(`Copied ${wasmSize} byte libpg-query.wasm ${label} asset.\n`);

  const cytoscapeSize = await copyNonEmpty(
    resolve(repositoryRoot, 'node_modules/cytoscape/dist/cytoscape.min.js'),
    resolve(outputDirectory, 'cytoscape.min.js'),
    'Cytoscape browser asset',
  );
  process.stdout.write(`Copied ${cytoscapeSize} byte cytoscape.min.js ${label} asset.\n`);

  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    await copyNonEmpty(resolve(repositoryRoot, name), resolve(outputDirectory, name), name);
  }
  await copyNonEmpty(
    resolve(repositoryRoot, 'docs/legal/dependency-license-inventory.json'),
    resolve(outputDirectory, 'dependency-license-inventory.json'),
    'dependency license inventory',
  );
  const aggregate = await stat(resolve(outputDirectory, 'THIRD_PARTY_LICENSES.txt'));
  if (aggregate.size === 0)
    throw new Error('The generated third-party license aggregate is empty.');
  for (const [source, destination] of [
    ['node_modules/cytoscape/LICENSE', 'licenses/cytoscape-3.34.0-MIT.txt'],
    ['node_modules/libpg-query/LICENSE', 'licenses/libpg-query-18.1.2-MIT.txt'],
  ]) {
    await copyNonEmpty(
      resolve(repositoryRoot, source),
      resolve(outputDirectory, destination),
      destination,
    );
  }
  process.stdout.write(`Copied ${label} project license, notices, and dependency licenses.\n`);
}
