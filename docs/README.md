# Documentation Index

This index separates current product documentation from historical evidence. Unless a
document is explicitly marked historical, it describes the current `0.1.0-alpha.1` tool,
analysis schema `8.0.0`, and the capabilities listed in
[Supported Static-Analysis Patterns](supported-patterns.md).

## Source-of-truth hierarchy

When documentation and implementation disagree, use this order while correcting the
documentation:

1. runtime schemas, validators, CLI command definitions, and extractor rule constants
   under `src/`;
2. executable positive and negative contracts under `test/`;
3. living reference documents below;
4. detailed feature guides; and
5. historical ADRs, gates, validations, spikes, benchmarks, and examples.

`supported-patterns.md` is the coverage index, not a replacement for the detailed
semantic guides. Historical records never override current source or living
references.

[The product charter and claims ledger](product-charter.md) is authoritative for
public positioning, proof-boundary terminology, and prohibited claims. It does not
override runtime schemas or executable contracts when describing actual behavior.

## Living references

- [Product charter and claims ledger](product-charter.md) — approved positioning,
  evidence language, proof-stop terminology, non-goals, and current claim-surface
  audit.
- [Public identity and alpha surface contract](public-release-boundary.md) — selected
  name/package identity, finite CLI/MCP surface, maturity and validation labels,
  independent version domains, and the initial evidence-based compatibility matrix.
- [License and redistribution audit](legal/redistribution-audit.md) — Apache-2.0
  project-license decision, deterministic package/asset inventory, release-surface
  obligations, and OCI-specific hold.
- [Ownership and publication authorization](legal/ownership-and-publication-authorization.md)
  — scoped owner attestation, organization-material exclusion, and exact-release
  execution boundary.
- [Fixture and example provenance](legal/fixture-provenance.md) — ownership and
  redistribution treatment for synthetic fixtures, generated examples, and historical
  NestJS evidence.
- [Privacy, threat model, and artifact safety](privacy-and-artifact-safety.md) — local
  processing boundary, no-telemetry contract, artifact sensitivity, redaction limits,
  least-privilege sharing, and support guidance.
- [Public-release sanitation record](legal/public-release-audit.md) — separate current
  tree, npm candidate, and read-only Git-history audit states.
- [Public repository strategy](public-repository-strategy.md) — selected fresh-history
  publication boundary, private-source separation, and deferred staged-export
  procedure.
- [Package runtime and manifest contract](package-runtime-and-manifest.md) — private
  source-manifest guard, closed runtime dependency ledger, lifecycle policy, pack
  verifier, and destination-metadata deferral.
- [npm package surface](npm-package-surface.md) — reviewed CLI-first bins, data-only
  schema exports, exact tarball allowlist and budgets, and per-distribution assets.
- [Clean-room package installation](clean-room-package-installation.md) — isolated npm
  and pnpm archive installation, installed CLI/MCP/schema/runtime probes, negative
  diagnostics, and the exact Gate OD0 evidence boundary.
- [Neutral repository CI](neutral-repository-ci.md) — maintained clean-source release matrix,
  pinned real-package compatibility corpus, workflow trust/resource controls, and the
  explicitly pending hosted-validation boundary.
- [Reproducible provider and package artifacts](reproducible-release-artifacts.md) —
  byte-for-byte ncc rebuilds, complete distribution fingerprints, canonical npm
  manifest, controlled Action and unprivileged-image smoke, and bounded browser claims.
- [Release integrity and response](release-integrity-and-response.md) — lockfile-bound
  vulnerability decisions, exception rules, CycloneDX SBOM, checksums, source/toolchain
  identity, non-publishing dry run, credential boundary, and compromise runbook.
- [Audited alpha release candidate](alpha-release-candidate.md) — historical O5.1
  allowlisted staging, content identity, exact tarball smoke, immutable references,
  and retained blockers before publication.
- [Published release verification](published-release-verification.md) — exact registry
  bytes, the maintained OS/Node consumer matrix, immutable GitHub release and Action,
  public routes, withheld surfaces, and the non-destructive rollback drill.
- [0.1.0-alpha.1 release notes](releases/0.1.0-alpha.1.md) — surface labels,
  version domains, migration notes, limitations, and rollback boundary.
