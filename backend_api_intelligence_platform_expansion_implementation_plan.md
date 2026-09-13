# Backend API Intelligence Platform Expansion Implementation Plan

Status: active internal implementation plan; Phase P3.1 hosted-validated on GitHub;
Phase P3.2 implemented locally with hosted GitLab validation explicitly deferred;
Phases P4.1-P4.2 and P5.1-P5.2 complete

Later phases remain deferred until explicitly resumed

Prerequisite baseline: completed Phase 47 engine and report contracts

This plan turns the existing deterministic artifact engine into reusable agent and CI
integrations without weakening its proof boundaries. It is intentionally separate from
the completed/refactoring expansion plans. No phase in this document is active merely
because the plan exists.

## Product and semantic rules

- Describe results as supported static paths to side-effect operations, never proof
  that a runtime effect, broker delivery, lock acquisition, guard authorization, or
  deployment occurred.
- Keep the canonical analysis and system documents authoritative. Adapters consume
  validated documents and do not recreate extraction or matching logic.
- Every query result identifies its artifact/schema, result state, canonical subjects,
  evidence, diagnostics, uncertainty, and omitted-result counts.
- Default integrations are local, read-only, bounded, deterministic, and offline.
- Do not match distributed producers and consumers by target text alone. Preserve the
  existing topology-realm and correlation-state contract.
- Treat repository content and generated summaries as untrusted data in CI. Never
  evaluate repository-derived text, interpolate it into commands, or publish it without
  validation, escaping, and size limits.
- A policy gate blocks only configured blocking outcomes. Ordinary changes, potential
  impact, unknown results, and analysis gaps remain distinct.
- Marketing claims about agent reliability or architecture prevention require measured
  evaluations; they are not engine facts.

## Shared gates

### Gate PK0 — Query contract

Pass only when:

1. Query selectors return zero, one, or explicit multiple matches; ambiguity never
   selects an arbitrary record.
2. Responses have deterministic ordering and configurable hard limits.
3. Full canonical IDs and evidence remain available even when display labels are short.
4. Frozen v1-v7 analysis compatibility and system-schema compatibility pass.
5. Query code performs no target import, target execution, network access, or write.

### Gate MK0 — Local MCP safety

Pass only when:

1. The server is artifact-backed and read-only.
2. Startup roots are explicit and canonicalized; tool arguments cannot escape them.
3. Tool responses are bounded and exclude environment/configuration values already
   protected by analyzer redaction rules.
4. Protocol tests cover initialization, discovery, successful calls, ambiguity,
   invalid input, cancellation, and output limits.
5. No scan, shell, arbitrary-file, mutation, sampling, or remote transport is exposed.

### Gate CK0 — CI trust boundary

Pass only when:

1. Baseline provenance includes tool version, document schema, repository revision,
   effective configuration hash, and relevant topology hash.
2. Candidate analysis can run without target lifecycle scripts.
3. Untrusted repository data is schema-validated, escaped, and bounded before entering
   annotations, summaries, artifacts, or comments.
4. Analysis failure, policy failure, impact, unknown, and incomplete-with-gaps produce
   distinct machine outcomes.
5. Fork-safe workflows need no write token or secret while analyzing candidate code.

## Milestone P0 — Vendor-neutral query kernel

### Phase P0.1 — Query model and selectors

Status: complete

Goal: expose stable programmatic queries above validated canonical documents.

Deliverables:

1. Add a dedicated query module that accepts already validated analysis, comparison,
   impact, policy, system-analysis, and system-report documents.
2. Define common query metadata: document ID, schema version, result state, limits,
   omitted counts, diagnostics, and evidence references.
3. Implement exact endpoint resolution by method/path and canonical ID.
4. Implement symbol resolution by repository-relative path, qualified name, optional
   source location, and canonical ID.
5. Return explicit `not_found`, `resolved`, or `ambiguous` selector states.
6. Freeze ordering and response schemas with positive and negative fixtures.

Non-goals:

- Transport protocols, CI environment discovery, branch operations, or source scans.
- Name-only symbol selection when multiple declarations are possible.

Implementation result:

- Added query schema `1.0.0` and a vendor-neutral `src/query/` module. Its registry
  accepts explicitly named, already validated analysis, comparison, impact, policy,
  system-analysis, and system-report documents without scanning or filesystem access.
- Descriptors use deterministic content addresses over each document family's
  canonical serialization and retain native analysis/system/report IDs separately.
  Registration order cannot affect identities or descriptor ordering.
- Implemented exact endpoint selection by canonical ID or method/path and class/method
  selection by canonical ID or normalized source path plus qualified name, optional
  kind, and one-based declaration location.
