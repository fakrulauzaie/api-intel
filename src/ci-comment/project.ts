import { projectCiAnnotations } from '../ci-evaluation/annotations.js';
import type { CiAnnotation, CiEvaluationDocument } from '../ci-evaluation/model.js';
import { assertValidCiEvaluationDocument } from '../ci-evaluation/validate.js';
import {
  canonicalizeCiCommentDocument,
  compareCiCommentArtifactLinks,
  compareCiCommentFindings,
  expectedCiCommentId,
} from './ordering.js';
import {
  CI_COMMENT_ARTIFACT_KINDS,
  CI_COMMENT_DEFAULT_MAX_ARTIFACT_LINKS,
  CI_COMMENT_DEFAULT_MAX_ITEMS,
  CI_COMMENT_HARD_MAX_ARTIFACT_LINKS,
  CI_COMMENT_HARD_MAX_ITEMS,
  CI_COMMENT_MAX_INPUT_ARTIFACT_LINKS,
  CI_COMMENT_MAX_MARKDOWN_BYTES,
  CI_COMMENT_MIN_MARKDOWN_BYTES,
  CI_COMMENT_PROVIDERS,
  CI_COMMENT_SCHEMA_VERSION,
  CI_COMMENT_UPSERT_KEY,
  CI_COMMENT_UPSERT_MARKER,
  type CiCommentArtifactLink,
  type CiCommentDocument,
  type CiCommentFinding,
  type CiCommentProjectionLimits,
  type CiCommentRunIdentity,
} from './model.js';
import {
  normalizeCiCommentHttpsUrl,
  sanitizeCiCommentRepositoryPath,
  sanitizeCiCommentText,
} from './presentation.js';
import { renderCiCommentMarkdownUnchecked } from './render.js';
import { assertValidCiCommentDocument } from './validate.js';

const PLACEHOLDER_COMMENT_ID = 'ci_comment:00000000000000000000000000000000';

function normalizedLimit(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return result;
}

function finding(annotation: CiAnnotation): CiCommentFinding {
  const path =
    annotation.location === null ? null : sanitizeCiCommentRepositoryPath(annotation.location.path);
  return {
    sourceAnnotationId: annotation.id,
    category: annotation.category,
    level: annotation.level,
    title: sanitizeCiCommentText(annotation.title, 160) || 'Finding',
    message:
      sanitizeCiCommentText(annotation.message, 768) || 'Details retained in evidence artifacts.',
    location:
      path === null || annotation.location === null
        ? null
        : {
            side: annotation.location.side,
            path,
            startLine: annotation.location.startLine,
          },
  };
}

function normalizeRun(run: CiCommentRunIdentity): CiCommentRunIdentity {
  if (!CI_COMMENT_PROVIDERS.includes(run.provider)) {
    throw new TypeError(`Unsupported CI comment provider: ${String(run.provider)}.`);
  }
  const id = sanitizeCiCommentText(run.id, 128);
  if (id === '') throw new TypeError('CI comment run ID must contain displayable text.');
  return { provider: run.provider, id, url: normalizeCiCommentHttpsUrl(run.url) };
}

function normalizeArtifactLinks(links: readonly CiCommentArtifactLink[]): CiCommentArtifactLink[] {
  if (links.length > CI_COMMENT_MAX_INPUT_ARTIFACT_LINKS) {
    throw new RangeError(
      `artifactLinks must not exceed ${CI_COMMENT_MAX_INPUT_ARTIFACT_LINKS} candidates.`,
    );
  }
  for (const artifact of links) {
    if (!CI_COMMENT_ARTIFACT_KINDS.includes(artifact.kind)) {
      throw new TypeError(`Unsupported CI comment artifact kind: ${String(artifact.kind)}.`);
    }
  }
  const normalized = links.map((artifact) => ({
    kind: artifact.kind,
    label: sanitizeCiCommentText(artifact.label, 160) || artifact.kind.replaceAll('_', ' '),
    url: normalizeCiCommentHttpsUrl(artifact.url),
  }));
  return [
    ...new Map(
      normalized.map((artifact) => [`${artifact.kind}:${artifact.url}`, artifact]),
    ).values(),
  ].sort(compareCiCommentArtifactLinks);
}

