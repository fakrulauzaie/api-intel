# Package Runtime and Manifest Contract

Status: Phase O2.1 complete  
Applies to: source package manifest and ordinary CLI/MCP build  
Public package status: not published

The private development manifest uses the selected `@fakrulauzaie/api-intel` package
identity while retaining `private: true`. The separately audited O5.1 staging
procedure derives a candidate manifest that omits that property without modifying the
private workspace. Neither O2.1 nor O5.1 creates a repository, reserves a package, or
publishes an artifact.

## Runtime dependency boundary

[`packaging/npm/runtime-contract.json`](../packaging/npm/runtime-contract.json) is the
closed runtime ledger. `package.json` must contain exactly these direct production
dependencies:

| Package                        | Runtime reason                                                |
| ------------------------------ | ------------------------------------------------------------- |
| `@modelcontextprotocol/server` | Local read-only MCP server                                    |
| `cytoscape`                    | Browser source embedded into self-contained offline reports   |
| `libpg-query`                  | PostgreSQL parser and its colocated WASM asset                |
| `typescript`                   | Compiler API used to parse and type-check target repositories |
| `zod`                          | Runtime validation of canonical documents and configuration   |

TypeScript is intentionally a production dependency. The ordinary CLI imports its
compiler API at runtime; classifying it as development-only happened to work in the
repository and ncc bundles but would fail in an isolated npm installation.

The runtime verifier scans every emitted JavaScript import, rejects undeclared bare
packages, resolves every relative import inside `dist/`, probes dynamically located
assets such as Cytoscape, and verifies the installed direct versions. It also walks
the complete installed production dependency closure and fails if the project or a
runtime package declares `preinstall`, `install`, or `postinstall` hooks.

## Deterministic pack preparation

`prepack` always rebuilds the TypeScript output and then runs the verifier:

```powershell
npm run prepack
```

The verifier requires exactly four emitted artifacts for every `src/**/*.ts` module:
JavaScript, JavaScript source map, declaration, and declaration map. Missing files and
stale outputs for removed source modules both fail. It separately checks both bin paths,
portable Node shebangs, package/tool version agreement, and the source-tree private
guard.

There are no consumer install lifecycle scripts. Packing/building the engine never
imports or executes a target NestJS project, and installing the resulting package does
not require pnpm. Phase O2.3 subsequently proved the same archive through isolated npm
and pnpm consumers without source-workspace dependency resolution.

## Metadata boundary

The name, description, author handle, maintainer handle, license, keywords, engines,
package-manager declaration, and both bins are fixed now. Funding is not currently
applicable.

`repository`, `homepage`, and `bugs` remain absent because the sanitized public
repository does not yet exist. Publishing placeholder or private URLs would violate
the alpha identity contract. O5.1 must add and validate the real destination metadata
only in the staged publishable manifest after the exact public repository is approved.

`main` and `types` remain absent. Phase O2.2 added a finite `exports` map for the two
shipped JSON Schemas only; it deliberately did not turn internal `dist/` modules or
their emitted declarations into supported package APIs. See the
[npm package surface](npm-package-surface.md). O2.1 proves runtime completeness;
the separate [clean-room installation gate](clean-room-package-installation.md) proves
installed-package behavior for its exact recorded environment.

## Verification

```powershell
npm run prepack
node scripts/verify-package-runtime.mjs
node dist/cli/index.js --help
node dist/mcp/index.js --help
```

The retained O2.1 run produced 1,024 expected files from 256 source modules, found four
statically imported third-party packages plus the explicitly probed Cytoscape asset,
walked eight installed production packages, and found zero consumer install hooks.
