# License and Redistribution Audit

Status: project-owner authorization recorded; release-specific third-party and OCI
review remains required before publication

Audit date: 2026-09-10

## Decision

Apache License 2.0 is the selected project-license candidate because its explicit
patent terms fit a developer tool intended for broad commercial and open-source use.
The root `LICENSE` and `package.json` now agree on SPDX identifier `Apache-2.0`.
Copyright remains with each contributor for their contribution; this project does not
assert a fabricated collective copyright holder or add an Apache `NOTICE` file.

On 2026-09-10 the project owner accepted the Apache-2.0 choice and attested to the
rights needed to publish independently authored project material. The scoped
[ownership and publication authorization](ownership-and-publication-authorization.md)
does not clear organization-derived material, legacy private history, or third-party
obligations. This remains an engineering redistribution audit, not legal advice.

## Reproducible package audit

`scripts/audit-third-party-licenses.mjs` resolves the installed pnpm dependency graph
from the root production and development dependencies. It records package name,
version, scope, directness, declared SPDX value, repository URL, and hashes of packaged
license/notice files. It also fingerprints the lockfile, root license, Cytoscape browser
asset, and libpg-query WASM asset.

```powershell
pnpm run audit:licenses:write # intentionally update the reviewed inventory
pnpm run audit:licenses       # fail if the inventory or allowed license set drifted
```

The checked-in `dependency-license-inventory.json` is deterministic for its named
platform and architecture: it has no timestamps or machine paths. After Phase O2.1
moved the compiler API into the runtime graph, the installed Windows x64 inventory has
eight production and 220 development package records. The allowlist contains MIT,
Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, Python-2.0, and BlueOak-1.0.0. The Blue
Oak entry was added after an explicit O3.1 review of the license text and its notice
condition when the coverage-only development graph introduced `jackspeak`,
`minimatch`, `minipass`, `package-json-from-dist`, and `path-scurry`;
this is not a general acceptance rule for unreviewed licenses. Unknown or newly
introduced declarations fail the audit instead of being guessed compatible. On
a different platform, the checker audits that installed graph against the same closed
license allowlist and verifies shared lockfile/project/asset evidence without
pretending OS-specific optional packages are byte-identical to the Windows inventory.
A release matrix may retain additional platform-specific inventories later.

## Distribution matrix

| Surface               | Project license                                       | Dependency/asset evidence                                                              | Release boundary                                                                              |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Source repository     | Root `LICENSE`                                        | `THIRD_PARTY_NOTICES.md`, inventory, fixture register                                  | Owner-authorized project material only; staged-tree sanitation and provenance review required |
| npm package           | Root license and notices explicitly listed in `files` | Runtime dependencies remain separate npm packages; inventory ships under `docs/legal/` | O2.2 verifies the exact tarball allowlist, budgets, data exports, and dependency-owned assets |
| GitHub Action         | `action-dist/LICENSE`                                 | ncc aggregate, third-party notices, inventory, exact copied Cytoscape/WASM hashes      | Complete `action-dist/` is one indivisible distribution                                       |
| GitLab adapter bundle | `gitlab-dist/LICENSE`                                 | ncc aggregate, third-party notices, inventory, exact copied Cytoscape/WASM hashes      | Complete `gitlab-dist/` is one indivisible distribution                                       |
| GitLab OCI image      | License material copied with `gitlab-dist/`           | In-image base/OS/tool notices plus a required release SBOM and base digest             | Not cleared by this npm audit alone; per-image corresponding-source review remains mandatory  |

## Obligations and findings

- MIT, ISC, BSD, and Python-2.0 materials require retention of their applicable
  copyright and permission/license text. ncc aggregation and the standalone asset
  notices preserve that evidence for the JavaScript bundles.
- Apache-2.0 dependencies require their license and any applicable upstream NOTICE
  material. Packaged license/notice hashes are recorded; ncc preserves texts for code
  it embeds.
- BlueOak-1.0.0 requires recipients of copied software to receive the license text or
  its canonical link. All five audited packages retain license files; they are
  transitive development-only dependencies of the coverage tool and are not copied
  into the npm runtime or ncc provider bundles.
- No dependency declaration in the audited installed tree triggered an unresolved or
  incompatible-license finding.
- The MCP server package's manifest says MIT while its license file documents a mixed
  Apache-2.0/MIT transition. The inventory fingerprints that source file and the
  release notice calls out the nuance rather than reducing it to manifest metadata.
- `git` and potentially other OCI-layer packages can carry corresponding-source
  obligations. A release must pin the image digest, generate an image SBOM, and retain
  the source/offer evidence required by the exact image. An arbitrary build argument is
  never pre-cleared.

## Blocking rule

Any unresolved license expression, missing provenance for redistributed material,
changed asset hash without review, incompatible term, organization-derived material,
or incomplete OCI source record blocks the affected publication surface. A passing
script proves inventory consistency; it does not establish rights that the scoped
owner attestation or a third-party license does not grant.