export function projectCiComment(input: {
  readonly evaluation: CiEvaluationDocument;
  readonly run: CiCommentRunIdentity;
  readonly artifactLinks: readonly CiCommentArtifactLink[];
  readonly limits?: CiCommentProjectionLimits;
}): CiCommentDocument {
  const evaluation = assertValidCiEvaluationDocument(input.evaluation);
  const maxItems = normalizedLimit(
    input.limits?.maxItems,
    CI_COMMENT_DEFAULT_MAX_ITEMS,
    1,
    CI_COMMENT_HARD_MAX_ITEMS,
    'maxItems',
  );
  const maxArtifactLinks = normalizedLimit(
    input.limits?.maxArtifactLinks,
    CI_COMMENT_DEFAULT_MAX_ARTIFACT_LINKS,
    1,
    CI_COMMENT_HARD_MAX_ARTIFACT_LINKS,
    'maxArtifactLinks',
  );
  const maxMarkdownBytes = normalizedLimit(
    input.limits?.maxMarkdownBytes,
    CI_COMMENT_MAX_MARKDOWN_BYTES,
    CI_COMMENT_MIN_MARKDOWN_BYTES,
    CI_COMMENT_MAX_MARKDOWN_BYTES,
    'maxMarkdownBytes',
  );
  const run = normalizeRun(input.run);
  const allArtifactLinks = normalizeArtifactLinks(input.artifactLinks);
  if (allArtifactLinks.length === 0) {
    throw new TypeError('At least one downloadable evidence artifact link is required.');
  }
  const allFindings = projectCiAnnotations(evaluation).map(finding).sort(compareCiCommentFindings);
  const retainedFindings = allFindings.slice(0, maxItems);
  const retainedArtifactLinks = allArtifactLinks.slice(0, maxArtifactLinks);
  const candidateRevision = evaluation.provenance.candidate.repositoryRevision;

  const draft = (): CiCommentDocument => ({
    schemaVersion: CI_COMMENT_SCHEMA_VERSION,
    commentId: PLACEHOLDER_COMMENT_ID,
    upsert: { key: CI_COMMENT_UPSERT_KEY, marker: CI_COMMENT_UPSERT_MARKER },
    evaluationId: evaluation.evaluationId,
    outcome: evaluation.outcome,
    run,
    candidate: {
      analysisId: evaluation.provenance.candidate.analysisId,
      repositoryRevision:
        candidateRevision === null ? null : sanitizeCiCommentText(candidateRevision, 256),
    },
    summary: evaluation.summary,
    findings: retainedFindings,
    artifactLinks: retainedArtifactLinks,
    limits: {
      maxItems,
      maxArtifactLinks,
      maxMarkdownBytes,
      candidateItems: allFindings.length,
      includedItems: retainedFindings.length,
      omittedItems: allFindings.length - retainedFindings.length,
      candidateArtifactLinks: allArtifactLinks.length,
      includedArtifactLinks: retainedArtifactLinks.length,
      omittedArtifactLinks: allArtifactLinks.length - retainedArtifactLinks.length,
      renderedMarkdownBytes: 0,
    },
  });

  let projected = draft();
  while (Buffer.byteLength(renderCiCommentMarkdownUnchecked(projected)) > maxMarkdownBytes) {
    if (retainedFindings.length > 0) retainedFindings.pop();
    else if (retainedArtifactLinks.length > 1) retainedArtifactLinks.pop();
    else throw new RangeError('The minimum CI comment exceeds the configured Markdown byte limit.');
    projected = draft();
  }

  projected = canonicalizeCiCommentDocument(projected);
  projected = {
    ...projected,
    limits: {
      ...projected.limits,
      renderedMarkdownBytes: Buffer.byteLength(renderCiCommentMarkdownUnchecked(projected)),
    },
  };
  const { commentId, ...identityInput } = projected;
  void commentId;
  return assertValidCiCommentDocument({
    ...projected,
    commentId: expectedCiCommentId(identityInput),
  });
}
