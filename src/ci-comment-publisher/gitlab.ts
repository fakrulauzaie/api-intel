import { z } from 'zod';
import { renderCiCommentMarkdown } from '../ci-comment/markdown.js';
import { CI_COMMENT_UPSERT_MARKER } from '../ci-comment/model.js';
import { assertCiCommentMatchesEvaluation } from '../ci-comment/validate.js';
import { assertValidCiEvaluationDocument } from '../ci-evaluation/validate.js';
import { CiCommentPublisherError } from './errors.js';
import {
  assertPublisherSourceBinding,
  normalizedApiBaseUrl,
  normalizedPublisherIdentifier,
  normalizedPublisherInteger,
  normalizedPublisherToken,
  publisherApiUrl,
  publisherRequestContext,
  requestPublisherJson,
} from './http.js';
import {
  CI_COMMENT_PUBLISHER_PAGE_SIZE,
  CI_COMMENT_PUBLISHER_SCHEMA_VERSION,
  type CiCommentPublicationResult,
  type CiCommentPublisherRuntimeOptions,
  type GitLabCommentPublisherTarget,
} from './model.js';
import { assertValidCiCommentPublicationResult } from './schemas.js';

const gitLabNoteSchema = z.object({
  id: z.number().int().positive(),
  body: z.string(),
  system: z.boolean().optional().default(false),
  author: z.object({ id: z.number().int().positive(), username: z.string().min(1) }),
});
const gitLabNotePageSchema = z.array(gitLabNoteSchema).max(CI_COMMENT_PUBLISHER_PAGE_SIZE);

function hasUpsertMarker(body: string): boolean {
  return body === CI_COMMENT_UPSERT_MARKER || body.startsWith(`${CI_COMMENT_UPSERT_MARKER}\n`);
}

function result(input: Omit<CiCommentPublicationResult, 'schemaVersion' | 'provider'>) {
  return assertValidCiCommentPublicationResult({
    schemaVersion: CI_COMMENT_PUBLISHER_SCHEMA_VERSION,
    provider: 'gitlab',
    ...input,
  });
}

