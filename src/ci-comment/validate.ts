import { projectCiAnnotations } from '../ci-evaluation/annotations.js';
import type { CiAnnotation, CiEvaluationDocument } from '../ci-evaluation/model.js';
import { assertValidCiEvaluationDocument } from '../ci-evaluation/validate.js';
import {
  canonicalizeCiCommentDocument,
  compareCiCommentFindings,
  expectedCiCommentId,
} from './ordering.js';
import type { CiCommentDocument, CiCommentFinding } from './model.js';
import { sanitizeCiCommentRepositoryPath, sanitizeCiCommentText } from './presentation.js';
import { renderCiCommentMarkdownUnchecked } from './render.js';
import { ciCommentDocumentSchema } from './schemas.js';

export const CI_COMMENT_INTEGRITY_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'IDENTITY_MISMATCH',
  'LIMIT_MISMATCH',
  'DUPLICATE_RECORD',
  'MARKDOWN_SIZE_MISMATCH',
  'EVALUATION_MISMATCH',
] as const;
export type CiCommentIntegrityIssueCode = (typeof CI_COMMENT_INTEGRITY_ISSUE_CODES)[number];

export interface CiCommentIntegrityIssue {
  readonly code: CiCommentIntegrityIssueCode;
  readonly path: string;
  readonly message: string;
}

export type CiCommentValidationResult =
  | { readonly success: true; readonly data: CiCommentDocument }
  | { readonly success: false; readonly issues: readonly CiCommentIntegrityIssue[] };

