# Clean-Room Package Installation

Status: Phase O2.3 source-archive gate complete
Verification date: 2026-09-15 (post-publication source-tree refresh)
Publication status: exact registry package independently verified by O5.3 on 2026-09-14

Phase O2.3 originally proved the reviewed source archive from Phase O2.2 in isolated
package consumers without publishing it. The later
[Published Release Verification](published-release-verification.md) applies the same
semantic probes to the exact public registry bytes and is the current consumer-facing
evidence.

## Verified environment

The current source-tree report used Windows x64, Node.js 22.13.1, npm 10.9.2, and pnpm
11.21.0.
Both package managers installed the same
`@fakrulauzaie/api-intel@0.1.0-alpha.1` archive under a newly created operating-system
temporary directory. Runtime dependencies and the installed package resolved only
inside that temporary tree; the source workspace's `node_modules` was not used.

This is exact-environment verification, not a broad npm, pnpm, Windows, or Node.js
support promise. In particular, this local pnpm observation does not change the
maintained pnpm 11.19.0 release matrix. Compatibility claims are expanded separately
in Phase O3.1 and O5.3.

## Exercised installed surfaces

Each isolated consumer verified:

- the exact 271-file tarball inventory, per-file SHA-256 values, archive shasum and
  integrity, and package-size budgets;
- local `api-intel` and `api-intel-mcp` shims, including `--version` and `--help`;
- installed `api-intel doctor . --format json`, including packaged runtime assets,
  TypeScript-resolved Nest declarations, and absence of the absolute consumer path;
- installed `api-intel init . --format json` preview, explicit `--write`, exact
  version-4 output, exit-9 no-overwrite behavior, and a headless `--with-graph` first
  scan;
- both JSON Schema exports, while package-root and private `dist/` imports remained
  blocked;
- runtime resolution of TypeScript, Zod, the MCP server, the Cytoscape browser asset,
  and the libpg-query WASM asset without source-workspace leakage;
- a static, source-text-only NestJS fixture scan producing one `POST /orders`
  endpoint and the expected `OrdersController.create` handler;
- PostgreSQL raw-SQL analysis proving a read of `order_record` through
  `typeorm.raw-sql.select.read.v1`;
- a self-contained offline graph without requesting a browser preview;
- MCP initialize and `tools/list` over stdio, returning the eight approved tools; and
- bounded negative behavior: an unresolved target dependency produced
  `completed_with_gaps` plus `TS_IMPORT_UNRESOLVED`, while malformed `tsconfig.json`
  exited with code 2. Neither response exposed a stack trace.

The fixture is retained as `.ts.txt` source and declaration stubs under
`packaging/npm/fixtures/clean-room/`. The verifier copies it into the temporary
consumer and statically analyzes it; no target application code is imported or
executed.

## Reproducing the gate

Run the full isolated installation and compare the result with the retained report:

```powershell
npm run pack:clean-room:check
```

To intentionally refresh evidence after reviewing a package change:

```powershell
npm run pack:clean-room:write
npm run pack:clean-room:report
```

To verify the immutable published prerelease and its public metadata instead:

```powershell
node scripts/verify-published-release.mjs
```

The first two commands require local npm and pnpm and may require registry access to
populate temporary package-manager caches. On Windows, the verifier accepts its
direct executable or resolves npm's global `pnpm.cjs` launcher without invoking a
shell. `API_INTEL_PNPM_EXECUTABLE` remains an override for an absolute directly
executable pnpm path. The verifier bounds child-process output and timeouts and
deletes only its validated `api-intel-o2-3-*` temporary tree.

[`packaging/npm/clean-room-contract.json`](../packaging/npm/clean-room-contract.json)
freezes the expected semantic probes. The retained, machine-independent result is
[`packaging/npm/clean-room-install-report.json`](../packaging/npm/clean-room-install-report.json).
The report contains environment versions and categorical outcomes, never temporary or
source-workspace paths.

## Distribution boundary

The private and sanitized-public source-tree ledgers describe the current checkout and
may change after publication; neither replaces the immutable release identity. The
published public archive contains 271 files and is 432,396 bytes compressed and
2,353,983 bytes unpacked; its SHA-256 is
`186cb921ff8ea62f5877c4bc695674757d0e0eb111c83d61a59b20138f5b1709`.

Gate OD0 remains the source-archive proof. O5.3 separately passed the exact published
package on the maintained Ubuntu/Windows and Node 22/24 matrix; it does not imply
unlisted platforms or versions.
