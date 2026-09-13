import type { CiCommentPublisherProvider } from './model.js';

export const CI_COMMENT_PUBLISHER_ERROR_CODES = [
  'INVALID_CONFIGURATION',
  'SOURCE_BINDING_MISMATCH',
  'REQUEST_FAILED',
  'REQUEST_ABORTED',
  'PROVIDER_RESPONSE_INVALID',
  'PROVIDER_RESPONSE_TOO_LARGE',
  'PROVIDER_STATUS_UNEXPECTED',
  'PAGINATION_LIMIT',
  'AMBIGUOUS_UPSERT_TARGET',
  'BOT_IDENTITY_MISMATCH',
] as const;
export type CiCommentPublisherErrorCode = (typeof CI_COMMENT_PUBLISHER_ERROR_CODES)[number];

export class CiCommentPublisherError extends Error {
  readonly code: CiCommentPublisherErrorCode;
  readonly provider: CiCommentPublisherProvider;
  readonly status: number | null;

  constructor(input: {
    readonly code: CiCommentPublisherErrorCode;
    readonly provider: CiCommentPublisherProvider;
    readonly message: string;
    readonly status?: number | null;
  }) {
    super(input.message);
    this.name = 'CiCommentPublisherError';
    this.code = input.code;
    this.provider = input.provider;
    this.status = input.status ?? null;
  }
}
