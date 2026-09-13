# Product Charter and Claims Ledger

Status: normative product-language contract  
Applies from: Phase O0.1  
Implementation baseline: `api-intel` 0.1.0

This charter governs how current documentation, CLI text, reports, integrations, and
future release material describe `api-intel`. Runtime schemas and executable tests
remain authoritative for what the engine actually emits. Historical ADRs, benchmarks,
validation records, and implementation plans retain their original context but do not
override this charter's current product claims.

## Positioning contract

### Primary positioning

> **Evidence-backed blast radius for legacy NestJS systems.**

### Proof claim

> **api-intel proves supported static paths to potential side-effect operations and
> reports exactly where proof stops.**

The headline is shorthand, not a completeness claim. Wherever space permits, publish
both statements together. Where only one short description fits, qualify blast radius
as static or potential and link to the proof boundary. “Blast radius” never means
exhaustive runtime impact.

## User, problem, and primary job

The primary users are developers, consultants, and staff or platform engineers who
inherit or refactor large NestJS systems that are difficult, risky, or impractical to
start locally.

Their problem is not a lack of source files or import graphs. It is the absence of a
defensible answer to: “If I change this endpoint, worker, service, or persistence
path, what can the supported source prove may be affected?”

The primary job is:

> Before changing a legacy NestJS path, show its supported potential effects, the
> source evidence for every reported step, and the exact boundary where evidence
> becomes conditional, ambiguous, unsupported, missing, or external.

The core workflow is:

```text
scan -> inspect -> refactor -> diff -> impact -> check -> retain in CI
```

The graph, reports, CI projections, and local MCP tools are views over the same
canonical evidence. They are not independent inference engines.

## Evidence model

`api-intel` analyzes source without importing or starting the target application. A
supported extractor rule plus concrete source evidence may establish a static fact or
edge. Validated canonical artifacts retain those facts, their evidence, their result
states, and their bounded omissions. Derived views may select or project canonical
facts but may not strengthen their certainty.

The product therefore reports three things together:

1. what a supported rule established;
2. the repository-relative evidence supporting it; and
3. why traversal stopped or became uncertain.

Determinism means that the same supported inputs, engine version, effective
configuration, compiler/type environment, and bounds produce the same canonical
facts and ordering. It does not mean that every runtime path is statically knowable.

## Standard terminology

These terms govern human-facing descriptions. Existing canonical enum names remain
unchanged in Phase O0.1; the final column maps the language to current model concepts
without inventing new schema states.

| Term                | Use when                                                                                                              | Never infer                                                                               | Current model vocabulary                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `proven`            | A supported static rule established a fact or path step and retained concrete evidence.                               | That the path executed, will execute, or is the only possible path.                       | Commonly a `resolved` assertion or correlation plus evidence.                                                       |
| `potential`         | A fact or effect is reachable through the supported static graph.                                                     | Actual runtime change, frequency, order, success, or exclusivity.                         | Potential-impact direct/transitive results and supported reachability.                                              |
| `conditional`       | A reported path depends on a modeled condition or crosses an open-world boundary.                                     | Deployment, routing, delivery, acknowledgement, handler execution, or downstream success. | `distributed_conditional`, activation/branch conditions, and declared-realm candidates.                             |
| `ambiguous`         | Available evidence supports multiple candidates and cannot prove one unique resolution.                               | A preferred candidate, successful dispatch, or absence of the alternatives.               | `ambiguous` assertion, selector, dispatch, or correlation states.                                                   |
| `unsupported`       | The engine recognizes a construct or identity family but has no sound rule for proving it.                            | That the construct has no effect or that nearby supported behavior applies to it.         | `unsupported` statuses, unsupported identities/regions, and a diagnostic.                                           |
| `missing`           | A required artifact, input, project, topology observation, or compatible fact is unavailable.                         | Empty input, known absence, success, or a clean baseline.                                 | `missing`/`incompatible` snapshot states and explicit missing-input diagnostics.                                    |
| `out_of_repository` | Static evidence reaches a boundary whose implementation or consumer is not proven inside the supplied repository set. | That no consumer exists, that a remote consumer handles it, or that delivery succeeds.    | Human-facing term for `external_or_unobserved`, producer-only, consumer-only, or unmatched open-world observations. |

When a canonical name is shown to users, preserve it verbatim and explain it with the
term above. Do not silently rename stored states or collapse `missing`, `unsupported`,
and `ambiguous` into one generic unknown result.

## Claims ledger

