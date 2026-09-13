import { projectCiAnnotations } from '../ci-evaluation/annotations.js';
import type {
  CiAnnotation,
  CiEvaluationDocument,
  CiEvidenceLocation,
} from '../ci-evaluation/model.js';
import { assertValidCiEvaluationDocument } from '../ci-evaluation/validate.js';
import {
  boundedCiCodePoints,
  escapeCiMarkdown,
  sanitizeCiRepositoryPath,
  sanitizeCiText,
} from '../ci-adapter/presentation.js';
import {
  GITHUB_ACTION_ADAPTER_VERSION,
  GITHUB_ACTION_MAX_ANNOTATIONS,
  GITHUB_ACTION_MAX_SUMMARY_BYTES,
  type GitHubAnnotationLevel,
  type GitHubAnnotationProjection,
  type GitHubCiProjection,
} from './model.js';
import { assertValidGitHubCiProjection } from './schemas.js';

const LEVEL_PRIORITY: Readonly<Record<GitHubAnnotationLevel, number>> = {
  error: 0,
  warning: 1,
  notice: 2,
};

export const sanitizeGitHubText = sanitizeCiText;

function githubLevel(annotation: CiAnnotation): GitHubAnnotationLevel {
  return annotation.level === 'failure' ? 'error' : annotation.level;
}

function candidateLocation(annotation: CiAnnotation): CiEvidenceLocation | null {
  return annotation.location?.side === 'candidate' ? annotation.location : null;
}

export const sanitizeGitHubRepositoryPath = sanitizeCiRepositoryPath;

function projectAnnotation(annotation: CiAnnotation): GitHubAnnotationProjection {
  const location = candidateLocation(annotation);
  const path = location === null ? null : sanitizeGitHubRepositoryPath(location.path);
  return {
    level: githubLevel(annotation),
    title: sanitizeGitHubText(annotation.title, 128),
    message: sanitizeGitHubText(annotation.message, 1_024),
    path,
    startLine: path === null ? null : (location?.startLine ?? null),
    endLine: path === null ? null : (location?.endLine ?? null),
    startColumn: path === null ? null : (location?.startColumn ?? null),
    endColumn: path === null ? null : (location?.endColumn ?? null),
    sourceAnnotationId: annotation.id,
  };
}

function renderSummary(
  document: CiEvaluationDocument,
  annotations: readonly GitHubAnnotationProjection[],
  omitted: number,
): string {
  const { summary } = document;
  const lines = [
    '# API Intelligence pull-request evaluation',
    '',
    `Outcome: **${document.outcome === 'success' ? 'pass' : 'policy violation'}**  `,
    `Evaluation: \`${document.evaluationId}\``,
    '',
    '> Potential impact is evidence-backed static reachability. It does not prove runtime behavior, deployment, broker delivery, or remote execution.',
    '',
    '| Category | Result |',
    '| --- | ---: |',
    `| Endpoints added / removed / modified | ${summary.endpointChanges.added} / ${summary.endpointChanges.removed} / ${summary.endpointChanges.modified} |`,
    `| Potential impact: direct / transitive | ${summary.potentialImpact.directlyChangedEndpointSlots} / ${summary.potentialImpact.transitivelyImpactedEndpointSlots} |`,
    `| Blocking policy results | ${summary.policy.blocking} |`,
    `| Policy warnings / errors / unknown | ${summary.policy.warnings} / ${summary.policy.errors} / ${summary.policy.unknown} |`,
    `| New or changed diagnostic warnings / errors | ${summary.diagnostics.newOrChangedWarnings} / ${summary.diagnostics.newOrChangedErrors} |`,
    `| Explicit gaps | ${summary.gaps} |`,
    '',
    '## Published findings',
    '',
  ];
  if (annotations.length === 0) lines.push('No annotations were published.');
  for (const annotation of annotations.slice(0, 20)) {
    const location =
      annotation.path === null ? '' : ` — \`${escapeCiMarkdown(annotation.path, 1_024)}\``;
    lines.push(
      `- **${annotation.level}** ${escapeCiMarkdown(annotation.title, 128)}${location}: ${escapeCiMarkdown(annotation.message, 1_024)}`,
    );
  }
  if (annotations.length > 20 || omitted > 0) {
    lines.push(
      '',
      `${annotations.length - Math.min(annotations.length, 20) + omitted} additional finding(s) are retained in the downloadable artifacts.`,
    );
  }
  const rendered = `${lines.join('\n')}\n`;
  if (Buffer.byteLength(rendered) <= GITHUB_ACTION_MAX_SUMMARY_BYTES) return rendered;
  return `${boundedCiCodePoints(rendered, GITHUB_ACTION_MAX_SUMMARY_BYTES - 64)}\n\n_Summary truncated; use the artifact bundle._\n`;
}

export function projectGitHubCiEvaluation(input: {
  readonly evaluation: CiEvaluationDocument;
  readonly maxAnnotations?: number | undefined;
}): GitHubCiProjection {
  const evaluation = assertValidCiEvaluationDocument(input.evaluation);
  const maximum = input.maxAnnotations ?? GITHUB_ACTION_MAX_ANNOTATIONS;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > GITHUB_ACTION_MAX_ANNOTATIONS) {
    throw new RangeError(`maxAnnotations must be between 1 and ${GITHUB_ACTION_MAX_ANNOTATIONS}.`);
  }
  const all = projectCiAnnotations(evaluation)
    .map(projectAnnotation)
    .sort(
      (left, right) =>
        LEVEL_PRIORITY[left.level] - LEVEL_PRIORITY[right.level] ||
        left.sourceAnnotationId.localeCompare(right.sourceAnnotationId),
    );
  const annotations = all.slice(0, maximum);
  const omittedAnnotationCount = all.length - annotations.length;
  return assertValidGitHubCiProjection({
    adapterVersion: GITHUB_ACTION_ADAPTER_VERSION,
    evaluationId: evaluation.evaluationId,
    outcome: evaluation.outcome,
    summaryMarkdown: renderSummary(evaluation, annotations, omittedAnnotationCount),
    annotations,
    annotationCount: annotations.length,
    omittedAnnotationCount,
  });
}

function escapeCommandData(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeCommandProperty(value: string): string {
  return escapeCommandData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

export function renderGitHubWorkflowCommand(annotation: GitHubAnnotationProjection): string {
  const properties = [`title=${escapeCommandProperty(annotation.title)}`];
  if (annotation.path !== null && annotation.startLine !== null && annotation.endLine !== null) {
    properties.push(
      `file=${escapeCommandProperty(annotation.path)}`,
      `line=${annotation.startLine}`,
      `endLine=${annotation.endLine}`,
    );
    if (annotation.startLine === annotation.endLine && annotation.startColumn !== null) {
      properties.push(`col=${annotation.startColumn}`);
      if (annotation.endColumn !== null) properties.push(`endColumn=${annotation.endColumn}`);
    }
  }
  return `::${annotation.level} ${properties.join(',')}::${escapeCommandData(annotation.message)}`;
}
