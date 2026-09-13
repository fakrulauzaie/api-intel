import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  canonicalCiOutputPath,
  ciArtifactRecord,
  portableCiPath,
  runCiRepositoryEvaluation,
  sanitizeCiText,
  type CiRepositoryEvaluationRunInput,
} from '../ci-adapter/index.js';
import { CI_PROCESS_EXIT_CODES, type CiProcessOutcome } from '../ci-evaluation/index.js';
import { canonicalStringify } from '../model/ordering.js';
import { writeTextFilesAtomically } from '../output/atomic-files.js';
import { GITLAB_CI_ADAPTER_VERSION, type GitLabCiArtifactManifest } from './model.js';
import { projectGitLabCiEvaluation, serializeGitLabCodeQualityReport } from './project.js';
import { assertValidGitLabCiArtifactManifest } from './schemas.js';

export const GITLAB_CI_PROCESS_EXIT_CODES = CI_PROCESS_EXIT_CODES;

export class GitLabCiRunError extends Error {
  readonly outcome: CiProcessOutcome;
  readonly exitCode: number;

  constructor(outcome: CiProcessOutcome, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitLabCiRunError';
    this.outcome = outcome;
    this.exitCode = CI_PROCESS_EXIT_CODES[outcome];
  }
}

export interface GitLabCiRunInput extends CiRepositoryEvaluationRunInput {
  readonly pipelineSource: string;
  readonly executionImage: string;
  readonly projectDirectory: string;
  readonly publicationDirectory: string;
  readonly maxFindings: number;
}

export interface GitLabCiRunResult {
  readonly outcome: 'success' | 'policy_violation';
  readonly processExitCode: 0 | 8;
  readonly evaluationId: string;
  readonly publicationPath: string;
  readonly evaluationArtifactPath: string;
  readonly findingCount: number;
  readonly omittedFindingCount: number;
}

async function assertFreshPublicationPath(root: string, value: string): Promise<string> {
  const path = await canonicalCiOutputPath(root, value);
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return path;
    throw error;
  }
  throw new GitLabCiRunError(
    'invalid_input',
    'GitLab publication directory must not already exist in the candidate checkout.',
  );
}

async function publicationRoot(input: {
  readonly projectDirectory: string;
  readonly publicationDirectory: string;
}): Promise<string> {
  const projectDirectory = await realpath(input.projectDirectory);
  return assertFreshPublicationPath(projectDirectory, input.publicationDirectory);
}

export async function writeGitLabFailureArtifacts(input: {
  readonly projectDirectory: string;
  readonly publicationDirectory: string;
  readonly outcome: CiProcessOutcome;
  readonly exitCode: number;
  readonly message: string;
}): Promise<string> {
  const root = await publicationRoot(input);
  const safeMessage = sanitizeCiText(input.message, 2_048);
  await writeTextFilesAtomically([
    { path: join(root, 'gl-code-quality-report.json'), contents: '[]\n' },
    {
      path: join(root, 'gitlab-summary.md'),
      contents: [
        '# API Intelligence merge-request evaluation',
        '',
        `Outcome: **${input.outcome}**`,
        '',
        safeMessage,
        '',
        'No Code Quality findings were fabricated for an incomplete evaluation.',
        '',
      ].join('\n'),
    },
    {
      path: join(root, 'process-result.json'),
      contents: canonicalStringify({
        outcome: input.outcome,
        processExitCode: input.exitCode,
        evaluationId: null,
      }),
    },
  ]);
  return root;
}

export async function runGitLabCi(input: GitLabCiRunInput): Promise<GitLabCiRunResult> {
  if (input.pipelineSource !== 'merge_request_event') {
    throw new GitLabCiRunError(
      'invalid_input',
      'The Phase P3.2 component runs only in a merge_request_event pipeline.',
    );
  }
  if (!/^.+@sha256:[a-f0-9]{64}$/u.test(input.executionImage)) {
    throw new GitLabCiRunError(
      'invalid_input',
      'The GitLab execution image must be pinned by an exact sha256 manifest digest.',
    );
  }
  const publishRoot = await publicationRoot(input);
  const common = await runCiRepositoryEvaluation(input);
  const projection = projectGitLabCiEvaluation({
    evaluation: common.evaluation,
    executionImage: input.executionImage,
    maxFindings: input.maxFindings,
  });
  const evaluationDirectory = join(
    publishRoot,
    'evaluations',
    common.evaluation.evaluationId.replace(':', '-'),
  );
  const codeQuality = serializeGitLabCodeQualityReport(projection.findings);
  const files = common.files.map(({ path, contents }) => ({
    path: join(evaluationDirectory, portableCiPath(common.artifactPath, path)),
    contents,
  }));
  files.push(
    {
      path: join(evaluationDirectory, 'gitlab-code-quality.json'),
      contents: codeQuality,
    },
    {
      path: join(evaluationDirectory, 'gitlab-summary.md'),
      contents: projection.summaryMarkdown,
    },
  );
  const manifest: GitLabCiArtifactManifest = assertValidGitLabCiArtifactManifest({
    schemaVersion: '1.0.0',
    adapterVersion: GITLAB_CI_ADAPTER_VERSION,
    executionImage: input.executionImage,
    evaluationId: common.evaluation.evaluationId,
    outcome: common.evaluation.outcome,
    codeQuality: {
      published: projection.findingCount,
      omitted: projection.omittedFindingCount,
    },
    files: files
      .map(({ path, contents }) =>
        ciArtifactRecord(portableCiPath(evaluationDirectory, path), contents),
      )
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
  files.push(
    {
      path: join(evaluationDirectory, 'manifest.json'),
      contents: canonicalStringify(manifest),
    },
    { path: join(publishRoot, 'gl-code-quality-report.json'), contents: codeQuality },
    { path: join(publishRoot, 'gitlab-summary.md'), contents: projection.summaryMarkdown },
    {
      path: join(publishRoot, 'process-result.json'),
      contents: canonicalStringify({
        outcome: common.evaluation.outcome,
        executionImage: input.executionImage,
        processExitCode: common.evaluation.outcome === 'policy_violation' ? 8 : 0,
        evaluationId: common.evaluation.evaluationId,
        evaluationArtifactPath: portableCiPath(publishRoot, evaluationDirectory),
        codeQuality: {
          published: projection.findingCount,
          omitted: projection.omittedFindingCount,
        },
      }),
    },
  );
  await writeTextFilesAtomically(files);
  return {
    outcome: common.evaluation.outcome,
    processExitCode: common.evaluation.outcome === 'policy_violation' ? 8 : 0,
    evaluationId: common.evaluation.evaluationId,
    publicationPath: publishRoot,
    evaluationArtifactPath: evaluationDirectory,
    findingCount: projection.findingCount,
    omittedFindingCount: projection.omittedFindingCount,
  };
}
