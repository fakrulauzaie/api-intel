export const CI_COMMENT_PUBLISHER_SCHEMA_VERSION = '1.0.0' as const;
export const CI_COMMENT_PUBLISHER_PROVIDERS = ['github', 'gitlab'] as const;
export type CiCommentPublisherProvider = (typeof CI_COMMENT_PUBLISHER_PROVIDERS)[number];

export const CI_COMMENT_PUBLICATION_OUTCOMES = [
  'created',
  'updated',
  'unchanged',
  'permission_unavailable',
] as const;
export type CiCommentPublicationOutcome = (typeof CI_COMMENT_PUBLICATION_OUTCOMES)[number];

export const CI_COMMENT_PUBLISHER_MAX_PAGES = 10;
export const CI_COMMENT_PUBLISHER_PAGE_SIZE = 100;
export const CI_COMMENT_PUBLISHER_MAX_RESPONSE_BYTES = 1_048_576;
export const CI_COMMENT_PUBLISHER_DEFAULT_TIMEOUT_MS = 15_000;
export const CI_COMMENT_PUBLISHER_MIN_TIMEOUT_MS = 1_000;
export const CI_COMMENT_PUBLISHER_MAX_TIMEOUT_MS = 30_000;

export interface CiCommentPublicationResult {
  readonly schemaVersion: typeof CI_COMMENT_PUBLISHER_SCHEMA_VERSION;
  readonly provider: CiCommentPublisherProvider;
  readonly outcome: CiCommentPublicationOutcome;
  readonly evaluationId: string;
  readonly commentDocumentId: string;
  readonly targetKey: string;
  readonly providerCommentId: number | null;
  readonly providerStatus: number;
  readonly pagesScanned: number;
}

export interface CiCommentPublisherRuntimeOptions {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly maxPages?: number;
  readonly timeoutMs?: number;
}

export interface GitHubCommentPublisherTarget {
  readonly apiBaseUrl?: string;
  readonly owner: string;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly expectedBotUserId: number;
  readonly expectedBaselineRevision: string;
  readonly expectedCandidateRevision: string;
}

export interface GitLabCommentPublisherTarget {
  readonly apiBaseUrl?: string;
  readonly projectId: string;
  readonly mergeRequestIid: number;
  readonly expectedBotUserId: number;
  readonly expectedBaselineRevision: string;
  readonly expectedCandidateRevision: string;
}
