# Release Integrity and Response

Phase O3.3 defines a non-publishing release-candidate pipeline. It binds dependency
decisions, legal evidence, package/provider bytes, source identity, and toolchain
versions without creating a tag, release, package, image, repository, or registry
mutation. Passing these local checks is necessary release evidence; it is not release
authorization and does not complete Gate OR0 by itself.

O5.2 subsequently performed an explicitly authorized manual publication of the
audited npm archive, sanitized source, GitHub release, and GitHub Action. O5.3 verified
the exact published npm and Action surfaces. The non-publishing O3.3 mechanics remain
the preparation contract; they must not be read as saying those later publications
did not occur.

## Canonical policy and evidence

[`../packaging/release/release-integrity-policy.json`](../packaging/release/release-integrity-policy.json)
is the reviewed policy. Its generated or reviewed evidence is:

| Record                                 | Meaning                                                                                                | Boundary                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `dependency-vulnerability-report.json` | Lockfile-bound npm advisory decision, review date, expiry, and dispositions                            | Registry knowledge is point-in-time and must be refreshed within 14 days  |
| `vulnerability-exceptions.json`        | Explicit time-bounded high/critical exceptions                                                         | Empty by default; an exception is not a claim that a dependency is safe   |
| `source-dependencies.cdx.json`         | CycloneDX source/build/package-manager runtime dependency inventory                                    | Does not contain an OCI base or operating-system package SBOM             |
| `release-inputs.json`                  | Package identity, declared toolchain, evidence hashes, provider fingerprints, and npm archive identity | Source revision and actual tool versions are resolved by the dry run      |
| `SHA256SUMS`                           | SHA-256 ledger for the reviewed source-side release inputs                                             | A future candidate has a separate checksum ledger for its assembled bytes |
| `public-release-inputs.json`           | The same inputs with the audited public-manifest transform and public npm archive identity             | Used only by the sanitized staged/public tree                             |
| `PUBLIC_SHA256SUMS`                    | SHA-256 ledger reconstructed for the staged public manifest                                            | Does not weaken the private source-tree publication guard                 |

The existing license inventory and redistribution audit remain mandatory. License
metadata and vulnerability results answer different questions; neither substitutes
for the other or constitutes legal/security certification.

## Dependency vulnerability policy

`pnpm run audit:dependencies` verifies the retained report without network access. It
fails if the lockfile, policy, or exception ledger changed; the report expired; or an
unreviewed high/critical finding exists.

`pnpm run audit:dependencies:live` queries the npm advisory service and compares its
normalized result with the reviewed record. It performs no write. A maintainer uses
the following command only after reviewing the complete changed result:

```powershell
pnpm run audit:dependencies:write
```

The current graph was remediated instead of excepted: Vitest and its coverage adapter
were upgraded to `4.1.11`, and the affected transitive `js-yaml` resolution is pinned
to `4.3.2`. The retained 2026-09-11 audit reports no findings at any severity.

An exception is allowed only when immediate remediation is not feasible and every
policy-required field is present: advisory and package identity, severity, owner,
rationale, affected distribution surfaces, concrete compensating controls, review
date, and expiry date. Exceptions are unique per advisory/package, may cover only a
blocking severity, and fail after expiry. Review must distinguish development-only
exposure from code shipped in the npm, Action, or image surface; “dev dependency” by
itself is not a compensating control.

## Deterministic evidence regeneration

After an intentional dependency, legal record, package, or provider change, regenerate
in dependency order and review every diff:

```powershell
pnpm run audit:licenses:write
pnpm run pack:contents:write
pnpm run artifacts:write
pnpm run audit:dependencies:write
pnpm run release:integrity:write
```

The non-mutating source-side verifier is:

```powershell
pnpm run release:integrity
```

Package version consistency covers `package.json`, the npm distribution contract and
archive manifest, the license and vulnerability reports, and a matching changelog
heading. Publication additionally requires an exact `v<package-version>` tag at the
reviewed clean source revision.

## Non-publishing dry run

```powershell
pnpm run release:dry-run
```

The command runs build/schema, sanitation, license, vulnerability, npm package, and
provider-drift checks, then writes only `.tmp/release-dry-run/`. It assembles the exact
npm archive, checked provider distributions, legal records, SBOM, evidence manifests,
source revision/tree fingerprint, actual tool versions, a candidate manifest, and a
complete `SHA256SUMS`. It contains no publish, push, release, tag, or credential path.

The dry run intentionally records `publishable: false`. Before O5 the source manifest
must remain private; an untagged or dirty development tree and every independently
pending hosted/OCI/security-channel gate are recorded as blockers rather than hidden.
CI may use `pnpm run release:dry-run --prepared` after equivalent earlier steps to
avoid rebuilding the same artifacts twice.

## Publication trust boundary

Pull-request and candidate jobs retain repository `contents: read` permission, receive
no release environment, request no OIDC identity, and receive no registry secret.
Untrusted candidate code therefore cannot publish even if it changes a build script.

An automated privileged publishing workflow remains deliberately absent; O5.2 was a
manual, explicitly authorized publication. Any future publishing workflow must be a
separate protected `release` environment with required review and must consume the
already-reviewed candidate by digest. npm should use trusted publishing with
short-lived OIDC identity when supported. A container registry must use a separately
revocable short-lived identity scoped only to the intended package. Long-lived
registry tokens are prohibited. The workflow must never run in pull-request context
or rebuild from an untrusted checkout after approval.

## Rollback, yank, and compromise response

Normal defects are fixed forward with a new version and changelog entry. Published
bytes, tags, checksums, provenance, and release notes are never silently replaced.
Deprecation or unpublishing is exceptional because removing an artifact can break
consumers; follow the registry's current policy and retain the reason and affected
digests. Container tags are convenience pointers only—consumers and incident records
use immutable digests.

For a suspected compromised release:

1. stop all release jobs, disable the protected environment, and revoke the affected
   identity before investigating candidate code;
2. preserve the tag, candidate manifest, checksums, SBOM, CI logs, registry provenance,
   and image/package digests as incident evidence;
3. determine affected versions and surfaces independently (npm, Action, component,
   and image); do not generalize one clean surface to another;
4. publish a security advisory through the activated private-reporting workflow,
   deprecate or remove affected artifacts only when warranted, and give digest-specific
   replacement guidance;
5. rotate identities, rebuild from a reviewed clean revision with a new version, and
   re-run every release gate before restoring publication; and
6. record root cause, exposure window, response actions, and prevention changes without
   disclosing reporter or target-repository data.

## Current gate state

The O3.3 implementation and local non-publishing evidence pass. O5.3 additionally
passed for the exact public npm archive and released GitHub Action; the exact release
source commit also passed its four-cell hosted matrix. GitHub Private Vulnerability
Reporting is active. GitLab-hosted component validation, OCI publication and its
base/image SBOM obligations, real comment publication, and macOS or named-browser
claims retain their independent withheld, deferred, or unverified states. See
[Published release verification](published-release-verification.md).
