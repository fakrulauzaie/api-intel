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

| Surface or environment                                    | Exact evidence                                                                                                    | Label                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Core source/build/test                                    | Windows x64, Node.js 22.13.1, pnpm 11.19.0                                                                        | verified locally; core-alpha candidate                                    |
| Packed CLI/MCP install                                    | Windows x64, Node.js 22.13.1, npm 10.9.2 and pnpm 11.19.0, exact reviewed archive                                 | verified for that archive/environment only                                |
| Real-package target corpus                                | `@nestjs/common`/`core` 11.2.1, `@nestjs/typeorm` 11.0.3, TypeORM 1.1.0, better-sqlite3 12.11.1, TypeScript 5.9.3 | verified synthetic application combination; not a framework-major promise |
| GitHub pull-request adapter                               | Ubuntu 24.04, Node.js 22.14.0, pnpm 11.19.0                                                                       | hosted-validated preview for that exact path                              |
| GitLab component/container                                | GitLab 17.0+ contract; `node:22.14.0-bookworm-slim`, pnpm 11.19.0                                                 | locally verified preview; GitLab-hosted execution unverified              |
| Comment publishers                                        | GitHub and GitLab HTTP/upsert/permission contracts                                                                | mock-verified preview; no hosted mutation claim                           |
| Candidate source CI cells                                 | Ubuntu 24.04 and Windows 2025 with Node.js 22.13.1/24.20.0                                                        | unverified until retained hosted runs pass                                |
| macOS                                                     | no maintained package/source run                                                                                  | unverified                                                                |
| Offline graph browser                                     | browser-unspecified manual interaction/accessibility pass plus deterministic offline/CSP tests                    | core-alpha candidate; no named-browser support claim                      |
| MCP hosts                                                 | protocol and local stdio tests                                                                                    | core-alpha candidate; no universal host claim                             |
| Remote MCP, hosted analysis, SaaS, telemetry, IDE plugins | no released surface                                                                                               | unsupported for alpha / deferred                                          |

Phase O3.1 defines the four-cell [neutral repository CI](neutral-repository-ci.md)
candidate matrix, but a declared matrix is not execution evidence. The
[supported-patterns matrix](supported-patterns.md) describes AST semantics, not broad
package-version support. Declaration-only fixtures remain semantic evidence rather
than package-version compatibility evidence.

The current [limitations ledger](current-limitations.md) separately records semantic,
runtime, distributed, privacy, and public-API boundaries.

No public version is supported before the first alpha is published.

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