- [Compatibility and version support](compatibility-and-support.md) — evidence labels,
  exact current evidence table, alpha support window, and compatibility-report contract.
- [Current limitations](current-limitations.md) — concise semantic, runtime,
  distributed, privacy, public-API, and compatibility proof stops.
- [Source-free diagnostic manifest](support-diagnostic-manifest.md) — strict low-data
  issue-intake shape and mandatory manual review boundary.
- [Source-free reproduction workflow](minimal-reproduction.md) — minimal local facts,
  strict support-bundle steps, and prohibited attachments.
- [Community and maintenance policies](../CONTRIBUTING.md) — contributor workflow,
  security, conduct, governance, maintainers, and DCO entry point.
- [Contributor fixture contract](contributor-fixtures.md) — positive, close-negative,
  diagnostic, evidence, compatibility, and performance fixture requirements.
- [CLI and reporting workflow](cli-workflow.md) — commands, options, artifacts, and
  exit behavior.
- [Doctor and capability preflight](doctor.md) — read-only environment, TypeScript,
  resolved-framework, compatibility-evidence, runtime-asset, and output-path checks.
- [First evidence-backed trace](first-use-workflow.md) — deterministic configuration
  initialization, interactive/headless first scan, trace, comparison, impact, policy,
  and proof-gap workflow.
- [Project configuration](project-configuration.md) — strict configuration versions,
  discovery, precedence, and report recipes.
- [Architecture](architecture.md) — current pipeline and trust boundaries.
- [Canonical model contract](model-contract.md) — analysis and derived-document
  versions and invariants.
- [Vendor-neutral query kernel](query-kernel.md) — validated artifact registry,
  exact selectors, bounded semantic operations, and adapter boundary.
- [Local artifact MCP server](mcp-server.md) — explicit startup artifacts, immutable
  registry, stdio discipline, bounded query tools, exact selected resources, Gate MK0,
  and local VS Code/Cursor setup.
- [Vendor-neutral CI evaluation](ci-evaluation.md) — compatible artifact composition,
  proof-linked summaries, deterministic renderers, and portable process outcomes.
- [Sanitized CI comment contract](ci-comment.md) — provider-neutral bounded comment
  document, Markdown/URL hardening, source-evaluation binding, and stable upsert marker.
- [Optional CI comment publisher](ci-comment-publisher.md) — separate least-privilege
  GitHub/GitLab adapters, trusted revision binding, bot-owned upsert, and bounded
  permission fallback.
- [Reproducible CI scan recipe](ci-reproducible-scans.md) — pinned engine,
  configuration, runtime, lockfile and topology provenance; isolated trust boundary;
  and Gate CK0 verification.
- [GitHub pull-request gate](github-action.md) — bundled read-only adapter, isolated
  exact-revision scans, bounded summaries/annotations, artifacts, pins, and fork
  security boundary, with a retained Ubuntu 24.04 hosted-validation record.
- [GitLab merge-request gate](gitlab-ci.md) — reusable component, digest-pinned image,
  exact diff-base/candidate worktrees, Code Quality projection, canonical artifacts,
  self-managed constraints, and the explicitly deferred hosted-release gate.
- [Differential system impact](system-impact.md) — explicit snapshot coverage,
  missing-versus-absent semantics, deterministic system changes, and P4.2 bounded
  distributed-conditional worker paths and graph overlays.
- [Supported patterns](supported-patterns.md) — authoritative rule-to-test coverage
  map.
- [README](../README.md) — installation, quick start, capabilities, and limitations.

## Operational and reporting guides

- [Analysis comparison](comparison.md)
- [Potential change-impact analysis](impact-analysis.md)
- [Architecture policy engine](policy-engine.md)
- [Selected scan bundles](selected-scan-bundles.md)
- [Structured evidence exports](structured-evidence-exports.md)
- [Offline interactive graph](offline-graph-report.md)
- [Architecture overview and bounded refactoring metrics](architecture-overview.md)
- [Distributed policy and graph hardening](phase37-distributed-policy-report-hardening.md)

## Analysis feature guides

