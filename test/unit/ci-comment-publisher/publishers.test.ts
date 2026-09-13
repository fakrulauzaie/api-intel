import { describe, expect, it } from 'vitest';
import {
  CI_COMMENT_UPSERT_MARKER,
  projectCiComment,
  renderCiCommentMarkdown,
  type CiCommentDocument,
} from '../../../src/ci-comment/index.js';
import {
  CiCommentPublisherError,
  publishGitHubCiComment,
  publishGitLabCiComment,
} from '../../../src/ci-comment-publisher/index.js';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import {
  evaluateCiArtifacts,
  type CiEvaluationDocument,
} from '../../../src/ci-evaluation/index.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function evaluation(): CiEvaluationDocument {
  const baseline = createComparisonAnalysisSnapshot('before');
  const candidate = createComparisonAnalysisSnapshot('after');
  return evaluateCiArtifacts({
    baseline,
    candidate,
    comparison: compareAnalysisDocuments(baseline, candidate),
    impact: analyzePotentialImpact(baseline, candidate),
    policyResults: evaluatePolicies({
      analysis: candidate,
      baseline,
      configuration: normalizePolicyConfiguration({
        version: 1,
        rules: {
          'no-new-diagnostics': ['error', { minimumSeverity: 'warning', onUnknown: 'error' }],
        },
      }),
    }),
  });
}

function comment(source: CiEvaluationDocument): CiCommentDocument {
  return projectCiComment({
    evaluation: source,
    run: { provider: 'generic', id: 'run-42', url: 'https://ci.example.test/runs/42' },
    artifactLinks: [
      {
        kind: 'bundle',
        label: 'Complete evidence bundle',
        url: 'https://ci.example.test/runs/42/artifacts/evidence',
      },
    ],
  });
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers?: Readonly<Record<string, string>>,
): Response {
  return new Response(
    JSON.stringify(value),
    headers === undefined ? { status } : { status, headers },
  );
}

function scriptedFetch(responses: readonly Response[]): {
  readonly fetch: typeof fetch;
  readonly requests: CapturedRequest[];
} {
  const remaining = [...responses];
  const requests: CapturedRequest[] = [];
  const fetchImplementation = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    requests.push({ url: String(input), init });
    const next = remaining.shift();
    if (next === undefined) throw new Error('Unexpected provider request.');
    return next;
  };
  return { fetch: fetchImplementation as typeof fetch, requests };
}

function githubInput(
  source: CiEvaluationDocument,
  document: CiCommentDocument,
  fetch: typeof globalThis.fetch,
) {
  return {
    evaluation: source,
    comment: document,
    token: 'github-test-token',
    target: {
      owner: 'api-intel',
      repository: 'service',
      pullRequestNumber: 17,
      expectedBotUserId: 701,
      expectedBaselineRevision: source.provenance.baseline.repositoryRevision!,
      expectedCandidateRevision: source.provenance.candidate.repositoryRevision!,
    },
    runtime: { fetch },
  } as const;
}

function gitlabInput(
  source: CiEvaluationDocument,
  document: CiCommentDocument,
  fetch: typeof globalThis.fetch,
) {
  return {
    evaluation: source,
    comment: document,
    token: 'gitlab-test-token',
    target: {
      projectId: 'platform/services/tickets',
      mergeRequestIid: 23,
      expectedBotUserId: 801,
      expectedBaselineRevision: source.provenance.baseline.repositoryRevision!,
      expectedCandidateRevision: source.provenance.candidate.repositoryRevision!,
    },
    runtime: { fetch },
  } as const;
}

function publisherErrorCode(error: unknown): string | undefined {
  return error instanceof CiCommentPublisherError ? error.code : undefined;
}

