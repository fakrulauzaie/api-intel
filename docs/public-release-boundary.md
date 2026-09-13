# Public Identity and Alpha Surface Contract

Status: normative productization contract  
Applies from: Phase O0.2  
Decision date: 2026-09-09  
Exact external publication action authorized: yes

This document freezes the identity, release-surface labels, initial public package
shape, maturity vocabulary, and evidence-based compatibility claims for the first
open-source alpha. It does not reserve a name, publish a package, change repository
visibility, adopt a permanent domain, or independently grant rights beyond the root
license.

The [product charter](product-charter.md) remains authoritative for positioning and
proof language. This contract determines where those claims may be exposed and which
surface-specific qualifiers must accompany them.

## Identity decision

| Role                          | Selected identity                                           |
| ----------------------------- | ----------------------------------------------------------- |
| Formal product name           | **Backend API Intelligence Engine**                         |
| Category                      | **Deterministic NestJS change intelligence**                |
| Primary positioning           | **Evidence-backed blast radius for legacy NestJS systems.** |
| CLI shorthand and primary bin | `api-intel`                                                 |
| Local MCP bin                 | `api-intel-mcp`                                             |
| Repository slug               | `api-intel`                                                 |
| First npm package candidate   | `@fakrulauzaie/api-intel`                                   |
| Permanent product/domain URL  | None adopted for alpha                                      |
| Project license               | Apache-2.0; project-owned source authorized by owner        |

The formal name remains descriptive and NestJS-focused. `api-intel` is a lowercase
command/package shorthand, not a standalone “Intel” wordmark; project copy must not
imply affiliation with or endorsement by Intel Corporation. O1.1 selected and
mechanically applied Apache-2.0. The owner authorized qualifying project-owned source
on 2026-09-10; third-party obligations and the prohibition on organization-derived
public material remain release gates.

The personal npm scope is selected because it matches the current distribution owner
used by existing GitHub/OCI work and avoids depending on an unreserved global package
name. A future organization transfer must preserve package provenance and migration
instructions; it is not a reason to invent an organization before alpha.

