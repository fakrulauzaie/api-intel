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
  type GitHubCommentPublisherTarget,
} from './model.js';
import { assertValidCiCommentPublicationResult } from './schemas.js';

const githubCommentSchema = z.object({
  id: z.number().int().positive(),
  body: z.string(),
  user: z.object({ id: z.number().int().positive(), login: z.string().min(1) }).nullable(),
});
const githubCommentPageSchema = z.array(githubCommentSchema).max(CI_COMMENT_PUBLISHER_PAGE_SIZE);

function hasUpsertMarker(body: string): boolean {
  return body === CI_COMMENT_UPSERT_MARKER || body.startsWith(`${CI_COMMENT_UPSERT_MARKER}\n`);
}

function result(input: Omit<CiCommentPublicationResult, 'schemaVersion' | 'provider'>) {
  return assertValidCiCommentPublicationResult({
    schemaVersion: CI_COMMENT_PUBLISHER_SCHEMA_VERSION,
    provider: 'github',
    ...input,
  });
}

export async function publishGitHubCiComment(input: {
  readonly comment: unknown;
  readonly evaluation: unknown;
  readonly target: GitHubCommentPublisherTarget;
  readonly token: string;
  readonly runtime?: CiCommentPublisherRuntimeOptions;
}): Promise<CiCommentPublicationResult> {
  const evaluation = assertValidCiEvaluationDocument(input.evaluation);
  const comment = assertCiCommentMatchesEvaluation(input.comment, evaluation);
  const body = renderCiCommentMarkdown(comment);
  const provider = 'github' as const;
  assertPublisherSourceBinding(
    provider,
    evaluation,
    input.target.expectedBaselineRevision,
    input.target.expectedCandidateRevision,
  );
  const owner = normalizedPublisherIdentifier(provider, input.target.owner, 'owner', 100);
  const repository = normalizedPublisherIdentifier(
    provider,
    input.target.repository,
    'repository',
    100,
  );
  if (owner.includes('/') || repository.includes('/')) {
    throw new CiCommentPublisherError({
      code: 'INVALID_CONFIGURATION',
      provider,
      message: 'GitHub owner and repository must each be one path segment.',
    });
  }
  const pullRequestNumber = normalizedPublisherInteger(
    provider,
    input.target.pullRequestNumber,
    'pullRequestNumber',
  );
  const expectedBotUserId = normalizedPublisherInteger(
    provider,
    input.target.expectedBotUserId,
    'expectedBotUserId',
  );
  const token = normalizedPublisherToken(provider, input.token);
  const base = normalizedApiBaseUrl(provider, input.target.apiBaseUrl ?? 'https://api.github.com');
  const context = publisherRequestContext(provider, input.runtime ?? {});
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'api-intel-ci-comment-publisher',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const issuePath = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/${pullRequestNumber}`;
  const ownedMatches: z.infer<typeof githubCommentSchema>[] = [];
  let pagesScanned = 0;
  let listStatus = 200;
  for (let page = 1; page <= context.maxPages; page += 1) {
    const query = new URLSearchParams({
      per_page: String(CI_COMMENT_PUBLISHER_PAGE_SIZE),
      page: String(page),
    });
    const response = await requestPublisherJson(context, {
      url: publisherApiUrl(base, `${issuePath}/comments`, query),
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
        targetKey: `${owner}/${repository}#${pullRequestNumber}`,
        providerCommentId: null,
        providerStatus: response.status,
        pagesScanned,
      });
    }
    const comments = githubCommentPageSchema.safeParse(response.value);
    if (!comments.success) {
      throw new CiCommentPublisherError({
        code: 'PROVIDER_RESPONSE_INVALID',
        provider,
        status: response.status,
        message: 'GitHub issue-comment response has an invalid shape.',
      });
    }
    ownedMatches.push(
      ...comments.data.filter(
        (candidate) => candidate.user?.id === expectedBotUserId && hasUpsertMarker(candidate.body),
      ),
    );
    if (comments.data.length < CI_COMMENT_PUBLISHER_PAGE_SIZE) break;
    if (page === context.maxPages) {
      throw new CiCommentPublisherError({
        code: 'PAGINATION_LIMIT',
        provider,
        status: response.status,
        message: 'GitHub comment pagination ceiling was reached before exhaustion.',
      });
    }
  }
  if (ownedMatches.length > 1) {
    throw new CiCommentPublisherError({
      code: 'AMBIGUOUS_UPSERT_TARGET',
      provider,
      status: listStatus,
      message: 'Multiple bot-owned API Intelligence comments share the upsert marker.',
    });
  }
  const existing = ownedMatches[0];
  if (existing !== undefined && existing.body === body) {
    return result({
      outcome: 'unchanged',
      evaluationId: evaluation.evaluationId,
      commentDocumentId: comment.commentId,
      targetKey: `${owner}/${repository}#${pullRequestNumber}`,
      providerCommentId: existing.id,
      providerStatus: listStatus,
      pagesScanned,
    });
  }
  const response = await requestPublisherJson(context, {
    url:
      existing === undefined
        ? publisherApiUrl(base, `${issuePath}/comments`)
        : publisherApiUrl(
            base,
            `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/comments/${existing.id}`,
          ),
    method: existing === undefined ? 'POST' : 'PATCH',
    headers,
    body: JSON.stringify({ body }),
    expectedStatus: existing === undefined ? 201 : 200,
  });
  if (response.state === 'permission_unavailable') {
    return result({
      outcome: 'permission_unavailable',
      evaluationId: evaluation.evaluationId,
      commentDocumentId: comment.commentId,
      targetKey: `${owner}/${repository}#${pullRequestNumber}`,
      providerCommentId: null,
      providerStatus: response.status,
      pagesScanned,
    });
  }
  const published = githubCommentSchema.safeParse(response.value);
  if (!published.success) {
    throw new CiCommentPublisherError({
      code: 'PROVIDER_RESPONSE_INVALID',
      provider,
      status: response.status,
      message: 'GitHub comment mutation response has an invalid shape.',
    });
  }
  if (published.data.user?.id !== expectedBotUserId) {
    throw new CiCommentPublisherError({
      code: 'BOT_IDENTITY_MISMATCH',
      provider,
      status: response.status,
      message: 'GitHub mutation response does not belong to the configured bot identity.',
    });
  }
  return result({
    outcome: existing === undefined ? 'created' : 'updated',
    evaluationId: evaluation.evaluationId,
    commentDocumentId: comment.commentId,
    targetKey: `${owner}/${repository}#${pullRequestNumber}`,
    providerCommentId: published.data.id,
    providerStatus: response.status,
    pagesScanned,
  });
}
