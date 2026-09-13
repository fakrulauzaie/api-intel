import { dirname, resolve } from 'node:path';
import {
  CiRepositoryEvaluationRunError,
  fingerprintCiDistribution,
  sanitizeCiText,
} from '../ci-adapter/index.js';
import {
  CiEvaluationProcessError,
  CI_PROCESS_EXIT_CODES,
  type CiPackageManager,
  type CiProcessOutcome,
} from '../ci-evaluation/index.js';
import { GITLAB_CI_MAX_FINDINGS } from './model.js';
import { GitLabCiRunError, runGitLabCi, writeGitLabFailureArtifacts } from './runner.js';

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

function processFailure(error: unknown): {
  readonly outcome: CiProcessOutcome;
  readonly exitCode: number;
  readonly message: string;
} {
  const outcome =
    error instanceof GitLabCiRunError || error instanceof CiRepositoryEvaluationRunError
      ? error.outcome
      : error instanceof CiEvaluationProcessError
        ? error.outcome
        : 'invalid_input';
  return {
    outcome,
    exitCode: CI_PROCESS_EXIT_CODES[outcome],
    message: error instanceof Error ? error.message : 'Unknown GitLab CI adapter failure.',
  };
}

export async function main(environment: NodeJS.ProcessEnv = process.env): Promise<number> {
  const projectDirectory = environment.CI_PROJECT_DIR;
  const publicationDirectory =
    environment.INPUT_PUBLICATION_DIRECTORY?.trim() || '.api-intel-gitlab';
  try {
    const entrypoint = process.argv[1];
    if (entrypoint === undefined) throw new RangeError('GitLab CI entrypoint is unavailable.');
    const engineDistributionFingerprint = await fingerprintCiDistribution(
      dirname(resolve(entrypoint)),
    );
    const result = await runGitLabCi({
      workspace: input(environment, 'workspace'),
      pipelineSource: environment.CI_PIPELINE_SOURCE ?? '',
      executionImage: input(environment, 'execution-image', environment.CI_JOB_IMAGE),
      projectDirectory: input(environment, 'project-directory', projectDirectory),
      publicationDirectory,
      baselineDirectory: input(environment, 'baseline-directory', 'baseline'),
      baselineRevision: input(
        environment,
        'baseline-revision',
        environment.CI_MERGE_REQUEST_DIFF_BASE_SHA,
      ),
      candidateDirectory: input(environment, 'candidate-directory', 'candidate'),
      candidateRevision: input(environment, 'candidate-revision', environment.CI_COMMIT_SHA),
      configurationPath: input(environment, 'configuration', 'baseline/api-intel.config.json'),
      outputDirectory: input(environment, 'output-directory', 'results'),
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
      maxFindings: boundedInteger(
        input(environment, 'max-findings', String(GITLAB_CI_MAX_FINDINGS)),
        'max-findings',
        1,
        GITLAB_CI_MAX_FINDINGS,
      ),
      engineDistributionFingerprint,
      processEnvironment: environment,
    });
    process.stdout.write(
      `API Intelligence ${result.outcome}; evaluation ${result.evaluationId}; ${result.findingCount} Code Quality finding(s), ${result.omittedFindingCount} artifact-only finding(s).\n`,
    );
    return result.processExitCode;
  } catch (error) {
    const failure = processFailure(error);
    process.stderr.write(`API Intelligence failed: ${sanitizeCiText(failure.message, 2_048)}\n`);
    if (projectDirectory !== undefined && projectDirectory !== '') {
      try {
        await writeGitLabFailureArtifacts({
          projectDirectory,
          publicationDirectory,
          ...failure,
        });
      } catch (publicationError) {
        process.stderr.write(
          `API Intelligence failure artifacts were not published: ${sanitizeCiText(publicationError instanceof Error ? publicationError.message : 'unknown publication failure', 1_024)}\n`,
        );
      }
    }
    return failure.exitCode;
  }
}
