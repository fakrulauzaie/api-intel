# Neutral Repository CI

Status: public hosted qualification active; each claim is bound to an exact workflow run  
Workflow: `.github/workflows/ci.yml`  
Public repository: `https://github.com/fakrulauzaie/api-intel`

The repository CI validates api-intel as an ordinary source project. It does not invoke
the api-intel GitHub Action, GitLab component, OCI image, or comment publisher that the
repository also builds. This prevents the generic quality gate from recursively
depending on a product adapter under test.

## Maintained candidate matrix

The source matrix contains four deliberately pinned cells:

| Runner         | Node.js   | Package manager |
| -------------- | --------- | --------------- |
| `ubuntu-24.04` | `22.13.1` | pnpm `11.19.0`  |
| `ubuntu-24.04` | `24.20.0` | pnpm `11.19.0`  |
| `windows-2025` | `22.13.1` | pnpm `11.19.0`  |
| `windows-2025` | `24.20.0` | pnpm `11.19.0`  |

These fixed versions exercise the minimum admitted Node 22 runtime and a reviewed
Node 24 LTS point without turning a moving major tag into compatibility evidence.
GitHub currently documents both selected runner labels as hosted x64 images, and the
Node project publishes Node 24.20.0 as an LTS release. The workflow pins action
dependencies to complete commit SHAs and disables setup-node's package-manager cache.

The matrix is a candidate support contract until all four cells run successfully on
the exact public release commit. Local Windows evidence cannot upgrade the two
Ubuntu cells or either Node 24 cell. macOS is intentionally absent and remains
unverified; it should be added only after its package path is demonstrated and the
cost of maintaining that cell is accepted.

## Per-cell verification

Every cell:

1. checks out one fresh source revision without persistent Git credentials;
2. installs pnpm 11.19.0 with global installation scripts disabled;
3. installs the exact root lockfile with `--frozen-lockfile`;
4. installs the real-package fixture from its npm lockfile with all target lifecycle
   scripts disabled;
5. builds production output and verifies configuration-schema drift;
6. scans the pinned real-package compatibility corpus; and
7. runs the complete semantic, golden, CLI, integration, helper, and documentation
   suite.

The Ubuntu/Node 22.13.1 cell additionally runs formatting, lint, and strict typecheck.
Documentation contracts are part of the full suite rather than represented by a
weaker link-only surrogate.

## Real-package compatibility boundary

`example-nestjs-app/package-lock.json` freezes one project-authored compatibility
case:

| Package           | Exact version |
| ----------------- | ------------- |
| `@nestjs/common`  | `11.2.1`      |
| `@nestjs/core`    | `11.2.1`      |
| `@nestjs/typeorm` | `11.0.3`      |
| `better-sqlite3`  | `12.11.1`     |
| `typeorm`         | `1.1.0`       |
| `typescript`      | `5.9.3`       |

`npm ci --ignore-scripts --no-audit --no-fund` materializes that target type
environment. `compatibility:check` verifies installed versions against the lockfile,
runs the built CLI without executing the target application, and freezes seven
endpoints, 70 evidence-backed assertions, and seven explicit diagnostics. A
`completed_with_gaps` result is expected because the corpus deliberately contains
unsupported and dynamic cases; suppressing those diagnostics would fail the gate.

This proves only the exact combination above when its matrix cell is green. Generated
declaration stubs continue to prove extractor semantics, not NestJS or TypeORM version
compatibility. No adjacent framework version is implied.

## Trust and resource controls

- Workflow permissions are `contents: read`; no secret context or write permission is
  referenced.
- Checkout credentials are not persisted and `pull_request_target` is not used.
- The root install permits only the existing `esbuild` entry in
  `pnpm-workspace.yaml`'s `allowBuilds`. Target-fixture lifecycle scripts are disabled,
  including native database-driver builds that static analysis does not need.
- Matrix concurrency and ordinary Vitest concurrency are each capped at two. New
  pushes cancel obsolete runs.
- Each job has a 30-minute timeout and a 6,144 MiB Node heap ceiling.
- Compiler-heavy tests have a 60-second per-test ceiling so runner contention does not
  turn a proven result into a 15-second timing flake; this changes no assertion.
- Coverage is observation-only, has no threshold, and runs only for trusted pushes or
  manual dispatch. Instrumented tests use one worker so timing contracts are not
  distorted by CPU contention. The JSON/text result is retained for seven days.

Coverage is measured before any threshold is considered. A future threshold must be
based on stable repeated measurements and must not replace semantic, close-negative,
golden, or no-execution assertions with line-count optimization.

The initial local observation passed 187 test files and 521 tests. It measured 88.67%
statements/lines, 81.80% branches, and 95.08% functions over `src/**/*.ts`. The exact
environment, counts, duration, and interpretation boundary are retained in the
[Phase O3.1 coverage observation](benchmarks/phase-o3-1-coverage.md). These numbers are
historical evidence, not thresholds.

## Local commands

After installing the root and fixture lockfiles:

```powershell
npm run build
npm run schema:check
npm run compatibility:check
npm test
npm run test:coverage
```

The machine contract is
[`packaging/ci/neutral-ci-contract.json`](../packaging/ci/neutral-ci-contract.json).
It freezes matrix cells, action pins, limits, trust rules, compatibility versions, and
expected semantic results. Static workflow tests ensure future edits cannot silently
introduce floating actions, write permissions, product-action recursion, macOS claims,
or coverage thresholds.

## Evidence state

The current local Windows x64 / Node 22.13.1 source tree can verify workflow structure,
schema drift, the real-package corpus, the current 195-file/553-test suite, and the initial
coverage observation.
It cannot prove a clean GitHub-hosted checkout or any other matrix cell. Phase O3.1's
implementation is complete, but its acceptance gate remains open until the hosted
four-cell run is retained from the sanitized public repository.