export async function publishGitLabCiComment(input: {
  readonly comment: unknown;
  readonly evaluation: unknown;
  readonly target: GitLabCommentPublisherTarget;
  readonly token: string;
  readonly runtime?: CiCommentPublisherRuntimeOptions;
}): Promise<CiCommentPublicationResult> {
  const evaluation = assertValidCiEvaluationDocument(input.evaluation);
  const comment = assertCiCommentMatchesEvaluation(input.comment, evaluation);
  const body = renderCiCommentMarkdown(comment);
  const provider = 'gitlab' as const;
  assertPublisherSourceBinding(
    provider,
    evaluation,
    input.target.expectedBaselineRevision,
    input.target.expectedCandidateRevision,
  );
  const projectId = normalizedPublisherIdentifier(
    provider,
    input.target.projectId,
    'projectId',
    256,
  );
  const mergeRequestIid = normalizedPublisherInteger(
    provider,
    input.target.mergeRequestIid,
    'mergeRequestIid',
  );
  const expectedBotUserId = normalizedPublisherInteger(
    provider,
    input.target.expectedBotUserId,
    'expectedBotUserId',
  );
  const token = normalizedPublisherToken(provider, input.token);
  const base = normalizedApiBaseUrl(
    provider,
    input.target.apiBaseUrl ?? 'https://gitlab.com/api/v4',
  );
  const context = publisherRequestContext(provider, input.runtime ?? {});
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'PRIVATE-TOKEN': token,
    'User-Agent': 'api-intel-ci-comment-publisher',
  };
  const notePath = `projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestIid}/notes`;
  const targetKey = `${projectId}!${mergeRequestIid}`;
  const ownedMatches: z.infer<typeof gitLabNoteSchema>[] = [];
  let pagesScanned = 0;
  let listStatus = 200;
  for (let page = 1; page <= context.maxPages; page += 1) {
    const query = new URLSearchParams({
      per_page: String(CI_COMMENT_PUBLISHER_PAGE_SIZE),
      page: String(page),
      sort: 'asc',
      order_by: 'created_at',
    });
    const response = await requestPublisherJson(context, {
      url: publisherApiUrl(base, notePath, query),
      method: 'GET',
      headers,
      expectedStatus: 200,
    });
    pagesScanned += 1;
    listStatus = response.status;
    if (response.state === 'permission_unavailable') {
      return result({
        outcome: 'permission_unavailable',
        evaluationId: evaluation.evaluationId,
        commentDocumentId: comment.commentId,
        targetKey,
        providerCommentId: null,
        providerStatus: response.status,
        pagesScanned,
      });
    }
    const notes = gitLabNotePageSchema.safeParse(response.value);
    if (!notes.success) {
      throw new CiCommentPublisherError({
        code: 'PROVIDER_RESPONSE_INVALID',
        provider,
        status: response.status,
        message: 'GitLab merge-request note response has an invalid shape.',
      });
    }
    ownedMatches.push(
      ...notes.data.filter(
        (candidate) =>
          !candidate.system &&
          candidate.author.id === expectedBotUserId &&
          hasUpsertMarker(candidate.body),
      ),
    );
    if (notes.data.length < CI_COMMENT_PUBLISHER_PAGE_SIZE) break;
    if (page === context.maxPages) {
      throw new CiCommentPublisherError({
        code: 'PAGINATION_LIMIT',
        provider,
        status: response.status,
        message: 'GitLab note pagination ceiling was reached before exhaustion.',
      });
    }
  }
  if (ownedMatches.length > 1) {
    throw new CiCommentPublisherError({
      code: 'AMBIGUOUS_UPSERT_TARGET',
      provider,
      status: listStatus,
      message: 'Multiple bot-owned API Intelligence notes share the upsert marker.',
    });
  }
  const existing = ownedMatches[0];
  if (existing !== undefined && existing.body === body) {
    return result({
      outcome: 'unchanged',
      evaluationId: evaluation.evaluationId,
      commentDocumentId: comment.commentId,
      targetKey,
      providerCommentId: existing.id,
      providerStatus: listStatus,
      pagesScanned,
    });
  }
  const response = await requestPublisherJson(context, {
    url:
      existing === undefined
        ? publisherApiUrl(base, notePath)
        : publisherApiUrl(base, `${notePath}/${existing.id}`),
    method: existing === undefined ? 'POST' : 'PUT',
    headers,
    body: JSON.stringify({ body }),
    expectedStatus: existing === undefined ? 201 : 200,
  });
  if (response.state === 'permission_unavailable') {
    return result({
      outcome: 'permission_unavailable',
      evaluationId: evaluation.evaluationId,
      commentDocumentId: comment.commentId,
      targetKey,
      providerCommentId: null,
      providerStatus: response.status,
      pagesScanned,
    });
  }
  const published = gitLabNoteSchema.safeParse(response.value);
  if (!published.success) {
    throw new CiCommentPublisherError({
      code: 'PROVIDER_RESPONSE_INVALID',
      provider,
      status: response.status,
      message: 'GitLab note mutation response has an invalid shape.',
    });
  }
  if (published.data.author.id !== expectedBotUserId || published.data.system) {
    throw new CiCommentPublisherError({
      code: 'BOT_IDENTITY_MISMATCH',
      provider,
      status: response.status,
      message: 'GitLab mutation response does not belong to the configured bot identity.',
    });
  }
  return result({
    outcome: existing === undefined ? 'created' : 'updated',
    evaluationId: evaluation.evaluationId,
    commentDocumentId: comment.commentId,
    targetKey,
    providerCommentId: published.data.id,
    providerStatus: response.status,
    pagesScanned,
  });
}