- Selectors return only `not_found`, `resolved`, or `ambiguous`. Canonical-ID ordering,
  configurable hard limits, total/returned/omitted counts, direct diagnostic IDs, and
  evidence references remain explicit even when output is truncated.
- Strict runtime response schemas reject contradictory selector states, count
  summaries, ordering, duplicate matches, or mismatched evidence/diagnostic unions.
- Frozen positive and negative contracts cover duplicate routes, overload ambiguity,
  source-location disambiguation, unsafe paths, kind mismatch, bounds, deterministic
  repeat calls, and response validation. The same endpoint selector passes across
  validated analysis schemas v1-v8.
- Published `docs/query-kernel.md` and updated the architecture, model contract, and
  documentation index as the selector baseline consumed by the now-complete P0.2.
- Focused query and Documentation Gate D1 verification passed (4 files, 11 tests).
  Typecheck, production build, ESLint with zero warnings, and formatting passed. The
  complete parallel suite passed 148 files and 376 tests without a retry.

### Phase P0.2 — Bounded evidence queries

Status: complete

Goal: provide the reusable semantic operations required by both adapters.

Deliverables:

1. `listEndpoints` with filters and pagination/limits.
2. `getEndpointTrace` using the existing canonical trace builder.
3. `compareAnalyses` and `getChangeImpact` over explicit before/after documents.
4. `getSymbolDependents` as current-snapshot reverse reachability, clearly distinct
   from before/after impact.
5. `findDistributedCandidates` over a validated system document, requiring interaction
   kind plus structural target and preserving declared-realm/target-only/ambiguous/
   unmatched states.
6. `getPolicyResults` with blocking and unknown states kept separate.
7. Gate PK0 verification.

Implementation result:

- Added seven synchronous, transport-neutral operations above explicitly registered
  documents: endpoint listing and traces, before/after comparison and impact, current-
  snapshot symbol dependents, distributed candidates, and policy results.
- Endpoint traces delegate to the canonical trace builder after exact query selection.
  Every returned trace collection is independently bounded and reports omitted counts.
- Comparison and impact are derived in memory from named before/after analysis artifacts.
  Responses preserve the role of each snapshot, identify the derived content-addressed
  artifact, and return bounded semantic projections with canonical and evidence IDs.
- Reverse reachability follows only resolved or ambiguous `METHOD_CALLS_METHOD`,
  `ENDPOINT_IMPLEMENTED_BY`, and `HANDLER_IMPLEMENTED_BY` assertions. It retains the
  assertion path and certainty, prevents cycles, and enforces depth, state, seed, and
  result limits. It is not a substitute for before/after impact.
- Distributed lookup requires the correlatable interaction kind and the complete
  structural target. It compares the canonical contract key and preserves
  `declared_realm_candidate`, `target_only_candidate`, `ambiguous`, and `unmatched`
  rather than inventing a consumer relationship.
- Policy lookup filters the already evaluated policy document. `unknown`, `fail`, and
  the independent `blocking` boolean remain separate in both records and summaries.
- Gate PK0 is frozen by a semantic manifest plus positive, negative, compatibility,
  ambiguity, ordering, pagination, hard-limit, and no-I/O/no-execution tests. The
  operation surface passes frozen analysis v1-v8 and system schema `1.0.0` fixtures.
- Focused Milestone P0 verification passed 6 files and 16 tests. Typecheck, production
  build, ESLint with zero warnings, and formatting passed; the complete suite passed
  151 files and 385 tests.

## Milestone P1 — Local read-only MCP server

### Phase P1.1 — Artifact registry and stdio server

Status: complete

Goal: let local AI hosts query explicit completed artifacts without rescanning.

Deliverables:

1. Add a separately addressable MCP entry point using the stable TypeScript MCP SDK.
2. Accept explicit `--analysis`, `--system`, and named before/after artifact arguments.
3. Load and validate each document once at startup into an immutable artifact registry.
4. Serve through stdio only; keep stdout protocol-clean and route diagnostics to stderr.
5. Publish server/tool version metadata independently from analysis schema versions.

Implementation result:

- Added the separately addressable `api-intel-mcp`/`dist/mcp/index.js` entry using the
  pinned stable `@modelcontextprotocol/server` `2.0.0` package. The source/report CLI
  remains unchanged and the MCP server exposes stdio only.
- Added strict repeatable `--analysis <name>=<path>` and `--system <name>=<path>`
  inputs plus a single paired `--before`/`--after` analysis role. Names are validated
  once across every role; help and version are standalone invocations.
- Startup canonicalizes exact JSON paths, enforces a 64 MiB per-file limit before
  reading, caches reads and JSON parsing by canonical path, validates each document
  family, and refuses failed or canceled analyses before opening the transport.
