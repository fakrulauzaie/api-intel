# Phase O3.1 Coverage Observation

Status: historical local measurement; no threshold or support claim  
Measurement date: 2026-09-10

## Environment and command

The repository's complete Vitest suite ran on Windows x64 with Node.js 22.13.1,
npm 10.9.2, Vitest 3.2.4, and the V8 coverage provider:

```powershell
npm run test:coverage
```

The script used one worker and a 60-second per-test timeout. One worker is a measurement
stability control for the existing compiler-heavy timing contracts, not an application
performance setting.

## Result

- Test files: 187 passed of 187.
- Tests: 521 passed of 521.
- Duration: 478.69 seconds.
- Statements: 88.67% (46,306 of 52,221).
- Branches: 81.80% (10,949 of 13,385).
- Functions: 95.08% (1,490 of 1,567).
- Lines: 88.67% (46,306 of 52,221).

The measurement scope was `src/**/*.ts`. The generated JSON summary remains a local or
short-retention CI artifact because it contains machine-specific absolute paths; this
historical record retains only aggregate counts.

## Interpretation boundary

No coverage threshold was selected. These percentages describe one dated local run and
do not prove semantic correctness, platform compatibility, or a future minimum. The
semantic, close-negative, no-execution, golden, documentation, and package-integrity
contracts remain the release evidence. The four-cell hosted source matrix is still
pending and this Windows result cannot upgrade those cells to verified.