| Do not claim                                                                                | Approved replacement                                                                                 |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| “Complete,” “true,” or “actual runtime behavior.”                                           | “Supported static paths to potential side-effect operations.”                                        |
| “100% accurate,” “100% coverage,” or “finds every path.”                                    | “Deterministic for the same supported inputs, version, configuration, type environment, and bounds.” |
| “Exhaustive blast radius” or “complete impact.”                                             | “Evidence-backed potential blast radius within the supported static graph.”                          |
| “Guaranteed broker delivery,” “guaranteed handler execution,” or “guaranteed side effects.” | “A conditional delivery candidate or effect path; deployment and execution are not proven.”          |
| “Dead code” from zero supported-root reach.                                                 | “No supported root reached this symbol under the current inputs and bounds.”                         |
| “Prevents architecture degradation forever.”                                                | “Checks configured policies over available supported facts and can block newly detected violations.” |
| Broad backend, framework, ORM, security, compliance, or audit coverage.                     | Name the exact verified NestJS pattern, integration, version range, artifact, and limitation.        |
| “Knip for backend architectures” as the formal category.                                    | Use it only as a discovery analogy beside the NestJS scope and proof boundary.                       |

Specific percentages remain valid when their denominator is explicit—for example,
artifact hash verification, browser zoom, or a dated benchmark corpus. They must not
be generalized into analysis accuracy or coverage.

## Non-goals for the current product horizon

- Observing or certifying runtime execution.
- Proving exhaustive impact, data flow, delivery, or absence of behavior.
- Running target application modules, package scripts, infrastructure, or databases.
- Automatically modifying or refactoring target code.
- Claiming broad backend or polyglot framework coverage.
- Treating a score, graph, or policy outcome as security/compliance certification.
- Hiding diagnostics, omissions, or external boundaries to make coverage appear
  stronger.
- Remote source upload, telemetry, hosted analysis, or remote MCP in the current
  productization scope.

## Proof-stop contract

A supported path stops at the last evidence-backed node. The adjacent result should,
where the artifact format permits, retain a stable reason/status, evidence for the
last proven step, relevant diagnostic, and bounded omitted-result count. Consumers
must distinguish:

- a known empty result;
- a missing or incompatible input;
- an unsupported construct;
- multiple ambiguous candidates;
- a bounded traversal limit; and
- an out-of-repository boundary.

A leaf in a graph is not evidence that execution ends there. A completed scan with
gaps is not a complete program model.

## Current claim-surface audit

This inventory records the O0.1 review. It intentionally does not rewrite historical
ADRs, benchmark records, validation logs, or phase plans.

| Surface                                                                | O0.1 finding                                                                                                  | Required action and owner phase                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `README.md` opening                                                    | Feature-first and used the ambiguous phrase “runtime-validated.”                                              | O0.1 adds both positioning statements and replaces that phrase with “schema-validated.” O4.3 will perform the broader public-front-door rewrite. |
| `docs/README.md`                                                       | Behavior hierarchy existed, but no separate authority for product claims.                                     | O0.1 links this charter and separates claim authority from implementation authority.                                                             |
| `package.json` description                                             | Safe but narrow: it describes endpoint/TypeORM tracing rather than the approved refactoring job.              | Keep unchanged until O0.2 selects the public identity; revise with the audited package manifest in O2.1.                                         |
| `src/cli/index.ts` help header                                         | Safe but narrow and tied to the original MVP description.                                                     | Align after O0.2 freezes public surfaces; verify in O4 documentation tests.                                                                      |
| `action.yml` description                                               | “Impact” is not explicitly qualified as potential/static.                                                     | Qualify it when O0.2 freezes provider support labels and O3 rebuilds the release artifact.                                                       |
| OCI image description                                                  | Says “static” but does not state the proof-stop boundary.                                                     | Align during O3 artifact/release metadata work.                                                                                                  |
| Living feature/reference docs                                          | Existing impact, CI, graph, and structured-export guides generally state static/non-runtime boundaries.       | Keep under the automated claim lint; correct any future violation before merge.                                                                  |
| Generated Markdown/HTML notices                                        | Current impact/system renderers distinguish static potential paths from runtime behavior and broker delivery. | Keep these emitters in the automated claim-surface set.                                                                                          |
| ADRs, benchmarks, spikes, validation records, and implementation plans | Historical or measurement-specific language may differ from current product copy.                             | Preserve unchanged. Their directory/index labels make them non-normative; current public copy follows this charter.                              |

## Maintenance rule

Any new public command, report, integration, package description, or landing-page copy
must use this ledger. If a new feature cannot state both what is proven and where proof
stops, it is not ready for a public capability claim.