- Validated documents, artifact descriptors, role bindings, runtime metadata, and the
  P0 query kernel are frozen in one process-local registry. Repeated roles may name the
  same canonical analysis without rereading or revalidating it.
- Stdout is reserved for MCP protocol frames. The startup banner, validation failures,
  and transport errors are sent to stderr with distinct usage/internal exit outcomes.
- MCP server `1.0.0`, engine `0.1.0`, query-response `1.0.0`, source document schemas,
  and SDK `2.0.0` remain independently named metadata domains. Equal current version
  numbers do not couple their compatibility contracts.
- The frozen P1.1 startup manifest and positive/negative tests cover argument roles,
  load-once canonical paths, immutable state, pre-read size rejection, malformed JSON,
  invalid schemas, non-completed analyses, protocol-clean startup, and the no-scan/
  no-execution boundary.
- Published `docs/mcp-server.md` and synchronized the README, CLI workflow,
  architecture, model contract, and documentation index. P1.2 tools/resources and the
  full Gate MK0 protocol/adversarial evaluation remain explicitly deferred.
- Focused P1.1 verification passed 4 files and 21 tests. Typecheck, production build,
  ESLint with zero warnings, formatting, the built help/version entry, and a real stdio
  initialization smoke test passed; the complete suite passed 155 files and 406 tests.

### Phase P1.2 — Initial tools and resources

Status: complete

Goal: expose high-confidence, low-token queries.

Initial tools:

- `list_endpoints`
- `get_endpoint_trace`
- `resolve_symbol`
- `get_symbol_dependents`
- `compare_analyses`
- `get_change_impact`
- `find_distributed_candidates`
- `get_policy_results`

Resources:

- Bounded artifact summaries.
- Individual evidence records by canonical evidence ID.
- Explicitly selected canonical records or report fragments.

Rules:

- Tools return structured content plus concise text, not entire multi-megabyte documents.
- `find_distributed_candidates` never accepts queue/pattern text as sufficient identity.
- Do not name current-snapshot dependency queries “blast radius.” Reserve that term for
  evidence-backed before/after or explicitly modelled hypothetical impact.

Implementation result:

- Registered all eight named tools as thin adapters over the frozen P0 query kernel.
  Their MCP input/output schemas are the exact query schemas, structured content is the
  validated P0 response, and the additional text is a deterministic concise summary.
- Kept endpoint and symbol ambiguity explicit, retained query pagination/traversal
  ceilings, labelled snapshot reverse reachability as dependents, and described system
  matches as conditional candidates rather than broker delivery or execution.
- Added repeatable `--policy <name>=<policy-results.json>` startup input with the same
  canonical-path, load-once, integrity-validation, and deep-freeze boundary as analysis
  and system artifacts. A fixed 64-artifact registry ceiling now bounds startup and
  registry-summary growth.
- Added resource schema `1.0.0`: one bounded immutable artifact/role summary, one exact
  evidence record by artifact and canonical evidence ID, or one exact top-level
  ID-bearing canonical record. Whole documents and caller-supplied filesystem paths are
  not resources; every projection is capped at 256 KiB.
- MCP server `1.1.0` advertises read-only, non-destructive, idempotent, closed-world
  tool annotations plus resources and completions. Prompts, remote transport, scanning,
  mutation, and background work remain absent.
- Preserved the engine's existing Zod `4.1.5` pin and published configuration-schema
  bytes. The SDK's official JSON-Schema bridge advertises and transport-validates JSON
  schemas generated from the authoritative P0 Zod contracts; the P0 kernel still runs
  the original strict parser and response validator for every call.
- Added a frozen P1.2 surface manifest and real in-memory MCP protocol tests for
  initialization, discovery, all eight calls, registry/evidence/record reads, concise
  text, structured response validation, and semantic annotations. Synchronized the
  README, MCP guide, CLI workflow, architecture, model contract, and documentation
  index.
- Final P1.2 verification passed all 156 test files and 410 tests with bounded worker
  concurrency, including the MCP protocol suite and configuration-schema byte-stability
  contract. Typecheck, production build, zero-warning lint, formatting, and the built
  MCP help/version entry-point checks also passed.

### Phase P1.3 — MCP hardening and evaluation

Status: complete

Deliverables:

1. Add adversarial path, oversized-output, malformed-artifact, ambiguity, and protocol
   fixtures.
2. Verify byte-stable structured results across repeated calls.
3. Create an agent evaluation corpus comparing unsupported unaided answers with
   artifact-grounded answers; measure citation accuracy, omitted dependencies, and
   false relationship claims.
4. Pass Gate MK0 and publish local setup documentation for multiple MCP hosts without
   claiming universal host feature parity.

Implementation result:

