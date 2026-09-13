import { appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CiRepositoryEvaluationRunError, fingerprintCiDistribution } from '../ci-adapter/index.js';
import { CiEvaluationProcessError, type CiPackageManager } from '../ci-evaluation/index.js';
import { GITHUB_ACTION_MAX_ANNOTATIONS, GITHUB_ACTION_MAX_SUMMARY_BYTES } from './model.js';
import { sanitizeGitHubText } from './project.js';
import {
  GITHUB_ACTION_PROCESS_EXIT_CODES,
  GitHubActionRunError,
  runGitHubAction,
} from './runner.js';

function input(environment: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const key = `INPUT_${name.replaceAll('-', '_').toUpperCase()}`;
  const value = environment[key]?.trim() ?? fallback;
  if (value === undefined || value === '') throw new RangeError(`Missing required input: ${name}.`);
  if (Buffer.byteLength(value) > 2_048) throw new RangeError(`Input ${name} is too long.`);
  return value;
}

function packageManager(value: string, name: string): CiPackageManager {
  if (value === 'pnpm' || value === 'npm') return value;
  throw new RangeError(`${name} must be pnpm or npm.`);
}

function boundedInteger(value: string, name: string, minimum: number, maximum: number): number {
  if (!/^\d+$/u.test(value)) throw new RangeError(`${name} must be an integer.`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

async function append(path: string | undefined, contents: string): Promise<void> {
  if (path === undefined || path === '') return;
  await appendFile(path, contents, 'utf8');
}

function errorCommand(message: string): string {
  const value = sanitizeGitHubText(message, 2_048)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  return `::error title=API Intelligence action failed::${value}`;
}

function outcomeForExitCode(exitCode: number): string {
  const entry = Object.entries(GITHUB_ACTION_PROCESS_EXIT_CODES).find(
    ([, candidate]) => candidate === exitCode,
  );
  return entry?.[0] ?? 'invalid_input';
}

export async function fingerprintGitHubActionDistribution(directory: string): Promise<string> {
  return fingerprintCiDistribution(directory);
}

export async function main(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    const workspace = input(environment, 'workspace', environment.GITHUB_WORKSPACE);
    const entrypoint = process.argv[1];
    if (entrypoint === undefined) throw new RangeError('Action entrypoint is unavailable.');
    const engineDistributionFingerprint = await fingerprintGitHubActionDistribution(
      dirname(resolve(entrypoint)),
    );
    await runGitHubAction({
      workspace,
      eventName: environment.GITHUB_EVENT_NAME ?? '',
      baselineDirectory: input(
        environment,
        'baseline-directory',
        '.api-intel-ci-workspaces/baseline',
      ),
      baselineRevision: input(environment, 'baseline-revision'),
      candidateDirectory: input(
        environment,
        'candidate-directory',
        '.api-intel-ci-workspaces/candidate',
      ),
      candidateRevision: input(environment, 'candidate-revision'),
      configurationPath: input(
        environment,
        'configuration',
        '.api-intel-ci-workspaces/baseline/api-intel.config.json',
      ),
      outputDirectory: input(environment, 'output-directory', '.api-intel-ci-results'),
      baselinePackageManager: packageManager(
        input(environment, 'baseline-package-manager', 'pnpm'),
        'baseline-package-manager',
      ),
      baselinePackageManagerVersion: input(
        environment,
        'baseline-package-manager-version',
        '11.19.0',
      ),
      baselineLockfilePath: input(environment, 'baseline-lockfile', 'pnpm-lock.yaml'),
      candidatePackageManager: packageManager(
        input(environment, 'candidate-package-manager', 'pnpm'),
        'candidate-package-manager',
      ),
      candidatePackageManagerVersion: input(
        environment,
        'candidate-package-manager-version',
        '11.19.0',
      ),
      candidateLockfilePath: input(environment, 'candidate-lockfile', 'pnpm-lock.yaml'),
      maxAnnotations: boundedInteger(
        input(environment, 'max-annotations', String(GITHUB_ACTION_MAX_ANNOTATIONS)),
        'max-annotations',
        1,
        GITHUB_ACTION_MAX_ANNOTATIONS,
      ),
      engineDistributionFingerprint,
      processEnvironment: environment,
      ...(environment.GITHUB_STEP_SUMMARY === undefined
        ? {}
        : { summaryPath: environment.GITHUB_STEP_SUMMARY }),
      ...(environment.GITHUB_OUTPUT === undefined ? {} : { outputPath: environment.GITHUB_OUTPUT }),
    });
  } catch (error) {
    const exitCode =
      error instanceof GitHubActionRunError
        ? error.exitCode
        : error instanceof CiRepositoryEvaluationRunError
          ? error.exitCode
          : error instanceof CiEvaluationProcessError
            ? error.exitCode
            : GITHUB_ACTION_PROCESS_EXIT_CODES.invalid_input;
    const message = error instanceof Error ? error.message : 'Unknown action failure.';
    process.stdout.write(`${errorCommand(message)}\n`);
    const summary = [
      '# API Intelligence pull-request evaluation',
      '',
      '**Outcome: analysis action failed**',
      '',
      sanitizeGitHubText(message, GITHUB_ACTION_MAX_SUMMARY_BYTES - 128),
      '',
    ].join('\n');
    await append(environment.GITHUB_STEP_SUMMARY, summary);
    await append(
      environment.GITHUB_OUTPUT,
      `outcome=${outcomeForExitCode(exitCode)}\nprocess-exit-code=${exitCode}\nevaluation-id=\nartifact-path=\nannotations-published=0\nannotations-omitted=0\n`,
    );
  }
}
