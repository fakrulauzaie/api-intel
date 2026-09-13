import { makeCiStableId } from '../ci-evaluation/ordering.js';
import { canonicalStringify } from '../model/ordering.js';
import type { CiCommentArtifactLink, CiCommentDocument, CiCommentFinding } from './model.js';

const LEVEL_PRIORITY = { failure: 0, warning: 1, notice: 2 } as const;
const CATEGORY_PRIORITY = {
  policy: 0,
  gap: 1,
  diagnostic: 2,
  potential_impact: 3,
  endpoint_change: 4,
} as const;

export function compareCiCommentFindings(left: CiCommentFinding, right: CiCommentFinding): number {
  return (
    LEVEL_PRIORITY[left.level] - LEVEL_PRIORITY[right.level] ||
    CATEGORY_PRIORITY[left.category] - CATEGORY_PRIORITY[right.category] ||
    left.sourceAnnotationId.localeCompare(right.sourceAnnotationId)
  );
}

export function compareCiCommentArtifactLinks(
  left: CiCommentArtifactLink,
  right: CiCommentArtifactLink,
): number {
  return `${left.kind}:${left.label}:${left.url}`.localeCompare(
    `${right.kind}:${right.label}:${right.url}`,
  );
}

export function canonicalizeCiCommentDocument(document: CiCommentDocument): CiCommentDocument {
  return {
    ...document,
    findings: [...document.findings].sort(compareCiCommentFindings),
    artifactLinks: [...document.artifactLinks].sort(compareCiCommentArtifactLinks),
  };
}

export function expectedCiCommentId(document: Omit<CiCommentDocument, 'commentId'>): string {
  return makeCiStableId('ci_comment', document);
}

export function serializeCiCommentDocument(document: CiCommentDocument): string {
  return canonicalStringify(canonicalizeCiCommentDocument(document));
}