- Bumped the independently versioned MCP adapter contract to `1.2.0`. Every successful
  tool result now has a fixed 512 KiB ceiling over its complete canonical serialization
  and a 512-character summary ceiling. An oversized result becomes a bounded tool error
  rather than a schema-breaking partial object.
- Added a cooperative cancellation boundary before synchronous query execution. Each
  handler yields once to the protocol dispatcher and refuses to enter the P0 kernel when
  its request signal is already canceled; no background task or asynchronous analysis
  path was introduced.
- Hardened resource-template selectors with the canonical artifact-name contract,
  256-character decoded record/evidence IDs, a pre-decode component bound, and fixed
  invalid-selector errors. Tool arguments still cannot supply artifact paths or cause a
  filesystem lookup.
- Added a frozen P1.3 hardening manifest, malformed artifact files, and real in-memory
  protocol tests for ambiguity, invalid and path-shaped inputs, startup and projection
  size ceilings, cancellation, repeated-call byte stability, redaction, and absent
  scan/shell/network/mutation/sampling surfaces.
- Added a three-case deterministic agent-attribution corpus and evaluator for citation
  accuracy, omitted dependencies, and false relationship claims. Its synthetic baseline
  is explicitly not a live-model or cross-vendor performance claim.
- Published current local setup examples for VS Code and Cursor using the same stdio
  entry, while documenting host-specific trust, configuration, and capability differences.
  The MCP guide and living architecture/model/index/README references are synchronized.
- Gate MK0 passes: the server remains explicit-artifact-backed, local, read-only,
  bounded, cancellation-aware, protocol-tested, and free of scanning, arbitrary-file,
  shell, network, mutation, prompts, sampling, and background work.
- Final P1.3 verification passed 8 focused files and 36 tests, followed by the complete
  suite at 158 files and 418 tests. Typecheck, production build, zero-warning lint,
  formatting, and the built MCP `--help`/`--version` entry-point checks also passed.

Non-goals for MCP v1:

- Remote HTTP, OAuth, multi-tenancy, background tasks, target scanning, file writes,
  shell execution, source editing, or agent sampling.

## Milestone P2 — Vendor-neutral CI evaluation

### Phase P2.1 — CI result contract

Status: complete

Goal: compose existing artifacts into one portable, proof-bounded CI result.

Deliverables:

1. Define a strict `CiEvaluationDocument` with baseline/candidate provenance.
2. Summarize endpoint changes, repository-local potential impact, policy outcomes,
   diagnostics, gaps, and evidence locations.
3. Define distinct process outcomes for success, configured policy violation, invalid
   input, incompatible baseline, analysis failure, and cancellation.
4. Render deterministic Markdown, machine JSON, and a neutral annotation stream.
5. Do not add repository checkout or branch comparison logic to the engine core.

Implementation result:

- Added strict, independently versioned `CiEvaluationDocument` schema `1.0.0`, with a
  content-derived identity and fingerprints for the complete baseline, candidate,
  comparison, impact, and policy inputs.
- Enforced exact baseline/candidate schema, analysis configuration, toolchain, and
  cross-artifact snapshot compatibility. Valid mismatches fail as
  `incompatible_baseline`; invalid documents, failed analyses, and cancellation retain
  distinct process outcomes.
- Projected endpoint changes, repository-local potential impact, policy results,
  diagnostic changes, and explicit honesty gaps with canonical IDs and
  repository-relative evidence coordinates. Source snippets are not copied into the
  CI result.
- Added deterministic canonical JSON, Markdown, and provider-neutral JSONL annotation
  renderers. Configured warning findings remain non-blocking; only normalized blocking
  policy results produce `policy_violation`.
- Kept repository checkout, branch resolution, scanning, network access, provider APIs,
  and annotation-platform limits outside the P2.1 library boundary.
- Final P2.1 verification passed 3 focused files and 8 tests, followed by the complete
  suite at 161 files and 426 tests. Typecheck, production build, zero-warning lint, and
  formatting checks also passed.

### Phase P2.2 — Reproducible scan recipe

Status: complete

Goal: document and verify a safe way for CI wrappers to obtain compatible artifacts.

Deliverables:

1. Pin the engine distribution, Node range, and project configuration.
2. Install target dependencies from its lockfile with lifecycle scripts disabled.
3. Scan baseline and candidate in isolated directories, or consume a trusted baseline
   artifact with complete provenance.
4. Reject missing, stale, differently configured, or schema-incompatible baselines
   rather than silently comparing them.
5. Cache only immutable, keyed inputs; never let untrusted candidate jobs overwrite a
   trusted baseline cache.
6. Pass Gate CK0.

Implementation result:

- Added an independently versioned, strict `CiScanRecipeManifest` `1.0.0` that binds
  an exact P2.1 evaluation to the engine distribution, structured Node runtime policy,
  trusted project configuration, repository revisions, analysis provenance,
  dependency lockfiles, and explicit topology provenance.
