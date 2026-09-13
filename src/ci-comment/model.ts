import type {
  CiAnnotationCategory,
  CiAnnotationLevel,
  CiEvaluationOutcome,
  CiEvaluationSummary,
  CiEvidenceSide,
} from '../ci-evaluation/model.js';

export const CI_COMMENT_SCHEMA_VERSION = '1.0.0' as const;
export const CI_COMMENT_UPSERT_KEY = 'api-intel-ci-evaluation' as const;
export const CI_COMMENT_UPSERT_MARKER = '<!-- api-intel:ci-evaluation:v1 -->' as const;

export const CI_COMMENT_PROVIDERS = ['github', 'gitlab', 'generic'] as const;
export type CiCommentProvider = (typeof CI_COMMENT_PROVIDERS)[number];

export const CI_COMMENT_ARTIFACT_KINDS = [
  'bundle',
  'evaluation',
  'analysis',
  'comparison',
  'impact',
  'policy_results',
  'graph',
  'annotations',
  'logs',
] as const;
export type CiCommentArtifactKind = (typeof CI_COMMENT_ARTIFACT_KINDS)[number];

export const CI_COMMENT_DEFAULT_MAX_ITEMS = 20;
export const CI_COMMENT_HARD_MAX_ITEMS = 50;
export const CI_COMMENT_DEFAULT_MAX_ARTIFACT_LINKS = 8;
export const CI_COMMENT_HARD_MAX_ARTIFACT_LINKS = 20;
export const CI_COMMENT_MAX_INPUT_ARTIFACT_LINKS = 100;
export const CI_COMMENT_MIN_MARKDOWN_BYTES = 8_192;
export const CI_COMMENT_MAX_MARKDOWN_BYTES = 60_000;
export const CI_COMMENT_MAX_URL_BYTES = 2_048;

export interface CiCommentRunIdentity {
  readonly provider: CiCommentProvider;
  readonly id: string;
  readonly url: string;
}

export interface CiCommentArtifactLink {
  readonly kind: CiCommentArtifactKind;
  readonly label: string;
  readonly url: string;
}

export interface CiCommentFindingLocation {
  readonly side: CiEvidenceSide;
  readonly path: string;
  readonly startLine: number;
}

export interface CiCommentFinding {
  readonly sourceAnnotationId: string;
  readonly category: CiAnnotationCategory;
  readonly level: CiAnnotationLevel;
  readonly title: string;
  readonly message: string;
  readonly location: CiCommentFindingLocation | null;
}

export interface CiCommentLimits {
  readonly maxItems: number;
  readonly maxArtifactLinks: number;
  readonly maxMarkdownBytes: number;
  readonly candidateItems: number;
  readonly includedItems: number;
  readonly omittedItems: number;
  readonly candidateArtifactLinks: number;
  readonly includedArtifactLinks: number;
  readonly omittedArtifactLinks: number;
  readonly renderedMarkdownBytes: number;
}

export interface CiCommentDocument {
  readonly schemaVersion: typeof CI_COMMENT_SCHEMA_VERSION;
  readonly commentId: string;
  readonly upsert: {
    readonly key: typeof CI_COMMENT_UPSERT_KEY;
    readonly marker: typeof CI_COMMENT_UPSERT_MARKER;
  };
  readonly evaluationId: string;
  readonly outcome: CiEvaluationOutcome;
  readonly run: CiCommentRunIdentity;
  readonly candidate: {
    readonly analysisId: string;
    readonly repositoryRevision: string | null;
  };
  readonly summary: CiEvaluationSummary;
  readonly findings: readonly CiCommentFinding[];
  readonly artifactLinks: readonly CiCommentArtifactLink[];
  readonly limits: CiCommentLimits;
}

export interface CiCommentProjectionLimits {
  readonly maxItems?: number;
  readonly maxArtifactLinks?: number;
  readonly maxMarkdownBytes?: number;
}
