import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const contractPath = resolve(repositoryRoot, 'packaging/ci/neutral-ci-contract.json');
const maximumOutputBytes = 2 * 1_024 * 1_024;
const processTimeoutMilliseconds = 2 * 60_000;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function contained(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function runCli(arguments_) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(
      process.execPath,
      [resolve(repositoryRoot, 'dist/cli/index.js'), ...arguments_],
      {
        cwd: repositoryRoot,
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const collect = (destination, chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maximumOutputBytes) {
        child.kill();
        finish(() => rejectProcess(new Error('Compatibility scan exceeded its output limit.')));
        return;
      }
      destination.push(chunk);
    };
    child.stdout.on('data', (chunk) => collect(stdout, chunk));
    child.stderr.on('data', (chunk) => collect(stderr, chunk));
    child.once('error', (error) => finish(() => rejectProcess(error)));
    child.once('close', (exitCode) =>
      finish(() =>
        resolveProcess({
          exitCode: exitCode ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        }),
      ),
    );
    const timer = setTimeout(() => {
      child.kill();
      finish(() => rejectProcess(new Error('Compatibility scan exceeded its two-minute timeout.')));
    }, processTimeoutMilliseconds);
  });
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

async function verifyPackageVersions(contract, fixtureRoot) {
  const lockfile = await readJson(resolve(repositoryRoot, contract.compatibilityCorpus.lockfile));
  for (const [name, expectedVersion] of Object.entries(contract.compatibilityCorpus.packages)) {
    const lockedVersion = lockfile.packages?.[`node_modules/${name}`]?.version;
    if (lockedVersion !== expectedVersion) {
      throw new Error(
        `Compatibility lockfile expected ${name}@${expectedVersion}, received ${String(lockedVersion)}.`,
      );
    }
    const installed = await readJson(resolve(fixtureRoot, 'node_modules', name, 'package.json'));
    if (installed.version !== expectedVersion) {
      throw new Error(
        `Compatibility fixture expected installed ${name}@${expectedVersion}, received ${String(installed.version)}. Run the frozen fixture install first.`,
      );
    }
  }
}

function verifyAnalysis(analysis, expected) {
  const summary = {
    schemaVersion: analysis.schemaVersion,
    resultState: analysis.resultState,
    endpoints: analysis.endpoints.length,
    classes: analysis.classes.length,
    methods: analysis.methods.length,
    tables: analysis.tables.length,
    assertions: analysis.assertions.length,
  };
  for (const [name, expectedValue] of Object.entries(expected)) {
    if (name === 'routes' || name === 'diagnostics') continue;
    if (summary[name] !== expectedValue) {
      throw new Error(
        `Compatibility analysis ${name} expected ${String(expectedValue)}, received ${String(summary[name])}.`,
      );
    }
  }
  const routes = sorted(analysis.endpoints.map(({ httpMethod, path }) => `${httpMethod} ${path}`));
  const diagnostics = sorted(analysis.diagnostics.map(({ code }) => code));
  if (JSON.stringify(routes) !== JSON.stringify(expected.routes)) {
    throw new Error('Compatibility endpoint contract drifted.');
  }
  if (JSON.stringify(diagnostics) !== JSON.stringify(sorted(expected.diagnostics))) {
    throw new Error('Compatibility diagnostic honesty contract drifted.');
  }
}

const contract = await readJson(contractPath);
const fixtureRoot = resolve(repositoryRoot, contract.compatibilityCorpus.root);
await verifyPackageVersions(contract, fixtureRoot);

const operatingSystemTemporaryRoot = await realpath(tmpdir());
const temporaryRoot = await mkdtemp(join(operatingSystemTemporaryRoot, 'api-intel-o3-1-'));
if (
  !contained(operatingSystemTemporaryRoot, temporaryRoot) ||
  !basename(temporaryRoot).startsWith('api-intel-o3-1-')
) {
  throw new Error('Refusing to use an unverified compatibility temporary directory.');
}

try {
  const outputRoot = resolve(temporaryRoot, 'analysis');
  const result = await runCli(['scan', fixtureRoot, '--no-config', '--output', outputRoot]);
  if (result.exitCode !== 0) {
    throw new Error(`Compatibility scan failed with exit ${result.exitCode}: ${result.stderr}`);
  }
  const analysis = await readJson(resolve(outputRoot, 'analysis.json'));
  verifyAnalysis(analysis, contract.compatibilityCorpus.expectedAnalysis);
  process.stdout.write(
    `Compatibility corpus verified: ${analysis.endpoints.length} endpoints, ` +
      `${analysis.assertions.length} assertions, ${analysis.diagnostics.length} explicit gaps.\n`,
  );
} finally {
  const resolved = await realpath(temporaryRoot).catch(() => null);
  if (resolved !== null && contained(operatingSystemTemporaryRoot, resolved)) {
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
}
