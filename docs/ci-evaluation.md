# Vendor-Neutral CI Evaluation

Phase P2.1 defines a portable CI result above the existing canonical analysis,
comparison, potential-impact, and policy engines. It is a library contract; it does
not check out repositories, resolve branches, scan source, call a CI provider, or
publish comments.

## Inputs and compatibility

`evaluateCiArtifacts()` accepts five already-loaded documents:

1. one baseline analysis;
2. one candidate analysis;
3. their comparison document;
4. their repository-local potential-impact document; and
5. policy results evaluated for the candidate.

Every input is validated by its owning canonical validator. Baseline and candidate
must use the same analysis schema, analysis configuration, engine version, and
TypeScript version. The analysis IDs, schema versions, result states, and the three
core analysis limits recorded by the comparison and impact snapshots must match the
supplied analyses. Policy candidate provenance must match; policy baseline provenance
is checked when present. A mismatch is `incompatible_baseline`, never an empty diff or
successful evaluation.

The evaluator never accepts repository or artifact paths. Phase P2.2 now defines the
separate [reproducible scan recipe](ci-reproducible-scans.md) used to prove how
compatible artifacts were produced; neither layer executes a checkout, install, or
scan.

## CI evaluation schema 1.0.0

`CiEvaluationDocument` contains:

- a content-derived `ci_evaluation:<digest>` identity and `success` or
  `policy_violation` evaluation outcome;
- baseline and candidate analysis identity, result state, repository revision,
  toolchain metadata, configuration fingerprint, canonical artifact fingerprint, and
  source-file count;
- fingerprints for the exact comparison, impact, and policy-result inputs;
- endpoint-change, repository-local potential-impact, policy, diagnostic, and gap
  summaries;
- compact records for each endpoint change, impacted endpoint, policy result,
  diagnostic change, and explicit gap; and
- repository-relative, one-based evidence coordinates without snippets.

Evidence locations retain their baseline/candidate side, canonical evidence and file
IDs, role, coordinate range, and source content hash. Omitting snippets keeps the CI
projection proof-linked without copying source text or secrets.

Explicit gap records cover analyses completed with gaps, unavailable repository
revisions, comparison ambiguity, unknown policies, incomplete impact paths, and
changed source files with no proven endpoint path. An unreachable source is not
reported as unaffected.

## Process outcomes

The portable process contract is intentionally distinct from the two evaluated
document outcomes:

| Outcome                 | Exit code | Meaning                                                                |
| ----------------------- | --------: | ---------------------------------------------------------------------- |
| `success`               |         0 | No configured blocking policy result                                   |
| `policy_violation`      |         8 | At least one configured policy result is blocking                      |
| `invalid_input`         |        10 | A supplied document fails schema or integrity validation               |
| `incompatible_baseline` |        11 | Valid artifacts do not describe one compatible baseline/candidate pair |
| `analysis_failure`      |         6 | A required analysis has result state `failed`                          |
| `canceled`              |       130 | Cancellation was requested or a required analysis was canceled         |

Warnings are not silently promoted to violations. A failed or unknown policy result
blocks only when its normalized rule configuration gives it `error` severity.

## Deterministic renderers

The module provides three provider-neutral projections:

- `serializeCiEvaluationDocument()` emits canonical machine JSON;
- `renderCiEvaluationMarkdown()` emits a bounded-evidence human summary; and
- `projectCiAnnotations()` plus `serializeCiAnnotationStream()` emit a stable,
  provider-neutral JSONL annotation stream categorized as endpoint change, potential
  impact, policy, diagnostic, or gap.

Annotations use neutral `notice`, `warning`, and `failure` levels. They choose a
candidate evidence location when one exists, otherwise a baseline location, and may
have a null location when the underlying gap has no honest source coordinate. A later
GitHub or GitLab adapter may cap or translate this stream without changing the
canonical CI evaluation.

Potential impact retains its existing meaning: a changed supported static fact is
reachable from an endpoint within the repository analysis. It does not prove that
runtime behavior changed, that distributed delivery occurred, or that a remote
service is affected.

## Reproducible scan provenance

The independent P2.2 `CiScanRecipeManifest` `1.0.0` binds this evaluation to exact
repository revisions, engine distribution, Node policy, trusted project
configuration, dependency lockfiles, and explicit topology provenance. It also
freezes a trusted-writer/candidate-read-only cache policy and a fork-safe no-secret,
read-only-token boundary. See [Reproducible CI Scan Recipe](ci-reproducible-scans.md).

## Optional sanitized comment projection

Phase P5.1 can project this canonical document into a smaller failure-first
`CiCommentDocument` with a stable upsert marker, normalized run/artifact HTTPS links,
and explicit item/link/byte ceilings. The comment is a derived presentation artifact,
not another evaluation. The separate P5.2 publishers validate it against this exact
source evaluation and trusted provider-event revisions before any token-bearing
request. See [Sanitized CI Comment Contract](ci-comment.md) and
[Optional CI Comment Publisher](ci-comment-publisher.md).