- Added pinned `pnpm` and `npm` dependency plans with fixed executable/argument arrays,
  immutable lockfile mode, lifecycle scripts disabled, and independently pinned
  package-manager versions. The pnpm vector also disables repository-controlled
  pnpmfile hooks. Unsupported managers are rejected rather than guessed.
- Modelled a baseline as either a distinct isolated trusted scan or a trusted artifact
  retaining the dependency provenance of its producing scan. The candidate is always
  a distinct isolated untrusted scan.
- Added content-derived recipe identity, canonical byte serialization, and an immutable
  baseline cache key derived only from trusted baseline inputs. The fixed policy is
  trusted-writer/candidate-read-only with no fork secrets and a read-only candidate
  token.
- Added strict construction, integrity validation, and expectation verification.
  Missing, malformed, tampered, stale, differently configured, differently versioned,
  differently locked, or topology-incompatible inputs retain `invalid_input` or
  `incompatible_baseline` rather than becoming an empty/successful comparison.
- Kept checkout, branch resolution, filesystem/process execution, dependency install,
  scanning, network/cache APIs, and provider publication outside this pure library.
  Published the wrapper trust model and failure rules in
  `docs/ci-reproducible-scans.md`.
- Focused P2.2 verification passed 3 files and 11 tests. The complete suite passed
  163 files and 436 tests with two workers; typecheck, production build, zero-warning
  lint, and formatting checks also passed.

## Milestone P3 — Native CI checks

### Phase P3.1 — GitHub check integration

Status: complete and hosted-validated on GitHub

Goal: provide useful pull-request feedback without comment permissions.

Deliverables:

1. Package a pinned GitHub Action or container wrapper around the CI evaluation.
2. Run candidate analysis under the ordinary `pull_request` trust boundary.
3. Publish a job summary, bounded file/line annotations, and downloadable JSON/
   Markdown/offline-graph artifacts.
4. Request read-only repository permissions by default and no secrets for fork code.
5. Never use `pull_request_target` to execute candidate code or dependency scripts.

Implementation result:

- Added a composite `action.yml` backed by a checked-in ESM distribution built with
  exact `@vercel/ncc` `0.45.0` plus pinned `libpg-query` WASM and Cytoscape browser
  assets. A canonical fingerprint covers every emitted loader, chunk, metadata, WASM,
  and browser-asset file. The adapter verifies the actual Node and package-
  manager versions against the P2.2 recipe before publishing results; third-party
  artifact upload is pinned to a full commit SHA.
- The caller owns two exact-revision checkouts. The runner accepts only ordinary
  `pull_request`, resolves both beneath `GITHUB_WORKSPACE`, requires distinct
  directories, verifies each Git `HEAD` against required PR base/head SHA inputs, and
  accepts configuration only from the trusted baseline. Lockfiles
  cannot escape their checkout and output cannot escape lexically or through an
  existing symbolic-link ancestor.
- Implemented fixed immutable pnpm/npm installs with lifecycle scripts and pnpmfile
  hooks disabled, `shell: false`, and a small non-secret child-process environment allowlist. The
  action does not receive a comment token, call the GitHub API, persist checkout
  credentials, run target scripts, or retry an install with scripts enabled.
- Composed both source scans through the existing comparison, impact, policy, P2.1
  evaluation, P2.2 recipe, and offline graph engines. The action writes one content-
  addressed directory containing canonical evaluation/recipe/diff/impact/policy JSON,
  bounded Markdown and JSONL projections, the self-contained graph, and a manifest of
  file sizes and content hashes.
- Added an error-first GitHub projection capped at 50 annotations and 64 KiB of
  summary Markdown. Repository text and workflow commands are normalized and escaped;
  only safe candidate-relative evidence receives file coordinates. Remaining or
  baseline-only findings stay available as bounded job-level output/artifacts.
- The evaluation step records its stable portable outcome before the pinned upload
  step; a final composite step enforces success, policy violation, analysis failure,
  invalid input, incompatible baseline, or cancellation. This preserves evidence
  without pull-request comment permission.
- Published a read-only fork-safe reference workflow with full-SHA-pinned checkout and
  setup actions, isolated base/head paths, no persisted credentials, exact Node/pnpm,
  and no secrets. Documentation explicitly forbids `pull_request_target`, candidate-
  local action code and privileged runners without isolation. The action remains a
  single-repository workflow and does not automatically acquire the multi-service
  artifacts required by the now-complete P4.2 library contract.
- Frozen P3.1 adapter, outcome, limit, artifact, and action-pin expectations with
  projection, workflow-command injection, secret-environment, forbidden-event,
  bundle, metadata, and documentation tests.
