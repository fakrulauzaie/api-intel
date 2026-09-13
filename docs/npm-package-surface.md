# npm Package Surface

Status: Phase O2.2 complete  
Package candidate: `@fakrulauzaie/api-intel@0.1.0-alpha.1`  
Publication status: not published

The first package candidate is intentionally CLI-first. It exposes two executable
commands and two JSON Schema data paths; it does not expose a supported JavaScript or
TypeScript library API. The private development manifest retains `private: true`; the
audited O5.1 staging manifest omits that property. Neither state publishes anything.

## Supported package entrypoints

| Surface                      | Package entrypoint                                                        | Contract                       |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------ |
| CLI                          | `api-intel`                                                               | `dist/cli/index.js` executable |
| MCP server                   | `api-intel-mcp`                                                           | `dist/mcp/index.js` executable |
| Project configuration schema | `@fakrulauzaie/api-intel/schemas/api-intel.config.schema.json`            | JSON data export               |
| Support manifest schema      | `@fakrulauzaie/api-intel/schemas/support-diagnostic-manifest.schema.json` | JSON data export               |

There is deliberately no package-root export, `main`, or `types` entrypoint. Imports
from `src/` or `dist/` are private implementation access and are blocked by the export
map. Emitted declarations are build/runtime-verification artifacts, not public package
contents. Adding a programmatic API later requires a separately designed and versioned
contract rather than accidentally stabilizing every internal module.

For a project that installs the package locally, editor schema guidance may use the
shipped path:

```json
{
  "$schema": "./node_modules/@fakrulauzaie/api-intel/schemas/api-intel.config.schema.json",
  "version": 4
}
```

The CLI treats `$schema` as inert editor metadata. Phase O2.3 proved this path after
isolated npm and pnpm installation; O2.2 proves that the referenced bytes are present
in the generated tarball.

## Exact package boundary

[`packaging/npm/distribution-contract.json`](../packaging/npm/distribution-contract.json)
defines the finite allowlist, data exports, size budgets, and distribution-specific
asset treatment. [`packaging/npm/package-contents.json`](../packaging/npm/package-contents.json)
records every packed file with its size, SHA-256 digest, and role while the private
source manifest guard is present. The separately generated
[`packaging/npm/public-package-contents.json`](../packaging/npm/public-package-contents.json)
records the exact public-manifest transform used by the sanitized release tree. The
verifier selects the latter automatically when `package.json` has no `private`
property; explicit source-side review uses `npm run pack:public-contents:check`.

The retained package contains 271 files: 263 runtime JavaScript modules and eight
manifest, documentation, schema, legal, or legal-evidence files. It is 431,963 bytes
compressed and 2,352,184 bytes unpacked. The enforced budgets are 280 files, 650,000
compressed bytes, and 3,000,000 unpacked bytes. Source maps, declarations, tests,
source, private implementation plans, temporary outputs, scripts, templates, and the
GitHub/GitLab provider bundles are excluded.

Run the complete checked pack audit with:

```powershell
npm run pack:contents:check
```

The command rebuilds the engine, verifies its production dependency closure and bins,
creates a real npm tarball with lifecycle scripts disabled for the inner inspection,
and compares its complete inventory and archive integrity to the retained report. Use
`npm run pack:contents:write` only when intentionally reviewing a package-content
change. Use `npm run pack:public-contents:write` only to refresh the staged-public
ledger after reviewing the same finite package boundary.

## Runtime and copied assets

| Asset                   | npm package                                          | GitHub Action     | GitLab bundle     |
| ----------------------- | ---------------------------------------------------- | ----------------- | ----------------- |
| Cytoscape browser build | Resolved from exact `cytoscape` runtime dependency   | One reviewed copy | One reviewed copy |
| libpg-query WASM        | Resolved from exact `libpg-query` runtime dependency | One reviewed copy | One reviewed copy |

The npm tarball does not duplicate either asset. The verifier checks the dependency
source and each provider copy against the same retained SHA-256 value. GitHub Action
and GitLab/OCI artifacts remain independent distributions with their own complete
bundles, licenses, notices, and release gates.

## Boundary of this phase

O2.2 remains the source-workspace pack proof. Phase O2.3 separately proved the exact
archive in isolated npm and pnpm consumers, including CLI/MCP execution, schema and
runtime-asset resolution, raw-SQL parsing, and graph generation. See the
[clean-room package installation record](clean-room-package-installation.md). A fresh
source clone and broader environment matrix remain Phase O3.1 work.