The public source repository is
[`fakrulauzaie/api-intel`](https://github.com/fakrulauzaie/api-intel), created as a new
sanitized repository with fresh history. The current implementation repository and its
reachable history remain private and unchanged. The
[public repository strategy](public-repository-strategy.md) defines that separation.

The [ownership and publication authorization](legal/ownership-and-publication-authorization.md)
records the scope of owner approval. Permission to use organization systems as private
testing targets is not redistribution permission. The owner separately authorized the
exact O5.2 repository and package publication sequence on 2026-09-13.

## Availability and conflict audit

The checks below are point-in-time discovery, not reservation, trademark clearance,
or legal advice.

| Candidate                                                                          | 2026-09-09 result                                                                                                                           | Decision                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [`api-intel`](https://www.npmjs.com/package/api-intel)                             | The official npm registry returned `E404 Not Found`.                                                                                        | Do not use the unscoped name for the first release; it can be claimed before O5.                                                   |
| [`@fakrulauzaie/api-intel`](https://www.npmjs.com/package/@fakrulauzaie/api-intel) | The official npm registry returned `E404 Not Found`; a publisher search returned no public packages under that scope.                       | Selected package candidate, subject to authenticated scope-ownership verification immediately before O5 publication.               |
| “API Intel” / “Backend API Intelligence” exact-name searches                       | No obvious exact-match NestJS static-analysis product was identified; “API intelligence” and “intel” are crowded, generic technology terms. | Keep the descriptive formal name, lowercase shorthand, explicit NestJS category, and no affiliation claim. O1.1 must still review. |
| `api-intel.dev` or another permanent domain                                        | Not required for a local-first alpha and not reserved by this phase.                                                                        | Use repository-relative/package-shipped schema and documentation paths until an owned domain is deliberately approved.             |

Availability can change at any time. O5 must repeat the exact registry lookup, verify
the authenticated publisher owns the selected scope, and stop rather than silently
falling back to another name.

No `api-intel.dev` schema URL, package badge, registry install command, immutable tag,
or public release URL may appear as current until the corresponding resource exists
and its release gate passes.

## Initial package and public API boundary

The first npm package is **CLI-first**. It has two executable entrypoints and no
supported JavaScript/TypeScript import surface:

- `api-intel` — the capability-preflight, explicit initialization, analysis, artifact-reading, comparison,
  impact, policy, export, graph, and stitching CLI;
- `api-intel-mcp` — the local, read-only stdio MCP server over explicitly supplied
  artifacts.

The supported `api-intel` command names are finite:

```text
doctor
init
scan
diff
impact
check
openapi
controls
graph
stitch
endpoints
trace
report
```

The supported local MCP tool names are finite:

```text
list_endpoints
get_endpoint_trace
resolve_symbol
get_symbol_dependents
compare_analyses
get_change_impact
find_distributed_candidates
get_policy_results
```

Canonical JSON documents, shipped JSON Schemas, the CLI artifact readers, and exact
selected MCP resources are supported data surfaces subject to their own schema
versions. Internal `dist/` modules, source paths, extractor classes, report-builder
internals, query-kernel imports, provider libraries, and deep imports are not public
package APIs in alpha.

O2 must enforce this decision with package contents and export maps. O7.3 may later
propose a small reader/query API after external demand and compatibility policy exist;
it must not retroactively turn alpha internals into supported exports.

## Surface labels

Maturity and validation are separate dimensions. “Preview” does not mean broken, and
“alpha” does not imply every adapter has the same evidence.

| Surface                                                                    | Alpha label                  | Evidence boundary                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api-intel` CLI and canonical artifact readers                             | **core-alpha candidate**     | Repository tests, real-repository validations, one exact Windows x64 clean-package installation gate, and a local O3.1 source/coverage observation exist. The hosted source matrix remains pending.          |
| Canonical analysis/comparison/impact/policy/system documents               | **core-alpha candidate**     | Versioned schemas, validators, compatibility readers, golden tests, and deterministic projections exist. Each document retains its own version.                                                              |
| Offline graph and system graph                                             | **core-alpha candidate**     | Deterministic/self-contained/CSP/accessibility contracts and a browser-unspecified manual interaction pass exist. O3.2 intentionally retains no named browser claim until versioned browser evidence exists. |
| `api-intel-mcp` local stdio server                                         | **core-alpha candidate**     | Read-only bounded protocol tests and local setup guidance exist. No universal MCP-host compatibility claim.                                                                                                  |
| GitHub pull-request Action                                                 | **hosted-validated preview** | One retained GitHub-hosted Ubuntu 24.04 run used Node 22.14.0 and pnpm 11.19.0 and validated summary, annotations, artifact upload, and graph generation. Other runner operating systems are unverified.     |
| GitLab 17.0+ component and OCI image                                       | **locally verified preview** | Source, component, projection, bundled-runtime, container, and asset checks passed locally. GitLab-hosted execution/catalog publication remains deferred.                                                    |
| GitHub/GitLab comment publishers                                           | **mock-verified preview**    | Provider-neutral projection and mocked HTTP/upsert/permission contracts passed. No real hosted comment mutation is claimed.                                                                                  |
| Remote/network MCP, hosted source analysis, SaaS, telemetry, or IDE plugin | **deferred**                 | Not part of the alpha release surface.                                                                                                                                                                       |

Every README, release note, package page, action page, image label, and integration
guide must preserve the exact label applicable to its surface. Evidence from one
surface cannot upgrade another.

## Maturity channels

| Channel      | Meaning                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `internal`   | Built or tested in the repository but not offered as a public release contract.                                                            |
| `alpha`      | Publicly usable, narrowly scoped, and expected to change; exact limitations and migration expectations are published.                      |
| `beta`       | Repeated external use and clean upgrades exist; selected interfaces are stabilizing but may still change under documented migration rules. |
| `stable`     | The 1.0 compatibility, security, release, and migration gates have passed.                                                                 |
| `preview`    | A surface-specific validation qualifier used beside a maturity channel: `hosted-validated`, `locally verified`, or `mock-verified`.        |
| `deferred`   | Not shipped or claimed by the current channel.                                                                                             |
| `historical` | Evidence about a dated input/environment, not a current support promise.                                                                   |

The current source version `0.1.0-alpha.1` is the selected alpha release-candidate
version. It is not a published alpha until the separately authorized O5.2 publication
step completes.

## Community activation boundary

The repository has source-controlled contribution, support, compatibility, security,
conduct, governance, maintainer, issue-form, pull-request, DCO, and changelog contracts.
GitHub Private Vulnerability Reporting and the private conduct-reporting contact are
active. Issue and discussion intake remain disabled until the repository requires the
`DCO / signed-off commits` check and the exact release commit passes hosted CI.

## Independent version domains

The following versions must never be presented as one lockstep product version:

1. npm package semantic version;
2. analysis document schema version;
3. comparison, impact, policy, graph, system, CI, and other derived-document versions;
4. project configuration version;
5. MCP server/resource/tool contract versions;
6. GitHub Action, GitLab component, OCI image, and distribution fingerprints; and
7. compatibility/support matrix revision.

A package release may read multiple older schema versions. A schema major change does
not require the same package major, and a package major does not imply every document
schema changed. Release notes must list each changed domain explicitly.

## Initial compatibility claim matrix

This matrix freezes only evidence already retained in the repository. O3.1's four-cell
matrix remains a candidate until a clean hosted run is retained.

| Dimension                                     | Initial claim                                                                                                              | Evidence label / limitation                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Core development/runtime on Windows x64       | Node.js 22.13.1; pnpm 11.19.0                                                                                              | Locally verified source/build/test environment. This is not clean npm-package installation evidence.                        |
| GitHub hosted adapter                         | Ubuntu 24.04; target Node.js 22.14.0; pnpm 11.19.0                                                                         | Hosted-validated preview for that exact path only.                                                                          |
| GitLab container adapter                      | `node:22.14.0-bookworm-slim`; pnpm 11.19.0                                                                                 | Locally verified preview. No GitLab-hosted or self-managed instance claim.                                                  |
| Node.js 24                                    | Node.js 24.20.0 is pinned in the O3.1 candidate matrix                                                                     | Unverified until the hosted Linux and Windows cells pass; the manifest range or workflow alone is not evidence.             |
| macOS                                         | No current verified core/package path                                                                                      | Unverified. Do not advertise support yet.                                                                                   |
| npm and pnpm consumer installation            | The exact alpha archive passed isolated npm 10.9.2 and pnpm 11.19.0 installation on Windows x64 with Node.js 22.13.1       | Verified for this exact environment only; broader versions and platforms remain unverified pending hosted evidence.         |
| Engine TypeScript compiler                    | Exactly 5.9.3 in the current lockfile                                                                                      | Pinned implementation input, not a broad target-TypeScript compatibility range.                                             |
| Generated declaration-stub fixtures           | Pinned synthetic package declarations used by extractor tests                                                              | Generated declaration stubs prove semantic rules, not framework-version compatibility.                                      |
| Pinned real-package compatibility corpus      | NestJS common/core 11.2.1, NestJS TypeORM 11.0.3, TypeORM 1.1.0, better-sqlite3 12.11.1, and TypeScript 5.9.3              | Locally verified on Windows x64 / Node 22.13.1; hosted matrix evidence is pending and no adjacent version is implied.       |
| Additional NestJS/TypeORM/TypeScript versions | No range frozen                                                                                                            | Unverified; declaration stubs and adjacent versions cannot establish compatibility.                                         |
| Browser rendering                             | Self-contained graph generation is automated; one local manual interaction pass is retained without a named browser matrix | O3.2 keeps named browser support unverified; each future named browser requires its own retained automated/manual evidence. |
| Local MCP clients                             | Stdio protocol/tools/resources are tested; VS Code/Cursor setup is documented                                              | No universal host/editor endorsement or compatibility claim.                                                                |

When a version is not named above, say `unverified`, not `unsupported`, unless an
executable contract explicitly rejects it.

## Explicit exclusions

The alpha boundary excludes:

- a public JavaScript SDK or stable deep imports;
- an extractor/plugin API or marketplace;
- a permanent website/domain or hosted schema service;
- GitLab-hosted validation inferred from local Docker execution;
- real comment mutation inferred from mocked publisher tests;
- Node.js 24, macOS, broad package-manager, framework-major, or browser support inferred
  from manifests, declaration stubs, or adjacent surfaces;
- remote MCP, source upload, telemetry, SaaS, or IDE plugins; and
- automatic refactoring or runtime-observation claims.

## Cleared credential prerequisite carried to O1.2

The local Git remote previously contained an embedded GitHub credential; its secret
value is intentionally omitted from every record. On 2026-09-09 the owner confirmed
rotation and replaced the origin. A redacted verification found a credential-free
HTTPS remote, no matching token pattern in `.git/config`, and no matching tracked-file
hit. O1.2 still owns the broader current-tree, release-candidate, and repository-history
audit; this narrow check does not establish history sanitation.

## Change control

Phase O4.2 deliberately added the narrow `init` command after its preview, no-overwrite,
and first-use contracts passed; this is the recorded alpha-list update rather than an
implicit surface expansion. Changing the formal name, package scope, bins, alpha command/tool list, public API
shape, maturity vocabulary, or support labels reopens Gate OG0. Expanding a version or
platform claim requires executable evidence in the owning later gate; documentation
alone cannot upgrade a surface.