- Focused P2.2/P3.1 verification passed 5 files and 22 tests. The complete suite passed
  166 files and 448 tests with two workers; typecheck, production build, the fresh
  bundled action build, zero-warning lint, formatting, and a bundled-entry smoke test
  also passed.
- Hosted GitHub validation then ran the exact-SHA reference workflow against
  `orders-worker-example` on Ubuntu 24.04, Node 22.14.0, and pnpm 11.19.0. An
  initial `e96886f2092efd61ab742f74dc78796cb2156fce` distribution exposed a real
  packaging gap when offline-graph generation tried to resolve Cytoscape from an
  absent runtime package tree. Commit `f5e60a39231f11cc28cbb75c3772032cb38880d5`
  colocated the exact pinned browser asset; the rerun validated Step Summary, bounded
  PR annotations, downloadable artifacts, and graph generation. This is P3.1 GitHub
  validation, not evidence that the P3.2 GitLab release gate has run.

### Phase P3.2 — GitLab check integration

Status: implementation complete; GitLab.com release validation deferred

Goal: provide equivalent semantics using GitLab-native reports.

Deliverables:

1. Publish a reusable CI component/template.
2. Map supported findings to Code Quality or SARIF-style report artifacts and retain
   the canonical CI evaluation as a downloadable artifact.
3. Keep merge-request comments out of the required path because ordinary job tokens
   may not have note-writing permission.
4. Test GitLab.com and document self-managed/version constraints explicitly.

Implementation result:

- Extracted the P3.1 effectful scan path into a provider-neutral CI adapter runner.
  GitHub and GitLab now share exact revision/path checks, trusted-baseline
  configuration, immutable no-script dependency preparation, analysis, comparison,
  impact, policy, P2.1 evaluation, P2.2 recipe verification, and offline graph
  generation. Provider layers cannot drift on evaluation semantics.
- Added a strict GitLab adapter/projection contract and generated Code Quality JSON
  containing only supported candidate-relative file/start-line findings. Portable
  failures map to `blocker`, warnings to `major`, and notices to `info`; deterministic
  fingerprints, a 500-record error-first cap, escaped 64 KiB summary, and explicit
  omitted counts preserve bounded behavior. Baseline-only/job-level/unsafe findings
  stay canonical artifact evidence rather than receiving invented locations.
- Added `templates/api-intel/template.yml` with typed component inputs, selectable job
  name/stage, MR-only rules, full Git history, exact GitLab diff-base/candidate SHA
  worktrees outside candidate content, mandatory image input, always-uploaded Code
  Quality/canonical artifacts, and no API/comment/token dependency.
- Added a checked-in `gitlab-dist` build path and OCI Dockerfile. The component design
  requires both the component include and image manifest to be immutably pinned; there
  is intentionally no mutable default image. The image includes exact npm/pnpm,
  Git/CA support, the complete ncc distribution, and pinned SQL-parser WASM and
  Cytoscape browser assets.
  Component input validation plus a runtime `CI_JOB_IMAGE` check rejects mutable image
  references, and the exact digest reference is retained in provider artifacts.
- Added fresh-publication checks so candidate files or symlinks cannot control
  `.api-intel-gitlab`. Successful evaluation writes fixed GitLab upload entrypoints and
  a content-addressed canonical directory with a file-integrity manifest. Handled
  process failures publish an empty valid Code Quality array and stable process result,
  never guessed findings.
- Documented diff-base semantics, fork/parent-runner risk, dependency/network limits,
  GitLab 17.0+ and self-managed requirements, component/image mirroring, artifacts,
  inputs, and portable exit codes. A consumer example pins placeholders for a full
  component SHA and registry digest.
- Focused P2/P3 verification passed 10 files and 38 tests. The complete suite passed
  169 files and 457 tests with two workers; typecheck, production build, zero-warning
  lint, formatting, fresh GitHub and GitLab ncc builds, both bundled-entry smoke tests,
  and both copies of the pinned WASM and Cytoscape assets passed locally. The shared
  Cytoscape packaging design also passed a hosted GitHub run, but no GitLab project,
  registry credential, or published component/image is available in this workspace,
  so the GitLab.com CI Lint/fork/success/policy-violation runs have not been fabricated.
  Hosted release validation is explicitly deferred by product decision. The adapter
  remains locally verified but must not be described as hosted-validated; this deferred
  publication gate does not block the provider-neutral P4 contract work.

## Milestone P4 — Differential system impact

### Phase P4.1 — System comparison contract

Status: complete

Goal: make cross-service change statements evidence-backed.

Deliverables:

1. Compare explicit baseline/current service artifact sets and topology manifests.
2. Track added/removed/modified producers, consumers, realms, bindings, ambiguity, and
   conditional paths.
