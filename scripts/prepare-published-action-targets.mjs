import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveNpmCliPath } from './package-manager-cli.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(repositoryRoot, 'test/fixtures/github-action/controlled');
const workspace = process.env.GITHUB_WORKSPACE;
const outputFile = process.env.GITHUB_OUTPUT;
if (!workspace || !outputFile) {
  throw new Error('The published Action target builder requires GitHub Actions output paths.');
}
const targetRoot = resolve(workspace, '.api-intel-published-action-targets');
const npmCli = resolveNpmCliPath();
try {
  await access(targetRoot);
  throw new Error('Refusing to replace an existing published Action target directory.');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

function run(executable, arguments_, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(executable, arguments_, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', rejectRun);
    child.once('close', (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) resolveRun(result);
      else {
        rejectRun(
          new Error(
            `${executable} ${arguments_.join(' ')} exited ${code ?? 1}: ` +
              `${result.stderr || result.stdout}`,
          ),
        );
      }
    });
  });
}

async function createTarget(name, sourceFixture) {
  const root = resolve(targetRoot, name);
  await Promise.all([
    mkdir(resolve(root, 'src'), { recursive: true }),
    mkdir(resolve(root, 'vendor/nest-common'), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(resolve(fixtureRoot, sourceFixture), resolve(root, 'src/orders.ts')),
    copyFile(
      resolve(fixtureRoot, 'common.d.ts.txt'),
      resolve(root, 'vendor/nest-common/index.d.ts'),
    ),
    writeFile(
      resolve(root, 'vendor/nest-common/package.json'),
      `${JSON.stringify(
        { name: '@nestjs/common', version: '11.2.1-published-action', types: 'index.d.ts' },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    writeFile(
      resolve(root, 'package.json'),
      `${JSON.stringify(
        {
          name: `api-intel-published-action-${name}`,
          version: '1.0.0',
          private: true,
          packageManager: 'npm@10.9.2',
          dependencies: { '@nestjs/common': 'file:vendor/nest-common' },
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    writeFile(
      resolve(root, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            preserveSymlinks: true,
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
    ),
    writeFile(
      resolve(root, 'api-intel.config.json'),
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
    ),
  ]);
  await run(
    process.execPath,
    [npmCli, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    root,
  );
  await run('git', ['init', '--initial-branch=main'], root);
  await run('git', ['config', 'user.name', 'api-intel release verifier'], root);
  await run('git', ['config', 'user.email', 'release-verifier@invalid.example'], root);
  await run('git', ['add', '.'], root);
  await run('git', ['commit', '--no-gpg-sign', '-m', `published Action ${name}`], root);
  const revision = (await run('git', ['rev-parse', 'HEAD'], root)).stdout.trim();
  return {
    directory: `.api-intel-published-action-targets/${name}`,
    revision,
  };
}

const [baseline, candidate] = await Promise.all([
  createTarget('baseline', 'baseline.ts.txt'),
  createTarget('candidate', 'candidate.ts.txt'),
]);
await writeFile(
  outputFile,
  [
    `baseline-directory=${baseline.directory}`,
    `baseline-revision=${baseline.revision}`,
    `candidate-directory=${candidate.directory}`,
    `candidate-revision=${candidate.revision}`,
    '',
  ].join('\n'),
  { encoding: 'utf8', flag: 'a' },
);
process.stdout.write(
  `Prepared isolated published Action targets: ${baseline.revision} -> ${candidate.revision}.\n`,
);
