# Optional CI Comment Publisher

Phase P5.2 adds deliberately separate, opt-in GitHub and GitLab publisher adapters
above the Phase P5.1 sanitized comment contract. The P3 pull/merge-request analysis
jobs remain read-only and receive no comment token. Publication belongs in a trusted
follow-up job that treats downloaded evaluation and comment JSON as untrusted data and
never checks out, imports, installs, or executes candidate content.

The adapters are library boundaries, not automatically enabled steps in the P3
GitHub Action or GitLab component.

## Required trust binding

`publishGitHubCiComment()` and `publishGitLabCiComment()` accept both an unknown
`CiEvaluationDocument` and unknown `CiCommentDocument`. Before any provider request,
they:

1. strictly validate the evaluation and the comment;
2. bind the comment's outcome, summary, candidate provenance, annotation population,
   and retained finding prefix back to that exact evaluation; and
3. require the evaluation's baseline and candidate repository revisions to equal the
   revisions supplied from the trusted provider event.

This last comparison prevents a valid, self-consistent artifact from another run from
being replayed onto the current pull/merge request. The target repository/project,
request number, numeric bot user ID, revisions, API base URL, and token must come from
trusted workflow configuration or provider event metadata—not from the downloaded
artifact. A custom API base supports trusted enterprise/self-managed installations;
it must be credential-free HTTPS and must never be artifact-controlled.

## Upsert behavior

Both adapters list comments or notes in stable 100-item pages. A candidate is eligible
for update only when:

- its body starts with the exact engine marker
  `<!-- api-intel:ci-evaluation:v1 -->`; and
- its provider author has the configured numeric bot user ID.

An unowned copy of the marker has no authority. No owned marker creates one comment;
one owned marker is updated only if its body changed; an exact body is a no-op. More
than one owned marker fails closed with `AMBIGUOUS_UPSERT_TARGET`. The publisher never
deletes comments. Serialize publisher jobs per repository and pull/merge request so
two initial runs cannot race between list and create.

GitHub uses issue-comment endpoints because every pull request is also an issue. The
adapter performs `GET` plus `POST` or `PATCH`. GitLab performs `GET` plus `POST` or
`PUT` against merge-request notes and excludes system notes. GitLab project paths are
encoded as one API path segment.

## Bounded network behavior

The shared transport has fixed ceilings:

- 10 pages of 100 provider records;
- 1 MiB per JSON response;
- a 15-second default timeout, configurable only from 1 through 30 seconds;
- HTTPS API bases without credentials, query strings, or fragments; and
- rejected redirects plus strict expected status and response-shape checks.

The bearer/private token is accepted only as a validated input and appears only in the
outbound authorization header. It is absent from errors and
`CiCommentPublicationResult`. Mutation responses must also identify the configured bot
user; a mismatch fails with `BOT_IDENTITY_MISMATCH`.

`401`, `403`, and provider-masked `404` responses produce the nonblocking
`permission_unavailable` publication outcome. The already-published native P3 summary,
annotations/Code Quality report, and evidence artifact remain the fallback. Invalid
artifacts, revision mismatches, ambiguous ownership, unexpected statuses, malformed or
oversized responses, timeouts, and transport failures are explicit errors rather than
permission fallbacks.

## Provider permissions and workflow placement

For GitHub, grant only the trusted publisher job `pull-requests: write` (or the
equivalent fine-grained GitHub App permission) and the read access needed to obtain the
specific completed run's artifact. GitHub documents that `workflow_run` can receive
write tokens even when the triggering workflow could not, and warns against executing
untrusted content there. Keep the publisher implementation on the trusted default
branch, download into a temporary data-only directory, bind both event revisions, and
run no artifact scripts. See GitHub's official
[issue-comment API](https://docs.github.com/en/rest/issues/comments) and
[`workflow_run` security warning](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

For GitLab, `CI_JOB_TOKEN` currently lists merge-request notes but does not create or
update them. Use a narrowly owned, protected project/group access token with the API
access required by the instance, expose it only to the trusted publisher job, and do
not make that job runnable from unreviewed fork configuration. See the official
[Notes API](https://docs.gitlab.com/api/notes/) and
[CI job-token endpoint allowlist](https://docs.gitlab.com/ci/jobs/ci_job_token/).

## Library usage

```typescript
import { publishGitHubCiComment } from './src/ci-comment-publisher/index.js';

const publication = await publishGitHubCiComment({
  evaluation: parsedEvaluationJson,
  comment: parsedCommentJson,
  token: trustedToken,
  target: {
    owner: trustedOwner,
    repository: trustedRepository,
    pullRequestNumber: trustedPullRequestNumber,
    expectedBotUserId: configuredBotUserId,
    expectedBaselineRevision: trustedBaseSha,
    expectedCandidateRevision: trustedHeadSha,
  },
});
```

`publishGitLabCiComment()` uses `projectId`, `mergeRequestIid`, and the same expected
identity/revision fields. Both return strict `CiCommentPublicationResult` schema
`1.0.0` with provider, outcome, source evaluation/comment IDs, target key, numeric
provider comment ID (or `null` for permission fallback), status, and pages scanned.

P5.2's provider behavior is verified with injected, adversarial HTTP doubles. It does
not yet claim a real hosted comment mutation on either provider; adoption should first
validate the trusted follow-up workflow in a disposable pull/merge request.