- [Nest modules and effective guards](nest-modules-and-global-guards.md)
- [Authorization metadata and composite decorators](authorization-metadata.md)
- [TypeORM QueryBuilder](typeorm-query-builder.md)
- [Static PostgreSQL raw SQL](postgresql-raw-sql.md)
- [Declared contracts and entity columns](declared-contracts-and-columns.md)
- [Intraprocedural request-to-column provenance](request-to-column-provenance.md)
- [Inter-method request-to-column provenance](inter-method-request-provenance.md)
- [Eager outbound HTTP](outbound-http.md)
- [Nest HttpService and symbolic targets](nest-http-service.md)
- [In-process events](in-process-events.md)
- [BullMQ queue interactions](bullmq-interactions.md)
- [Nest microservice interactions](nest-microservices.md)
- [Non-relational resource access](non-relational-resource-access.md)
- [Redlock critical sections](redlock-critical-sections.md)
- [System analysis and artifact stitching](system-analysis-contract.md)
- [Conditional system graph and policies](system-report.md)
- [Vendor-neutral query kernel](query-kernel.md)
- [Local artifact MCP server](mcp-server.md)
- [Vendor-neutral CI evaluation](ci-evaluation.md)
- [Reproducible CI scan recipe](ci-reproducible-scans.md)
- [GitHub pull-request gate](github-action.md)
- [GitLab merge-request gate](gitlab-ci.md)
- [Differential system impact](system-impact.md)
- [Sanitized CI comment contract](ci-comment.md)
- [Optional CI comment publisher](ci-comment-publisher.md)

## Historical and non-normative records

- [Implementation-plan history index](implementation-history.md) classifies the root
  execution plans as historical, non-normative project records.
- [`adr/`](adr/) records accepted architecture decisions in their original context.
  A later decision may supersede an ADR explicitly; implementation chronology alone
  does not.
- [`benchmarks/`](benchmarks/) preserves measurements for the exact dated inputs and
  environments stated in each file. The numbers are not current performance promises.
  This includes the threshold-free
  [Phase O3.1 coverage observation](benchmarks/phase-o3-1-coverage.md) and deterministic
  [Phase P1.3 MCP attribution baseline](benchmarks/phase-p1-3-mcp-evaluation.md), which
  is a synthetic corpus result rather than a live-model benchmark.
- [`spikes/`](spikes/) preserves feasibility investigations and decisions made before
  production implementation.
- [Distributed Gate D0](distributed-gate-d0.md) is the frozen distributed-interaction
  corpus decision. Its BullMQ portion was consumed by Phase 35; its microservice
  portion was consumed by Phase 36.
- [System Stitching Gate S0](system-analysis-contract.md) defines the separate
  cross-analysis identity/topology contract and frozen multi-service corpus. The same
  living guide now documents Phase 46's artifact-only stitch command; the Gate S0
  chronology remains historical.
- [Phase 11 real-repository validation](real-repository-validation.md) and the
  associated `official-nestjs-typeorm` outputs are historical evidence, not current
  report-format examples.

## Current examples

Current report-format examples are generated from the repository-local
`example-nestjs-app` fixture and stored in [`examples/current/`](examples/current/).
They are validated by documentation conformance tests against the current CLI and
schema. Historical official-sample evidence remains under
`examples/official-nestjs-typeorm/`.

The maintained [synthetic legacy system walkthrough](examples/synthetic-legacy-system/README.md)
projects one exact reviewed case from the frozen system-stitching corpus into a public
refactoring story and concise expected artifact. Its source of truth remains under
`test/fixtures/system-stitching/` so documentation cannot silently fork the semantics.

## Maintenance contract

Documentation Gate D1 checks that:

- all thirteen CLI command synopses match their command definitions;
- current schema versions and supported interaction kinds appear in living docs;
- local Markdown links resolve;
- current example artifacts remain readable and match generated reports; and
- historical records are not presented as current product behavior.

The O4.3 public-documentation gate additionally checks positioning order and README
size, product-visual provenance, exact compatibility labels, limitation and
source-free support boundaries, all six contributor fixture classes, installed-only
first-use commands, and the public synthetic-system expectation against its frozen
semantic source.

New interaction phases must not begin while this gate is failing.
