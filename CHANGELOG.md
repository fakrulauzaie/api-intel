# Changelog

This file records user-visible package, schema, compatibility, security, and community
contract changes. The package version and each artifact schema version are independent;
release entries must identify every changed version domain explicitly.

## Unreleased

No changes recorded after the alpha candidate freeze.

## 0.1.0-alpha.1 — 2026-09-12

### Changed

- Recorded the project owner's scoped Apache-2.0 publication authorization and made
  organization-derived material from private testing targets an explicit public-
  release blocker without weakening third-party or OCI obligations.
- Adopted the scoped `@fakrulauzaie/api-intel` package identity while retaining the
  private source-manifest guard, moved TypeScript into the production runtime graph,
  and added deterministic build/runtime/lifecycle verification before packing.
- Curated a CLI-first npm surface with two data-only JSON Schema exports, excluded
  declarations/source maps and provider bundles, and added exact tarball content,
  integrity, size-budget, and distribution-asset verification.
- Verified the exact reviewed archive in isolated npm and pnpm consumers, including
  installed CLI/MCP entrypoints, schema and runtime-asset resolution, a raw-SQL scan,
  an offline graph, and bounded missing-dependency/invalid-tsconfig diagnostics.
- Added a provider-independent source CI candidate covering pinned Node 22/24 on Linux
  and Windows, exact real NestJS/TypeORM/TypeScript compatibility evidence,
  configuration-schema drift, bounded resource/trust controls, and threshold-free
  coverage observation. Hosted matrix validation remains pending.
- Added byte-for-byte GitHub/GitLab provider rebuild verification, a canonical
  release-artifact ledger, a full controlled-target Action smoke, a cross-platform
  OD0 smoke mode, and an unprivileged GitLab image runtime. Hosted execution and named
  browser claims remain independently gated.
- Added a lockfile-bound vulnerability gate with expiring reviewed exceptions,
  deterministic CycloneDX/source-input/checksum evidence, and a content-addressed
  non-publishing release dry run. Remediated the current critical/high development-
  dependency advisories instead of accepting exceptions.

### Added

- Added `api-intel init [repository]`, a deterministic preview-first initializer that
  creates only a minimal strict version-4 configuration behind explicit `--write`,
  requires TypeScript-proven NestJS declarations, and never overwrites an existing
  file. Added the installed interactive/headless first-trace workflow and proof-gap
  guidance.
- Added `api-intel doctor [repository]`, a source-safe, read-only-by-default preflight
  with stable checks for repository and TypeScript readiness, resolved framework
  declarations, exact compatibility evidence, configuration bounds, runtime assets,
  capabilities, and an explicit bounded `--probe-output` mode.
- Public positioning and proof-boundary charter.
- Apache-2.0 license, third-party notices, provenance, privacy, and redistribution
  records.
- Community, contribution, governance, support, compatibility, security, conduct, DCO,
  and source-safe issue-intake contracts.
- Selected fresh-history strategy for a future sanitized public repository.

### Security

- Current-tree, npm-candidate, and redacted read-only history sanitation audits.

## 0.1.0 — Internal development snapshot

This version identifies the current private development tree. It has not been
published and is not a supported public release. Its implemented capabilities are
described by the living documentation and executable tests, not by a historical
release claim.
