import { spawn } from 'node:child_process';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(repositoryRoot, 'test/fixtures/github-action/controlled');
const actionEntrypoint = resolve(repositoryRoot, 'action-dist/index.js');

async function resolvePnpmExecutable() {
  const configured = process.env.API_INTEL_PNPM_EXECUTABLE;
  if (configured !== undefined) {
    if (!isAbsolute(configured)) throw new Error('API_INTEL_PNPM_EXECUTABLE must be absolute.');
    await access(configured);
    return realpath(configured);
  }
  if (process.platform !== 'win32') return 'pnpm';
  const localApplicationData = process.env.LOCALAPPDATA;
  if (localApplicationData !== undefined) {
    const shim = resolve(localApplicationData, 'pnpm/bin/pnpm.ps1');
    const source = await readFile(shim, 'utf8');
    const match = source.match(/\$basedir\/([^"\r\n]*?pnpm\.exe)/u);
    if (match?.[1] !== undefined) {
      const executable = resolve(dirname(shim), ...match[1].split('/'));
      await access(executable);
      return realpath(executable);
    }
  }
  throw new Error('Cannot resolve a directly executable pnpm binary for the controlled action.');
}

function run(executable, arguments_, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(executable, arguments_, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', rejectRun);
    // `exit` can fire before stdout/stderr streams have closed. Waiting for
    // `close` keeps short outputs such as `git rev-parse HEAD` from becoming an
    // intermittent empty Action input on hosted runners.
    child.once('close', (code, signal) => {
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) resolveRun(result);
      else {
        rejectRun(
          new Error(
            `${basename(executable)} failed (${signal ?? code ?? 'unknown'}): ${result.stderr || result.stdout}`,
          ),
        );
      }
    });
  });
}

async function git(directory, arguments_) {
  return run('git', ['-c', `safe.directory=${directory}`, ...arguments_], { cwd: directory });
}

async function createTarget(directory, fixtureName, pnpmExecutable, controlledEnvironment) {
  await mkdir(resolve(directory, 'src'), { recursive: true });
  await mkdir(resolve(directory, 'vendor/nest-common'), { recursive: true });
  await cp(resolve(fixtureRoot, fixtureName), resolve(directory, 'src/orders.ts'));
  await cp(
    resolve(fixtureRoot, 'common.d.ts.txt'),
    resolve(directory, 'vendor/nest-common/index.d.ts'),
  );
  await writeFile(
    resolve(directory, 'vendor/nest-common/package.json'),
    `${JSON.stringify({ name: '@nestjs/common', version: '11.2.1-controlled', types: 'index.d.ts' }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    resolve(directory, 'package.json'),
    `${JSON.stringify({ private: true, dependencies: { '@nestjs/common': 'file:vendor/nest-common' } }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    resolve(directory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          experimentalDecorators: true,
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(
    resolve(directory, 'api-intel.config.json'),
    `${JSON.stringify(
      {
        version: 4,
        rules: { 'no-new-diagnostics': 'error' },
        reports: { graph: { enabled: true } },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await run(pnpmExecutable, ['install', '--lockfile-only', '--ignore-scripts', '--offline'], {
    cwd: directory,
    env: controlledEnvironment,
  });
  await git(directory, ['init', '--initial-branch=main']);
  await git(directory, ['config', 'user.name', 'API Intelligence Fixture']);
  await git(directory, ['config', 'user.email', 'fixture@invalid.example']);
  await git(directory, ['add', '.']);
  await git(directory, ['commit', '--no-gpg-sign', '-m', `controlled ${fixtureName}`]);
  return (await git(directory, ['rev-parse', 'HEAD'])).stdout.trim();
}

async function listRelativeFiles(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  await visit(root);
  return result.sort();
}

async function main() {
  const expected = JSON.parse(await readFile(resolve(fixtureRoot, 'expected.json'), 'utf8'));
  const operatingSystemTemporaryRoot = await realpath(tmpdir());
  const workspace = await mkdtemp(resolve(operatingSystemTemporaryRoot, 'api-intel-o3-2-action-'));
  try {
    const baseline = resolve(workspace, 'baseline');
    const candidate = resolve(workspace, 'candidate');
    await Promise.all([mkdir(baseline), mkdir(candidate)]);
    const pnpmExecutable = await resolvePnpmExecutable();
    const controlledEnvironment = {
      ...process.env,
      // The local pnpm launcher may otherwise attempt a registry-backed packageManager
      // switch. Hosted CI already installs the exact requested pnpm version.
      pnpm_config_pm_on_fail: 'ignore',
    };
    const [baselineRevision, candidateRevision, pnpmVersion] = await Promise.all([
      createTarget(baseline, 'baseline.ts.txt', pnpmExecutable, controlledEnvironment),
      createTarget(candidate, 'candidate.ts.txt', pnpmExecutable, controlledEnvironment),
      run(pnpmExecutable, ['--version'], { env: controlledEnvironment }),
    ]);
    const outputPath = resolve(workspace, 'github-output.txt');
    const summaryPath = resolve(workspace, 'github-summary.md');
    await Promise.all([writeFile(outputPath, '', 'utf8'), writeFile(summaryPath, '', 'utf8')]);
    const actionResult = await run(process.execPath, [actionEntrypoint], {
      cwd: repositoryRoot,
      env: {
        ...controlledEnvironment,
        PATH: `${dirname(pnpmExecutable)}${delimiter}${process.env.PATH ?? ''}`,
        GITHUB_ACTION_PATH: repositoryRoot,
        GITHUB_EVENT_NAME: expected.event,
        GITHUB_WORKSPACE: workspace,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        INPUT_BASELINE_DIRECTORY: 'baseline',
        INPUT_BASELINE_REVISION: baselineRevision,
        INPUT_CANDIDATE_DIRECTORY: 'candidate',
        INPUT_CANDIDATE_REVISION: candidateRevision,
        INPUT_CONFIGURATION: 'baseline/api-intel.config.json',
        INPUT_OUTPUT_DIRECTORY: 'results',
        INPUT_BASELINE_PACKAGE_MANAGER: 'pnpm',
        INPUT_BASELINE_PACKAGE_MANAGER_VERSION: pnpmVersion.stdout.trim(),
        INPUT_BASELINE_LOCKFILE: 'pnpm-lock.yaml',
        INPUT_CANDIDATE_PACKAGE_MANAGER: 'pnpm',
        INPUT_CANDIDATE_PACKAGE_MANAGER_VERSION: pnpmVersion.stdout.trim(),
        INPUT_CANDIDATE_LOCKFILE: 'pnpm-lock.yaml',
        INPUT_MAX_ANNOTATIONS: '50',
      },
    });
    const outputs = await readFile(outputPath, 'utf8');
    const summary = await readFile(summaryPath, 'utf8');
    if (!outputs.includes(`outcome=${expected.outcome}`)) {
      throw new Error(`Controlled action did not succeed:\n${outputs}\n${actionResult.stdout}`);
    }
    if (!summary.includes(expected.addedEndpoint)) {
      throw new Error(`Controlled action summary omits ${expected.addedEndpoint}.`);
    }
    const artifactPathValue = outputs.match(/^artifact-path=(.+)$/mu)?.[1]?.trim();
    if (artifactPathValue === undefined || artifactPathValue === '') {
      throw new Error('Controlled action did not publish an artifact path.');
    }
    const artifactFiles = await listRelativeFiles(artifactPathValue);
    const missing = expected.requiredArtifacts.filter((path) => !artifactFiles.includes(path));
    if (missing.length > 0)
      throw new Error(`Controlled action artifacts missing: ${missing.join(', ')}.`);
    const targetFiles = [
      ...(await listRelativeFiles(baseline)),
      ...(await listRelativeFiles(candidate)),
    ];
    if (targetFiles.some((path) => path.startsWith('action-dist/'))) {
      throw new Error('Controlled target unexpectedly contains the action implementation.');
    }
    const recipe = JSON.parse(
      await readFile(resolve(artifactPathValue, 'ci-scan-recipe.json'), 'utf8'),
    );
    if (!/^sha256:[a-f0-9]{64}$/u.test(recipe.engine?.distributionFingerprint)) {
      throw new Error('Controlled action recipe omits its checked-distribution fingerprint.');
    }
    process.stdout.write(
      `Controlled checked-in action passed: ${expected.addedEndpoint}; ${artifactFiles.length} artifacts.\n`,
    );
  } finally {
    const canonical = await realpath(workspace).catch(() => null);
    if (
      canonical !== null &&
      relative(operatingSystemTemporaryRoot, canonical) !== '' &&
      !relative(operatingSystemTemporaryRoot, canonical).startsWith('..') &&
      basename(canonical).startsWith('api-intel-o3-2-action-')
    ) {
      await rm(canonical, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

await main();