3. Preserve missing-service and incompatible-artifact states as unknown, not absent.
4. Define a versioned `SystemImpactDocument` before adding CI presentation.

Implementation result:

- Added the independent `SystemImpactDocument` schema `1.0.0`, content-derived
  `system_impact` identity, canonical ordering/serialization, strict Zod shape, and
  semantic integrity validation without changing `SystemAnalysisDocument`.
- Comparison input now declares the same service namespace scope on both sides and
  classifies each artifact as `available`, `not_present`, `missing`, or `incompatible`.
  Only explicit `not_present` may support an addition/removal statement; missing or
  incompatible artifacts produce `completed_with_unknowns` and suppress affected
  comparisons rather than masquerading as empty services.
- Producer and consumer identity uses service namespace, role, and the canonical
  source analysis record ID. Correlations use those endpoint identities; distributed
  target text is retained as a changeable contract fact and is never sufficient to
  match records by itself.
- Added deterministic changes for services, producers, consumers, topology realms,
  explicit bindings, correlations, ambiguity transitions, and declared-realm
  conditional-candidate eligibility. Semantic-key collisions become explicit
  uncertainties and are suppressed on both sides rather than selecting a record.
- Kept causal propagation structurally unavailable with
  `propagation: { state: "not_computed", reason: "phase_p4_1_contract_only" }`.
  These candidate deltas do not claim delivery, handler execution, downstream effects,
  or cross-service blast radius; that language remains gated on P4.2.
- Added executable contracts for target-only to declared-realm transitions,
  missing-versus-known-absent services, deterministic serialization, scope validation,
  identity validation, and summary integrity. Published the living system-impact
  contract and synchronized architecture/model/reference documentation.
- Final P4.1 verification passed all 171 test files and 465 tests with two workers.
  Typecheck, production build, zero-warning lint, and formatting checks also passed.

### Phase P4.2 — Conditional cross-service blast radius

Status: complete

Deliverables:

1. Propagate changes only across `declared_realm_candidate` correlations.
2. Mark downstream worker effects as distributed-conditional.
3. Add bounded paths, cycle protection, provenance, deterministic ordering, and impact
   graph overlays.
4. Only after this phase may CI claim that a changed service potentially affects a
   worker or side effect in another service.

Implementation result:

- Added `SystemImpactDocument` schema `2.0.0` as a strict enrichment of a validated,
  unpropagated P4.1 document. It binds exact before/after system snapshots and every
  available source artifact, publishes their canonical content fingerprints, then
  derives repository-local impact documents in memory.
- Seeds come from locally impacted HTTP endpoints and changed producer records. A seed
  enters the distributed traversal only when it reaches a producer whose correlation
  state is exactly `declared_realm_candidate`; target-only, ambiguous, and unmatched
  records remain non-traversable.
- Added deterministic multi-hop producer/broker/consumer paths, downstream table and
  resource effects labelled `distributed_conditional`, exact analysis/assertion/
  evidence provenance, explicit incompleteness, branch-aware BullMQ filtering, fan-out,
  cycle termination, and hard hop/path/effect/state ceilings with omitted counts.
- Added side-specific graph overlays whose IDs align with the existing system report,
  plus `renderOfflineSystemImpactReport()` and a default **Potential impact** view. The
  self-contained HTML highlights only retained P4.2 paths and repeats the non-delivery
  honesty boundary.
- The pure P4.2 library now permits a consumer adapter to say that an evidence-backed
  local change _potentially affects_ a named cross-service worker/effect, qualified as
  distributed-conditional. Existing P3 single-repository workflows do not acquire or
  publish this multi-service artifact automatically.
- Frozen scanned fixtures cover unchanged declared contracts carrying an upstream code
  change, target-only exclusion, source/system provenance mismatch, effect ceilings,
  deterministic ordering, offline overlay rendering, and a cyclic broker cascade.
- Final P4.2 verification passed all 172 test files and 468 tests with two workers.
  Typecheck, production build, fresh GitHub and GitLab ncc bundles, zero-warning lint,
  and repository-wide formatting checks also passed.

## Milestone P5 — Optional comment publisher

### Phase P5.1 — Sanitized comment document

Status: complete

Deliverables:

1. Project a small, schema-validated comment model from `CiEvaluationDocument`.
2. Escape all repository-derived Markdown and enforce item/byte limits.
3. Include the run identity and artifact links; keep full evidence in CI artifacts.
4. Upsert one identified bot comment rather than appending a comment every run.

Implementation result:

- Added strict, provider-neutral `CiCommentDocument` schema `1.0.0`, canonical
  serialization, content-derived identity, and a pure projection from one validated
  `CiEvaluationDocument`. It carries exact evaluation/candidate provenance, complete
  numeric summary, bounded failure-first findings, run identity, and evidence-artifact
  links without source snippets.
