# Published Release Verification

Status: Phase O5.3 in progress

Release: `@fakrulauzaie/api-intel@0.1.0-alpha.1` / `v0.1.0-alpha.1`

Phase O5.3 tests the public bytes that consumers receive. It does not rebuild the npm
package and infer that the rebuilt archive is equivalent. The exact registry tarball,
immutable GitHub source tag, release metadata, attached artifacts, and full-SHA GitHub
Action reference are independently checked against
[`published-alpha-contract.json`](../packaging/release/published-alpha-contract.json).

## Package verification

The maintained workflow runs the registry package on Ubuntu 24.04 and Windows 2025
with Node.js 22.13.1 and 24.20.0. Each cell downloads the exact version and checks its
SHA-256, npm SHA-1/integrity metadata, file inventory, and package size before creating
isolated npm and pnpm consumers outside the source checkout.

Both consumers exercise:

- the `api-intel` and `api-intel-mcp` bins;
- both exported JSON Schemas and blocked private imports;
- runtime resolution of TypeScript, Zod, the MCP server, Cytoscape, and libpg-query
  WASM without source-workspace fallback;
- `doctor`, safe `init`, and no-overwrite behavior;
- a source-only NestJS fixture scan, PostgreSQL raw-SQL read, and self-contained
  offline graph;
- MCP initialize and the exact eight-tool listing; and
- bounded missing-dependency and invalid-tsconfig behavior without stack traces.

Run the same consumer verification locally with:

```powershell
node scripts/verify-published-release.mjs
```

The generated report is written below `.tmp/published-release-verification/`. It
contains categorical environment and probe results, public URLs, and content hashes;
it must not retain temporary consumer paths or credentials.

## Published Action verification

The pull-request-only job creates two small synthetic Git repositories, then invokes:

```yaml
uses: fakrulauzaie/api-intel@641d830176f9ba36875392edd5c419da9d5e01b1
```

The candidate adds `POST /controlled-orders`. The job checks the success outcome,
summary, complete canonical artifact manifest, offline graph, and the Action-reported
distribution fingerprint
`sha256:4901856acce0c7118362d39ac73ae38a5e6d43454e805c7cc134297eae6fdf95`.
The synthetic targets do not contain the Action implementation.

## Public routes and withheld surfaces

The verifier confirms that the repository is public, Issues are enabled, the annotated
tag resolves to the frozen commit, the release is a non-draft prerelease, all nine
expected release assets exist, and the npm archive asset has the reviewed digest.
Private Vulnerability Reporting and the private conduct address are checked separately
because neither belongs in a public artifact report.

The GitLab component, OCI image, and privileged hosted comment publisher were not
published. O5.3 therefore records them as withheld and does not manufacture runtime or
digest evidence for those surfaces.

## Non-destructive rollback drill

The alpha is valid, so this phase must not unpublish it, replace its tag, mutate an
attached artifact, or deprecate it merely to prove permissions. The rollback drill is
procedural:

1. resolve the affected package version, source commit, release tag, Action reference,
   candidate manifest, and digests;
2. stop publication and revoke the affected identity before diagnosis;
3. preserve registry, release, CI, checksum, SBOM, and vulnerability-reporting
   evidence;
4. for an ordinary defect, publish a new prerelease and give exact migration guidance;
5. for a confirmed compromise, use npm deprecation or unpublish only after explicit
   owner authorization and within current registry policy; and
6. never overwrite released bytes or reuse the version, even if npm permits a removal.

This walkthrough verifies that every response decision has a named immutable target
and an honest escalation boundary. It deliberately performs no destructive registry
or repository mutation.