describe('Phase P5.2 GitHub privileged publisher', () => {
  it('updates exactly one bot-owned marker while ignoring an attacker-owned copy', async () => {
    const source = evaluation();
    const document = comment(source);
    const body = renderCiCommentMarkdown(document);
    const scripted = scriptedFetch([
      jsonResponse([
        { id: 1, body: `${CI_COMMENT_UPSERT_MARKER}\nattacker`, user: { id: 999, login: 'user' } },
        { id: 7, body: `${CI_COMMENT_UPSERT_MARKER}\nold`, user: { id: 701, login: 'bot' } },
      ]),
      jsonResponse({ id: 7, body, user: { id: 701, login: 'bot' } }),
    ]);

    const result = await publishGitHubCiComment(githubInput(source, document, scripted.fetch));

    expect(result).toEqual({
      schemaVersion: '1.0.0',
      provider: 'github',
      outcome: 'updated',
      evaluationId: source.evaluationId,
      commentDocumentId: document.commentId,
      targetKey: 'api-intel/service#17',
      providerCommentId: 7,
      providerStatus: 200,
      pagesScanned: 1,
    });
    expect(scripted.requests).toHaveLength(2);
    expect(scripted.requests[0]?.url).toBe(
      'https://api.github.com/repos/api-intel/service/issues/17/comments?per_page=100&page=1',
    );
    expect(scripted.requests[1]?.url).toBe(
      'https://api.github.com/repos/api-intel/service/issues/comments/7',
    );
    expect(scripted.requests[1]?.init).toMatchObject({
      method: 'PATCH',
      redirect: 'error',
      headers: { Authorization: 'Bearer github-test-token' },
      body: JSON.stringify({ body }),
    });
    expect(JSON.stringify(result)).not.toContain('github-test-token');
  });

  it('returns unchanged without a mutation when the owned body is exact', async () => {
    const source = evaluation();
    const document = comment(source);
    const scripted = scriptedFetch([
      jsonResponse([
        {
          id: 8,
          body: renderCiCommentMarkdown(document),
          user: { id: 701, login: 'bot' },
        },
      ]),
    ]);

    const result = await publishGitHubCiComment(githubInput(source, document, scripted.fetch));

    expect(result.outcome).toBe('unchanged');
    expect(result.providerCommentId).toBe(8);
    expect(scripted.requests).toHaveLength(1);
  });

  it('creates when no bot-owned marker exists and verifies mutation ownership', async () => {
    const source = evaluation();
    const document = comment(source);
    const body = renderCiCommentMarkdown(document);
    const scripted = scriptedFetch([
      jsonResponse([
        { id: 3, body: `${CI_COMMENT_UPSERT_MARKER}\ncopy`, user: { id: 999, login: 'user' } },
      ]),
      jsonResponse({ id: 9, body, user: { id: 701, login: 'bot' } }, 201),
    ]);

    const result = await publishGitHubCiComment(githubInput(source, document, scripted.fetch));

    expect(result.outcome).toBe('created');
    expect(scripted.requests[1]?.init?.method).toBe('POST');
    expect(scripted.requests[1]?.url).toBe(
      'https://api.github.com/repos/api-intel/service/issues/17/comments',
    );
  });

  it('fails closed before mutation for duplicate owned markers or exhausted pagination', async () => {
    const source = evaluation();
    const document = comment(source);
    const duplicate = scriptedFetch([
      jsonResponse([
        { id: 4, body: CI_COMMENT_UPSERT_MARKER, user: { id: 701, login: 'bot' } },
        { id: 5, body: CI_COMMENT_UPSERT_MARKER, user: { id: 701, login: 'bot' } },
      ]),
    ]);

    await expect(
      publishGitHubCiComment(githubInput(source, document, duplicate.fetch)),
    ).rejects.toSatisfy(
      (error: unknown) => publisherErrorCode(error) === 'AMBIGUOUS_UPSERT_TARGET',
    );
    expect(duplicate.requests).toHaveLength(1);

    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: 'ordinary comment',
      user: { id: 999, login: 'user' },
    }));
    const paginated = scriptedFetch(Array.from({ length: 10 }, () => jsonResponse(fullPage)));
    await expect(
      publishGitHubCiComment(githubInput(source, document, paginated.fetch)),
    ).rejects.toSatisfy((error: unknown) => publisherErrorCode(error) === 'PAGINATION_LIMIT');
    expect(paginated.requests).toHaveLength(10);
  });

  it('maps unavailable comment permission to a nonblocking publication outcome', async () => {
    const source = evaluation();
    const document = comment(source);
    const scripted = scriptedFetch([jsonResponse({ message: 'forbidden' }, 403)]);

    const result = await publishGitHubCiComment(githubInput(source, document, scripted.fetch));

    expect(result).toMatchObject({
      provider: 'github',
      outcome: 'permission_unavailable',
      providerCommentId: null,
      providerStatus: 403,
    });
  });
});

describe('Phase P5.2 GitLab privileged publisher', () => {
  it('updates one non-system bot note using an encoded project path', async () => {
    const source = evaluation();
    const document = comment(source);
    const body = renderCiCommentMarkdown(document);
    const scripted = scriptedFetch([
      jsonResponse([
        {
          id: 10,
          body: `${CI_COMMENT_UPSERT_MARKER}\nsystem copy`,
          system: true,
          author: { id: 801, username: 'bot' },
        },
        {
          id: 11,
          body: `${CI_COMMENT_UPSERT_MARKER}\nold`,
          system: false,
          author: { id: 801, username: 'bot' },
        },
      ]),
      jsonResponse({
        id: 11,
        body,
        system: false,
        author: { id: 801, username: 'bot' },
      }),
    ]);

    const result = await publishGitLabCiComment(gitlabInput(source, document, scripted.fetch));

    expect(result).toMatchObject({
      provider: 'gitlab',
      outcome: 'updated',
      targetKey: 'platform/services/tickets!23',
      providerCommentId: 11,
    });
    expect(scripted.requests[0]?.url).toBe(
      'https://gitlab.com/api/v4/projects/platform%2Fservices%2Ftickets/merge_requests/23/notes?per_page=100&page=1&sort=asc&order_by=created_at',
    );
    expect(scripted.requests[1]?.url).toBe(
      'https://gitlab.com/api/v4/projects/platform%2Fservices%2Ftickets/merge_requests/23/notes/11',
    );
    expect(scripted.requests[1]?.init).toMatchObject({
      method: 'PUT',
      headers: { 'PRIVATE-TOKEN': 'gitlab-test-token' },
    });
  });

  it('creates a note and degrades on masked not-found permission failures', async () => {
    const source = evaluation();
    const document = comment(source);
    const body = renderCiCommentMarkdown(document);
    const create = scriptedFetch([
      jsonResponse([]),
      jsonResponse({ id: 12, body, system: false, author: { id: 801, username: 'bot' } }, 201),
    ]);

    await expect(
      publishGitLabCiComment(gitlabInput(source, document, create.fetch)),
    ).resolves.toMatchObject({ outcome: 'created', providerCommentId: 12 });

    const unavailable = scriptedFetch([jsonResponse({ message: 'not found' }, 404)]);
    await expect(
      publishGitLabCiComment(gitlabInput(source, document, unavailable.fetch)),
    ).resolves.toMatchObject({
      outcome: 'permission_unavailable',
      providerCommentId: null,
      providerStatus: 404,
    });
  });
});