- Normalized all display text, removed control/newline and bidirectional override
  sequences, fully escaped Markdown/HTML syntax, and accepted only normalized,
  credential-free HTTPS run/artifact destinations. Unsupported kinds, empty artifact
  sets, unsafe URLs, excessive candidate links, and invalid limit overrides fail
  closed.
- Added explicit candidate/included/omitted counts with defaults of 20 findings and 8
  links, hard ceilings of 50 findings, 20 links, and 60,000 rendered bytes, and
  deterministic trimming that preserves at least one evidence-artifact link.
- Published one schema-literal upsert key and marker, constant across runs. P5.1 does
  not call a provider or treat marker possession as update authority; bot ownership,
  request identity, and authenticated mutation remain P5.2 responsibilities.
- Added internal integrity validation plus a stronger source-binding validator that
  rechecks outcome, summary, candidate provenance, annotation population, and the
  exact retained finding prefix against the trusted evaluation.
- Final P5.1 verification passed all 174 test files and 474 tests with two workers.
  Typecheck, production build, fresh GitHub and GitLab ncc bundles, zero-warning lint,
  and repository-wide formatting checks also passed.

### Phase P5.2 — Privileged publisher adapters

Status: complete

Deliverables:

1. Separate analysis from authenticated publication.
2. Add optional GitHub and GitLab publishers with least-privilege tokens.
3. Treat candidate-produced artifacts as untrusted input; validate them without
   executing or interpolating their content.
4. Degrade to summaries/annotations when comment permission is unavailable.

Implementation result:

- Added separate opt-in GitHub issue-comment and GitLab merge-request-note library
  adapters. The P3 candidate-analysis jobs remain read-only and receive neither a
  provider API token nor comment permission.
- Both adapters strictly validate the P5.1 comment against its exact validated CI
  evaluation, then bind the evaluation's baseline and candidate repository revisions
  to trusted provider-event values before the first authenticated request. Provider
  target, API origin, revisions, numeric bot identity, and token remain trusted caller
  configuration rather than artifact fields.
- Implemented deterministic marker-and-owner upsert semantics: unowned marker copies
  are ignored, zero owned matches create, one updates or no-ops, and multiple owned
  matches fail closed. Mutation responses must identify the configured bot account;
  neither adapter deletes comments.
- Bounded provider access to 10 pages of 100 records, 1 MiB per response, and a
  configurable 1-30 second timeout (15 seconds by default). API bases must be
  credential-free HTTPS, redirects are rejected, and unexpected statuses or malformed
  response shapes are typed failures.
- Mapped `401`, `403`, and provider-masked `404` to the nonblocking
  `permission_unavailable` result so existing native P3 summaries, annotations/Code
  Quality, and artifacts remain the fallback. Other integrity and transport failures
  are not disguised as permission failures.
- Added strict publication-result schema `1.0.0`, adversarial injected-HTTP coverage,
  and an operational guide for trusted follow-up jobs, least-privilege tokens,
  concurrency, enterprise/self-managed origins, and GitHub `workflow_run` safety.
  Provider calls are mock-verified only; no real hosted comment mutation is claimed.
- Final P5.2 verification passed all 176 test files and 485 tests with two workers.
  Typecheck, production build, fresh GitHub and GitLab ncc bundles, zero-warning lint,
  repository-wide formatting, and diff whitespace checks also passed.

## Milestone P6 — Remote MCP only on demonstrated demand

Status: deferred

Goal: host query capabilities without weakening local guarantees.

Required work:

1. Streamable HTTP transport and protocol-version compatibility.
2. OAuth/resource audience validation, scoped authorization, and tenant isolation.
3. Artifact encryption, retention, deletion, audit logging, quotas, and rate limits.
4. Network threat model, penetration testing, and operational ownership.

Explicitly excluded until P6 is activated:

- Public unauthenticated endpoints.
- Token passthrough.
- Arbitrary filesystem roots supplied per tool call.
- Remote source scanning or target-code execution.

## Deferred adjacent ideas

- A proof-only in-process event-cycle policy may be planned separately. Broker cycles
  must not be inferred from candidate delivery links.
- Hypothetical symbol impact requires a dedicated semantic contract and must not be
  approximated by fabricating a before/after document.
- Reliability multiplier claims require the P1.3 evaluation corpus.

## Recommended activation order

1. P0 query kernel.
2. P1 local read-only MCP.
3. P2 vendor-neutral CI evaluation.
4. P3 native GitHub/GitLab checks.
5. P4 differential system impact.
6. P5 optional comment publisher.
7. P6 remote MCP only if demand and operational ownership justify it.
