# Compatibility and Version Support

Status: normative alpha policy  
Applies from: Phase O1.3

## Evidence labels

Compatibility claims use four distinct states:

- **supported:** named in the current compatibility matrix and covered by a maintained
  executable path for the released surface;
- **verified:** passed a recorded environment/fixture, but may be narrower than a
  general support promise;
- **unverified:** no maintained evidence exists; this does not prove incompatibility;
  and
- **unsupported:** deliberately rejected or outside a documented product boundary.

A package manifest range, TypeScript declaration stub, successful adjacent version,
or user report cannot upgrade `unverified` to `supported`. Framework syntax coverage
and framework-version compatibility are separate claims.

## Current matrix

This table is the concise public support view. The detailed evidence record remains in
the [public identity and alpha surface contract](public-release-boundary.md#initial-compatibility-claim-matrix).

| Surface or environment                                    | Exact evidence                                                                                                    | Label                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Core source/build/test                                    | Ubuntu 24.04 and Windows 2025, Node.js 22.13.1/24.20.0, pnpm 11.19.0, exact release commit                        | verified in all four hosted source cells; core alpha                  |
| Published CLI/MCP install                                 | Ubuntu 24.04 and Windows 2025, Node.js 22.13.1/24.20.0, npm and pnpm consumers, exact public archive              | verified in all four O5.3 cells; core alpha                           |
| Real-package target corpus                                | `@nestjs/common`/`core` 11.2.1, `@nestjs/typeorm` 11.0.3, TypeORM 1.1.0, better-sqlite3 12.11.1, TypeScript 5.9.3 | verified exact application combination in the hosted source matrix    |
| GitHub pull-request adapter                               | Ubuntu 24.04, Node.js 22.14.0, pnpm 11.19.0                                                                       | hosted-validated preview for that exact path                          |
| GitLab component/container                                | GitLab 17.0+ contract; `node:22.14.0-bookworm-slim`, pnpm 11.19.0                                                 | locally verified preview; GitLab-hosted execution unverified          |
| Comment publishers                                        | GitHub and GitLab HTTP/upsert/permission contracts                                                                | mock-verified preview; no hosted mutation claim                       |
| Released source CI cells                                  | Ubuntu 24.04 and Windows 2025 with Node.js 22.13.1/24.20.0                                                        | verified for source commit `641d830176f9ba36875392edd5c419da9d5e01b1` |
| macOS                                                     | no maintained package/source run                                                                                  | unverified                                                            |
| Offline graph browser                                     | browser-unspecified manual interaction/accessibility pass plus deterministic offline/CSP tests                    | core alpha; no named-browser support claim                            |
| MCP hosts                                                 | protocol, local stdio tests, and exact packaged-entrypoint probes                                                 | core alpha; no universal host claim                                   |
| Remote MCP, hosted analysis, SaaS, telemetry, IDE plugins | no released surface                                                                                               | unsupported for alpha / deferred                                      |

The exact release commit passed the four-cell
[neutral repository CI](neutral-repository-ci.md) matrix in retained run
[`34756419218`](https://github.com/fakrulauzaie/api-intel/actions/runs/34756419218).
The exact npm archive and released Action then passed the independent
[O5.3 published-release matrix](published-release-verification.md) in retained run
[`34835680659`](https://github.com/fakrulauzaie/api-intel/actions/runs/34835680659). The
[supported-patterns matrix](supported-patterns.md) describes AST semantics, not broad
package-version support. Declaration-only fixtures remain semantic evidence rather
than package-version compatibility evidence.

The current [limitations ledger](current-limitations.md) separately records semantic,
runtime, distributed, privacy, and public-API boundaries.

The current maintained public version is `0.1.0-alpha.1`. Only the exact combinations
above are verified; other combinations remain unverified unless explicitly rejected.

## Version support

During alpha, only the latest published prerelease is maintained by default. Security
and correctness fixes are not routinely backported. A release note may announce a
specific exception, but silence is not a backport commitment.

Alpha releases may contain breaking CLI, configuration, report, or schema changes.
Every release must identify changed version domains, provide migration notes where a
supported reader or workflow changes, and avoid calling an artifact-schema major bump
a package major bump unless both actually changed.

## Reporting a compatibility gap

Use the framework-support issue form with exact package/runtime versions, the smallest
synthetic pattern, the observed diagnostic or proof stop, and a link to authoritative
framework documentation. Do not attach private source or assume that a declaration-
stub test proves real-package compatibility.

Support expectations and exclusions are in [SUPPORT.md](../SUPPORT.md).