function expectedFinding(annotation: CiAnnotation): CiCommentFinding {
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

function addLimitIssues(document: CiCommentDocument, issues: CiCommentIntegrityIssue[]): void {
  const { limits } = document;
  const checks: readonly [boolean, string, string][] = [
    [
      limits.includedItems === document.findings.length,
      'limits.includedItems',
      'Included item count does not match findings.',
    ],
    [
      limits.candidateItems === limits.includedItems + limits.omittedItems,
      'limits.candidateItems',
      'Candidate item count does not partition into included and omitted items.',
    ],
    [
      limits.includedItems <= limits.maxItems,
      'limits.maxItems',
      'Included findings exceed the declared item limit.',
    ],
    [
      limits.includedArtifactLinks === document.artifactLinks.length,
      'limits.includedArtifactLinks',
      'Included artifact-link count does not match artifactLinks.',
    ],
    [
      limits.candidateArtifactLinks === limits.includedArtifactLinks + limits.omittedArtifactLinks,
      'limits.candidateArtifactLinks',
      'Candidate artifact-link count does not partition into included and omitted links.',
    ],
    [
      limits.includedArtifactLinks <= limits.maxArtifactLinks,
      'limits.maxArtifactLinks',
      'Included artifact links exceed the declared limit.',
    ],
  ];
  for (const [valid, path, message] of checks) {
    if (!valid) issues.push({ code: 'LIMIT_MISMATCH', path, message });
  }
}

function addDuplicateIssues(document: CiCommentDocument, issues: CiCommentIntegrityIssue[]): void {
  const findingIds = document.findings.map(({ sourceAnnotationId }) => sourceAnnotationId);
  if (new Set(findingIds).size !== findingIds.length) {
    issues.push({
      code: 'DUPLICATE_RECORD',
      path: 'findings',
      message: 'A source annotation may appear at most once.',
    });
  }
  const linkKeys = document.artifactLinks.map(({ kind, url }) => `${kind}:${url}`);
  if (new Set(linkKeys).size !== linkKeys.length) {
    issues.push({
      code: 'DUPLICATE_RECORD',
      path: 'artifactLinks',
      message: 'Artifact kind/URL pairs must be unique.',
    });
  }
}

export function validateCiCommentDocument(input: unknown): CiCommentValidationResult {
  const parsed = ciCommentDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_INVALID',
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  const document = canonicalizeCiCommentDocument(parsed.data);
  const issues: CiCommentIntegrityIssue[] = [];
  addLimitIssues(document, issues);
  addDuplicateIssues(document, issues);

  const { commentId, ...identityInput } = document;
  void commentId;
  if (document.commentId !== expectedCiCommentId(identityInput)) {
    issues.push({
      code: 'IDENTITY_MISMATCH',
      path: 'commentId',
      message: 'Comment ID does not match the canonical bounded projection.',
    });
  }

  const renderedBytes = Buffer.byteLength(renderCiCommentMarkdownUnchecked(document));
  if (
    renderedBytes !== document.limits.renderedMarkdownBytes ||
    renderedBytes > document.limits.maxMarkdownBytes
  ) {
    issues.push({
      code: 'MARKDOWN_SIZE_MISMATCH',
      path: 'limits.renderedMarkdownBytes',
      message: 'Rendered Markdown bytes are incorrect or exceed the declared ceiling.',
    });
  }

  return issues.length === 0
    ? { success: true, data: document }
    : {
        success: false,
        issues: issues.sort((left, right) =>
          `${left.code}:${left.path}`.localeCompare(`${right.code}:${right.path}`),
        ),
      };
}

export class CiCommentIntegrityError extends Error {
  readonly issues: readonly CiCommentIntegrityIssue[];

  constructor(issues: readonly CiCommentIntegrityIssue[]) {
    super(`CI comment integrity validation failed with ${issues.length} issue(s).`);
    this.name = 'CiCommentIntegrityError';
    this.issues = issues;
  }
}

export function assertValidCiCommentDocument(input: unknown): CiCommentDocument {
  const result = validateCiCommentDocument(input);
  if (!result.success) throw new CiCommentIntegrityError(result.issues);
  return result.data;
}

export function validateCiCommentAgainstEvaluation(
  input: unknown,
  evaluationInput: CiEvaluationDocument,
): CiCommentValidationResult {
  const base = validateCiCommentDocument(input);
  if (!base.success) return base;
  const document = base.data;
  const evaluation = assertValidCiEvaluationDocument(evaluationInput);
  const issues: CiCommentIntegrityIssue[] = [];
  const expected = projectCiAnnotations(evaluation)
    .map(expectedFinding)
    .sort(compareCiCommentFindings);

  for (const [valid, path, message] of [
    [document.evaluationId === evaluation.evaluationId, 'evaluationId', 'Evaluation ID differs.'],
    [document.outcome === evaluation.outcome, 'outcome', 'Evaluation outcome differs.'],
    [
      document.candidate.analysisId === evaluation.provenance.candidate.analysisId,
      'candidate.analysisId',
      'Candidate analysis ID differs.',
    ],
    [
      document.candidate.repositoryRevision ===
        (evaluation.provenance.candidate.repositoryRevision === null
          ? null
          : sanitizeCiCommentText(evaluation.provenance.candidate.repositoryRevision, 256)),
      'candidate.repositoryRevision',
      'Candidate revision differs.',
    ],
    [
      JSON.stringify(document.summary) === JSON.stringify(evaluation.summary),
      'summary',
      'Comment summary differs from the evaluation.',
    ],
    [
      document.limits.candidateItems === expected.length,
      'limits.candidateItems',
      'Candidate item count differs from the projected annotations.',
    ],
    [
      JSON.stringify(document.findings) ===
        JSON.stringify(expected.slice(0, document.findings.length)),
      'findings',
      'Findings are not the deterministic highest-priority evaluation projection.',
    ],
  ] as const) {
    if (!valid) issues.push({ code: 'EVALUATION_MISMATCH', path, message });
  }
  return issues.length === 0 ? base : { success: false, issues };
}

export function assertCiCommentMatchesEvaluation(
  input: unknown,
  evaluation: CiEvaluationDocument,
): CiCommentDocument {
  const result = validateCiCommentAgainstEvaluation(input, evaluation);
  if (!result.success) throw new CiCommentIntegrityError(result.issues);
  return result.data;
}
