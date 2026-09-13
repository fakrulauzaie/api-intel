# Clean-Room Package Installation

Status: Phase O2.3 complete  
Verification date: 2026-09-12 (O5.1 prerelease refresh)  
Publication status: O5.2 alpha candidate; retained checks precede registry verification

Phase O2.3 proves the reviewed npm archive from Phase O2.2 in isolated package
consumers. It does not turn the private source manifest into a publishable manifest,
publish the archive, or claim that a fresh source checkout passes on every supported
platform. Neutral clean-source validation remains Phase O3.1 work.

## Verified environment

The retained run used Windows x64, Node.js 22.13.1, npm 10.9.2, and pnpm 11.19.0.
Both package managers installed the same
`@fakrulauzaie/api-intel@0.1.0-alpha.1` archive under a newly created operating-system
temporary directory. Runtime dependencies and the installed package resolved only
inside that temporary tree; the source workspace's `node_modules` was not used.

This is exact-environment verification, not a broad npm, pnpm, Windows, or Node.js
support promise. The maintained compatibility matrix is expanded separately in Phase
O3.1.

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

The first two commands require local npm and pnpm executables and may require registry
access to populate temporary package-manager caches. On Windows, set
`API_INTEL_PNPM_EXECUTABLE` to an absolute directly executable pnpm path only when the
standard local pnpm shim cannot be resolved. The verifier uses bounded child-process
output and timeouts and deletes only its validated `api-intel-o2-3-*` temporary tree.

[`packaging/npm/clean-room-contract.json`](../packaging/npm/clean-room-contract.json)
freezes the expected semantic probes. The retained, machine-independent result is
[`packaging/npm/clean-room-install-report.json`](../packaging/npm/clean-room-install-report.json).
The report contains environment versions and categorical outcomes, never temporary or
source-workspace paths.

## Distribution boundary

The verified private-source archive contains 271 files, is 432,404 bytes compressed and 2,354,002
bytes unpacked, with SHA-1
`cb7affae34431808ae3ffe0ea78a4411d3176ea0`. Its SHA-512 integrity is retained in the
machine report and the Phase O2.2 package-content ledger so a later staged registry
candidate can be compared byte-for-byte.

Gate OD0 passes for this exact environment. A clean source clone, cross-platform and
version matrices, supply-chain checks, and the final publishable manifest remain later
release gates.