describe('Phase P5.2 publisher trust and transport limits', () => {
  it('rejects source-mismatched comments and unsafe trusted configuration before fetch', async () => {
    const source = evaluation();
    const document = comment(source);
    const never = scriptedFetch([]);
    const tampered = {
      ...document,
      summary: { ...document.summary, gaps: document.summary.gaps + 1 },
    };

    await expect(
      publishGitHubCiComment(githubInput(source, tampered as CiCommentDocument, never.fetch)),
    ).rejects.toThrow('CI comment integrity validation failed');
    await expect(
      publishGitLabCiComment({
        ...gitlabInput(source, document, never.fetch),
        target: {
          ...gitlabInput(source, document, never.fetch).target,
          apiBaseUrl: 'http://gitlab.example.test/api/v4',
        },
      }),
    ).rejects.toSatisfy((error: unknown) => publisherErrorCode(error) === 'INVALID_CONFIGURATION');
    await expect(
      publishGitHubCiComment({
        ...githubInput(source, document, never.fetch),
        target: {
          ...githubInput(source, document, never.fetch).target,
          expectedCandidateRevision: 'different-candidate',
        },
      }),
    ).rejects.toSatisfy(
      (error: unknown) => publisherErrorCode(error) === 'SOURCE_BINDING_MISMATCH',
    );
    expect(never.requests).toHaveLength(0);
  });

  it('rejects oversized, malformed, and wrong-identity provider responses', async () => {
    const source = evaluation();
    const document = comment(source);
    const oversized = scriptedFetch([jsonResponse([], 200, { 'content-length': '1048577' })]);
    await expect(
      publishGitHubCiComment(githubInput(source, document, oversized.fetch)),
    ).rejects.toSatisfy(
      (error: unknown) => publisherErrorCode(error) === 'PROVIDER_RESPONSE_TOO_LARGE',
    );

    const malformed = scriptedFetch([new Response('{', { status: 200 })]);
    await expect(
      publishGitHubCiComment(githubInput(source, document, malformed.fetch)),
    ).rejects.toSatisfy(
      (error: unknown) => publisherErrorCode(error) === 'PROVIDER_RESPONSE_INVALID',
    );

    const wrongIdentity = scriptedFetch([
      jsonResponse([]),
      jsonResponse(
        {
          id: 13,
          body: renderCiCommentMarkdown(document),
          user: { id: 999, login: 'other' },
        },
        201,
      ),
    ]);
    await expect(
      publishGitHubCiComment(githubInput(source, document, wrongIdentity.fetch)),
    ).rejects.toSatisfy((error: unknown) => publisherErrorCode(error) === 'BOT_IDENTITY_MISMATCH');
  });

  it('classifies cancellation and does not retain transport causes that could disclose tokens', async () => {
    const source = evaluation();
    const document = comment(source);
    const aborted = new AbortController();
    aborted.abort();
    const canceledFetch = scriptedFetch([]);

    await expect(
      publishGitHubCiComment({
        ...githubInput(source, document, canceledFetch.fetch),
        runtime: { fetch: canceledFetch.fetch, signal: aborted.signal },
      }),
    ).rejects.toSatisfy((error: unknown) => publisherErrorCode(error) === 'REQUEST_ABORTED');

    const leakingFetch = (async () => {
      throw new Error('github-test-token');
    }) as typeof fetch;
    let captured: unknown;
    try {
      await publishGitHubCiComment(githubInput(source, document, leakingFetch));
    } catch (error) {
      captured = error;
    }

    expect(publisherErrorCode(captured)).toBe('REQUEST_FAILED');
    expect(captured).toBeInstanceOf(CiCommentPublisherError);
    expect((captured as Error).cause).toBeUndefined();
    expect(JSON.stringify(captured)).not.toContain('github-test-token');
  });
});
