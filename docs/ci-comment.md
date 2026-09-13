# Sanitized CI Comment Contract

Phase P5.1 defines a small, provider-neutral comment document above a validated
`CiEvaluationDocument`. Its projection does not list, create, update, or delete GitHub
pull-request comments or GitLab merge-request notes. Phase P5.2 adds separate opt-in
publisher adapters without adding credentials to the P3 analysis jobs; see
[Optional CI Comment Publisher](ci-comment-publisher.md).

## Pure projection boundary

`projectCiComment()` accepts:

1. one validated CI evaluation;
2. a provider run identity (`github`, `gitlab`, or `generic`) and run URL;
3. at least one downloadable evidence-artifact link; and
4. optional item, link, and rendered-byte ceilings.

It performs no filesystem, network, provider API, repository scan, or source-control
operation. Run and artifact URLs must be normalized, credential-free absolute HTTPS
URLs. The projection does not claim that a URL exists or is accessible; the eventual
adapter must supply links only after the provider has accepted the artifacts.

## Comment document 1.0.0

`CiCommentDocument` records:

- a content-derived `ci_comment:<digest>` identity and the exact source evaluation ID;
- the evaluation outcome, complete numeric summary, candidate analysis identity, and
  bounded candidate revision text;
- a normalized provider run identity and link;
- a failure-first subset of portable CI annotations with optional repository-relative
  source locations;
- bounded downloadable artifact links; and
- candidate, included, and omitted item/link counts plus the exact rendered Markdown
  byte count.

Findings are ordered by failure, warning, and notice, then policy, gap, diagnostic,
potential impact, and endpoint-change category. Limits change presentation only; full
canonical evidence remains in the downloadable artifacts. Defaults retain 20 findings
and 8 artifact links. Hard ceilings are 50 findings, 20 links, and 60,000 rendered
Markdown bytes; the byte ceiling cannot be configured below 8 KiB.

`serializeCiCommentDocument()` provides deterministic canonical JSON.
`renderCiCommentMarkdown()` validates before rendering. `validateCiCommentDocument()`
checks schema, content identity, limit arithmetic, duplicates, and exact rendered byte
count. A publisher handling untrusted input must additionally call
`validateCiCommentAgainstEvaluation()` (or `assertCiCommentMatchesEvaluation()`) with
the exact trusted evaluation; self-consistent content identity alone cannot prove that
the summary came from that evaluation.

## Presentation safety

Repository-derived titles, messages, paths, revisions, run labels, and artifact labels
are normalized before entering the document. Control/newline sequences and Unicode
bidirectional override/isolate controls are removed or flattened. The Markdown
renderer escapes HTML delimiters and Markdown punctuation, so source text cannot
create headings, links, images, tables, code spans, block quotes, or raw HTML.

Only normalized HTTPS destinations are rendered as links. HTTP, non-web schemes,
embedded credentials, whitespace/control characters, oversized URLs, unsupported
providers/artifact kinds, empty evidence-link sets, and over-limit configuration are
rejected rather than repaired into a different destination.

## Stable upsert identity

Every rendered comment contains exactly one engine-controlled marker:

```html
<!-- api-intel:ci-evaluation:v1 -->
```

The document also carries the stable key `api-intel-ci-evaluation`. The marker is
constant across evaluation runs so P5.2 can update one existing bot comment instead of
appending indefinitely. It contains no repository-derived text and is not part of the
human-visible evidence. Possession of the marker does not authorize an update. The
P5.2 adapters additionally require exact numeric bot ownership, the selected
pull/merge request, and trusted baseline/candidate revision binding before mutation.
Multiple bot-owned marker matches fail closed.

## Honesty boundary

The comment repeats the existing static-analysis warning. Repository-local potential
impact does not prove changed runtime behavior. Distributed-conditional paths do not
prove deployment, broker delivery, handler execution, or remote side effects. P5.1
does not add distributed impact to a single-repository `CiEvaluationDocument`, and it
does not turn artifact links or a successful provider run into runtime evidence.
