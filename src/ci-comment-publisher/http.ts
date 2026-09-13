import type { CiEvaluationDocument } from '../ci-evaluation/model.js';
import type { CiCommentPublisherErrorCode } from './errors.js';
import { CiCommentPublisherError } from './errors.js';
import {
  CI_COMMENT_PUBLISHER_DEFAULT_TIMEOUT_MS,
  CI_COMMENT_PUBLISHER_MAX_PAGES,
  CI_COMMENT_PUBLISHER_MAX_RESPONSE_BYTES,
  CI_COMMENT_PUBLISHER_MAX_TIMEOUT_MS,
  CI_COMMENT_PUBLISHER_MIN_TIMEOUT_MS,
  type CiCommentPublisherProvider,
  type CiCommentPublisherRuntimeOptions,
} from './model.js';

export interface PublisherRequestContext {
  readonly provider: CiCommentPublisherProvider;
  readonly fetch: typeof fetch;
  readonly signal: AbortSignal;
  readonly maxPages: number;
}

export type PublisherJsonResponse =
  | { readonly state: 'ok'; readonly status: number; readonly value: unknown }
  | { readonly state: 'permission_unavailable'; readonly status: number };

function configurationError(
  provider: CiCommentPublisherProvider,
  message: string,
): CiCommentPublisherError {
  return new CiCommentPublisherError({
    code: 'INVALID_CONFIGURATION',
    provider,
    message,
  });
}

export function normalizedPublisherInteger(
  provider: CiCommentPublisherProvider,
  value: number,
  name: string,
): number {
  if (!Number.isInteger(value) || value < 1) {
    throw configurationError(provider, `${name} must be a positive integer.`);
  }
  return value;
}

export function normalizedPublisherIdentifier(
  provider: CiCommentPublisherProvider,
  value: string,
  name: string,
  maximumBytes: number,
): string {
  if (
    value === '' ||
    value !== value.trim() ||
    Buffer.byteLength(value) > maximumBytes ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw configurationError(provider, `${name} is invalid or exceeds its byte limit.`);
  }
  return value;
}

export function normalizedPublisherToken(
  provider: CiCommentPublisherProvider,
  token: string,
): string {
  return normalizedPublisherIdentifier(provider, token, 'token', 4_096);
}

export function assertPublisherSourceBinding(
  provider: CiCommentPublisherProvider,
  evaluation: CiEvaluationDocument,
  expectedBaselineRevisionInput: string,
  expectedCandidateRevisionInput: string,
): void {
  const expectedBaselineRevision = normalizedPublisherIdentifier(
    provider,
    expectedBaselineRevisionInput,
    'expectedBaselineRevision',
    256,
  );
  const expectedCandidateRevision = normalizedPublisherIdentifier(
    provider,
    expectedCandidateRevisionInput,
    'expectedCandidateRevision',
    256,
  );
  if (
    evaluation.provenance.baseline.repositoryRevision !== expectedBaselineRevision ||
    evaluation.provenance.candidate.repositoryRevision !== expectedCandidateRevision
  ) {
    throw new CiCommentPublisherError({
      code: 'SOURCE_BINDING_MISMATCH',
      provider,
      message: 'Evaluation revisions do not match the trusted provider event.',
    });
  }
}

export function normalizedApiBaseUrl(provider: CiCommentPublisherProvider, value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError(provider, 'API base URL must be an absolute HTTPS URL.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname === '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw configurationError(
      provider,
      'API base URL must be credential-free HTTPS without a query or fragment.',
    );
  }
  return parsed.href.replace(/\/+$/u, '');
}

export function publisherApiUrl(base: string, path: string, query?: URLSearchParams): string {
  const url = `${base}/${path}`;
  return query === undefined || query.size === 0 ? url : `${url}?${query.toString()}`;
}

export function publisherRequestContext(
  provider: CiCommentPublisherProvider,
  options: CiCommentPublisherRuntimeOptions,
): PublisherRequestContext {
  const maxPages = options.maxPages ?? CI_COMMENT_PUBLISHER_MAX_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > CI_COMMENT_PUBLISHER_MAX_PAGES) {
    throw configurationError(
      provider,
      `maxPages must be between 1 and ${CI_COMMENT_PUBLISHER_MAX_PAGES}.`,
    );
  }
  const timeoutMs = options.timeoutMs ?? CI_COMMENT_PUBLISHER_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < CI_COMMENT_PUBLISHER_MIN_TIMEOUT_MS ||
    timeoutMs > CI_COMMENT_PUBLISHER_MAX_TIMEOUT_MS
  ) {
    throw configurationError(
      provider,
      `timeoutMs must be between ${CI_COMMENT_PUBLISHER_MIN_TIMEOUT_MS} and ${CI_COMMENT_PUBLISHER_MAX_TIMEOUT_MS}.`,
    );
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return {
    provider,
    fetch: options.fetch ?? globalThis.fetch,
    signal:
      options.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([options.signal, timeoutSignal]),
    maxPages,
  };
}

async function boundedResponseText(
  context: PublisherRequestContext,
  response: Response,
): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > CI_COMMENT_PUBLISHER_MAX_RESPONSE_BYTES
  ) {
    throw new CiCommentPublisherError({
      code: 'PROVIDER_RESPONSE_TOO_LARGE',
      provider: context.provider,
      status: response.status,
      message: 'Provider response exceeds the fixed byte ceiling.',
    });
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CI_COMMENT_PUBLISHER_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new CiCommentPublisherError({
          code: 'PROVIDER_RESPONSE_TOO_LARGE',
          provider: context.provider,
          status: response.status,
          message: 'Provider response exceeds the fixed byte ceiling.',
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function requestError(
  provider: CiCommentPublisherProvider,
  code: CiCommentPublisherErrorCode,
  message: string,
): CiCommentPublisherError {
  return new CiCommentPublisherError({ code, provider, message });
}

export async function requestPublisherJson(
  context: PublisherRequestContext,
  input: {
    readonly url: string;
    readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT';
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly expectedStatus: number;
  },
): Promise<PublisherJsonResponse> {
  let response: Response;
  try {
    const request: RequestInit = {
      method: input.method,
      headers: input.headers,
      redirect: 'error',
      signal: context.signal,
    };
    if (input.body !== undefined) {
      request.body = input.body;
    }
    response = await context.fetch(input.url, request);
  } catch (error) {
    const aborted =
      context.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    throw requestError(
      context.provider,
      aborted ? 'REQUEST_ABORTED' : 'REQUEST_FAILED',
      aborted ? 'Provider request was canceled or timed out.' : 'Provider request failed.',
    );
  }
  if ([401, 403, 404].includes(response.status)) {
    return { state: 'permission_unavailable', status: response.status };
  }
  if (response.status !== input.expectedStatus) {
    throw new CiCommentPublisherError({
      code: 'PROVIDER_STATUS_UNEXPECTED',
      provider: context.provider,
      status: response.status,
      message: `Provider returned unexpected HTTP status ${response.status}.`,
    });
  }
  let text: string;
  try {
    text = await boundedResponseText(context, response);
  } catch (error) {
    if (error instanceof CiCommentPublisherError) throw error;
    throw requestError(
      context.provider,
      'PROVIDER_RESPONSE_INVALID',
      'Provider response could not be decoded as UTF-8.',
    );
  }
  try {
    return { state: 'ok', status: response.status, value: JSON.parse(text) as unknown };
  } catch {
    throw requestError(
      context.provider,
      'PROVIDER_RESPONSE_INVALID',
      'Provider response is not valid JSON.',
    );
  }
}
