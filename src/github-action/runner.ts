import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ciArtifactRecord,
  portableCiPath,
  runCiRepositoryEvaluation,
  targetProcessEnvironment,
  type CiRepositoryEvaluationRunInput,
} from '../ci-adapter/index.js';
import { CI_PROCESS_EXIT_CODES } from '../ci-evaluation/index.js';
import { canonicalStringify } from '../model/ordering.js';
import { writeTextFilesAtomically } from '../output/atomic-files.js';
import { GITHUB_ACTION_ADAPTER_VERSION, type GitHubActionArtifactManifest } from './model.js';
import { projectGitHubCiEvaluation, renderGitHubWorkflowCommand } from './project.js';
import { assertValidGitHubActionArtifactManifest } from './schemas.js';

export const GITHUB_ACTION_PROCESS_EXIT_CODES = CI_PROCESS_EXIT_CODES;
export { targetProcessEnvironment };

export class GitHubActionRunError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitHubActionRunError';
    this.exitCode = exitCode;
  }
}

export interface GitHubActionRunInput extends CiRepositoryEvaluationRunInput {
  readonly eventName: string;
  readonly maxAnnotations: number;
  readonly summaryPath?: string | undefined;
  readonly outputPath?: string | undefined;
}

export interface GitHubActionRunResult {
  readonly outcome: 'success' | 'policy_violation';
  readonly processExitCode: 0 | 8;
  readonly evaluationId: string;
  readonly artifactPath: string;
  readonly annotationCount: number;
  readonly omittedAnnotationCount: number;
}

async function appendEnvironmentFile(path: string | undefined, contents: string): Promise<void> {
  if (path === undefined || path === '') return;
  await appendFile(path, contents, 'utf8');
}

function outputLines(result: GitHubActionRunResult): string {
  return [
    `outcome=${result.outcome}`,
    `process-exit-code=${result.processExitCode}`,
    `evaluation-id=${result.evaluationId}`,
    `artifact-path=${result.artifactPath}`,
    `annotations-published=${result.annotationCount}`,
    `annotations-omitted=${result.omittedAnnotationCount}`,
    '',
  ].join('\n');
}

export async function runGitHubAction(input: GitHubActionRunInput): Promise<GitHubActionRunResult> {
  if (input.eventName === 'pull_request_target') {
    throw new GitHubActionRunError(
      'pull_request_target is forbidden because candidate dependencies and source are untrusted.',
      GITHUB_ACTION_PROCESS_EXIT_CODES.invalid_input,
    );
  }
  if (input.eventName !== 'pull_request') {
    throw new GitHubActionRunError(
      'The Phase P3.1 action runs only for the pull_request event.',
      GITHUB_ACTION_PROCESS_EXIT_CODES.invalid_input,
    );
  }

  const common = await runCiRepositoryEvaluation(input);
  const projection = projectGitHubCiEvaluation({
    evaluation: common.evaluation,
    maxAnnotations: input.maxAnnotations,
  });
  const files = [
    ...common.files,
    { path: join(common.artifactPath, 'github-summary.md'), contents: projection.summaryMarkdown },
    {
      path: join(common.artifactPath, 'github-annotations.jsonl'),
      contents: `${projection.annotations.map(canonicalStringify).join('\n')}${projection.annotations.length === 0 ? '' : '\n'}`,
    },
  ];
  const manifest: GitHubActionArtifactManifest = assertValidGitHubActionArtifactManifest({
    schemaVersion: '1.0.0',
    adapterVersion: GITHUB_ACTION_ADAPTER_VERSION,
    evaluationId: common.evaluation.evaluationId,
    outcome: common.evaluation.outcome,
    annotations: {
      published: projection.annotationCount,
      omitted: projection.omittedAnnotationCount,
    },
    files: files
      .map(({ path, contents }) =>
        ciArtifactRecord(portableCiPath(common.artifactPath, path), contents),
      )
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
  files.push({
    path: join(common.artifactPath, 'manifest.json'),
    contents: canonicalStringify(manifest),
  });
  await writeTextFilesAtomically(files);
  await appendEnvironmentFile(input.summaryPath, projection.summaryMarkdown);
  for (const annotation of projection.annotations) {
    process.stdout.write(`${renderGitHubWorkflowCommand(annotation)}\n`);
  }
  if (projection.omittedAnnotationCount > 0) {
    process.stdout.write(
      `::notice title=API Intelligence annotation limit::${projection.omittedAnnotationCount} additional finding(s) are available in the artifact bundle.%0A\n`,
    );
  }
  const result: GitHubActionRunResult = {
    outcome: common.evaluation.outcome,
    processExitCode: common.evaluation.outcome === 'policy_violation' ? 8 : 0,
    evaluationId: common.evaluation.evaluationId,
    artifactPath: common.artifactPath,
    annotationCount: projection.annotationCount,
    omittedAnnotationCount: projection.omittedAnnotationCount,
  };
  await appendEnvironmentFile(input.outputPath, outputLines(result));
  return result;
}
