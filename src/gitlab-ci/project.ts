import {
  boundedCiCodePoints,
  escapeCiMarkdown,
  sanitizeCiRepositoryPath,
  sanitizeCiText,
} from '../ci-adapter/presentation.js';
import { projectCiAnnotations } from '../ci-evaluation/annotations.js';
import type { CiAnnotation, CiEvaluationDocument } from '../ci-evaluation/model.js';
import { assertValidCiEvaluationDocument } from '../ci-evaluation/validate.js';
import { hashContent } from '../model/hashing.js';
import { canonicalStringify } from '../model/ordering.js';
import {
  GITLAB_CI_ADAPTER_VERSION,
  GITLAB_CI_MAX_FINDINGS,
  GITLAB_CI_MAX_SUMMARY_BYTES,
  type GitLabCiProjection,
  type GitLabCodeQualityFinding,
  type GitLabCodeQualitySeverity,
} from './model.js';
import { assertValidGitLabCiProjection, gitLabCodeQualityFindingSchema } from './schemas.js';

const SEVERITY_PRIORITY: Readonly<Record<GitLabCodeQualitySeverity, number>> = {
  blocker: 0,
  critical: 1,
  major: 2,
  minor: 3,
  info: 4,
};

function gitLabSeverity(annotation: CiAnnotation): GitLabCodeQualitySeverity {
  if (annotation.level === 'failure') return 'blocker';
  if (annotation.level === 'warning') return 'major';
  return 'info';
}

function projectFinding(annotation: CiAnnotation): GitLabCodeQualityFinding | null {
  if (annotation.location?.side !== 'candidate') return null;
  const path = sanitizeCiRepositoryPath(annotation.location.path);
  if (path === null) return null;
  return gitLabCodeQualityFindingSchema.parse({
    description: sanitizeCiText(`${annotation.title}: ${annotation.message}`, 2_048),
    check_name: sanitizeCiText(`api-intel/${annotation.category}: ${annotation.title}`, 255),
    fingerprint: hashContent(
      canonicalStringify({
        sourceAnnotationId: annotation.id,
        path,
        line: annotation.location.startLine,
      }),
    ),
    severity: gitLabSeverity(annotation),
    location: { path, lines: { begin: annotation.location.startLine } },
  });
}

function renderSummary(
  document: CiEvaluationDocument,
  findings: readonly GitLabCodeQualityFinding[],
  omitted: number,
): string {
  const { summary } = document;
  const lines = [
    '# API Intelligence merge-request evaluation',
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
    `| GitLab Code Quality findings / artifact-only findings | ${findings.length} / ${omitted} |`,
    '',
    '## Code Quality findings',
    '',
  ];
  if (findings.length === 0) lines.push('No candidate file/line findings were published.');
  for (const finding of findings.slice(0, 20)) {
    lines.push(
      `- **${finding.severity}** \`${escapeCiMarkdown(finding.location.path, 1_024)}:${finding.location.lines.begin}\` — ${escapeCiMarkdown(finding.description, 2_048)}`,
    );
  }
  if (findings.length > 20 || omitted > 0) {
    lines.push(
      '',
      `${findings.length - Math.min(findings.length, 20) + omitted} additional or non-file finding(s) are retained in the downloadable artifacts.`,
    );
  }
  const rendered = `${lines.join('\n')}\n`;
  if (Buffer.byteLength(rendered) <= GITLAB_CI_MAX_SUMMARY_BYTES) return rendered;
  return `${boundedCiCodePoints(rendered, GITLAB_CI_MAX_SUMMARY_BYTES - 64)}\n\n_Summary truncated; use the artifact bundle._\n`;
}

export function projectGitLabCiEvaluation(input: {
  readonly evaluation: CiEvaluationDocument;
  readonly executionImage: string;
  readonly maxFindings?: number | undefined;
}): GitLabCiProjection {
  const evaluation = assertValidCiEvaluationDocument(input.evaluation);
  const maximum = input.maxFindings ?? GITLAB_CI_MAX_FINDINGS;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > GITLAB_CI_MAX_FINDINGS) {
    throw new RangeError(`maxFindings must be between 1 and ${GITLAB_CI_MAX_FINDINGS}.`);
  }
  const annotations = projectCiAnnotations(evaluation);
  const all = annotations
    .map(projectFinding)
    .filter((finding): finding is GitLabCodeQualityFinding => finding !== null)
    .sort(
      (left, right) =>
        SEVERITY_PRIORITY[left.severity] - SEVERITY_PRIORITY[right.severity] ||
        left.fingerprint.localeCompare(right.fingerprint),
    );
  const findings = all.slice(0, maximum);
  const omittedFindingCount = annotations.length - findings.length;
  return assertValidGitLabCiProjection({
    adapterVersion: GITLAB_CI_ADAPTER_VERSION,
    executionImage: input.executionImage,
    evaluationId: evaluation.evaluationId,
    outcome: evaluation.outcome,
    summaryMarkdown: renderSummary(evaluation, findings, omittedFindingCount),
    findings,
    findingCount: findings.length,
    omittedFindingCount,
  });
}

export function serializeGitLabCodeQualityReport(
  findings: readonly GitLabCodeQualityFinding[],
): string {
  return `${canonicalStringify(findings)}\n`;
}
