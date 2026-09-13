# Contributor Fixture Contract

Status: normative contribution guide

Semantic extraction changes start with reviewed evidence, not a broad implementation
guess. Add the smallest project-authored fixture that proves the intended rule and the
nearest shapes that must remain unresolved before changing an extractor.

## Required fixture set

| Fixture class  | Purpose                                                                                 | Minimum assertion                                                                                        |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Positive       | One exact supported source shape                                                        | Canonical fact, assertion/rule ID, and expected terminal or handler                                      |
| Close-negative | A lookalike, dynamic value, wrong receiver, wrong decorator origin, or unsupported flow | The positive fact is absent; no name-only match                                                          |
| Diagnostic     | A useful proof stop                                                                     | Exact diagnostic code, subject, severity, and evidence association                                       |
| Evidence       | Source attribution for every emitted fact                                               | Repository-relative file, exact range, role, and redacted snippet contract                               |
| Compatibility  | A real installed-package path for a claimed version/environment                         | Exact package/runtime versions and retained gate result; declaration stubs alone stay semantic evidence  |
| Performance    | A representative bounded corpus                                                         | Input size, environment, elapsed observation, and omission/limit behavior without universal speed claims |

Every positive needs at least one close-negative. Every new inference rule needs a
`mustNotInfer` statement when a tempting stronger conclusion would be unsound.

## Workflow

1. Select the owning feature guide and add the proposed syntax to its support matrix.
2. Add project-authored source as `.ts.txt` when it represents code that must be parsed
   and type-checked but never imported or evaluated.
3. Add only the minimal declaration stubs needed for the TypeScript checker. Stubs
   identify public API shape; they do not establish package-version compatibility.
4. Write the expected semantic manifest before extractor code. Keep canonical IDs,
   diagnostics, evidence roles, and `mustNotInfer` entries explicit.
5. Add a gate that type-checks the corpus, validates and canonicalizes the manifest,
   proves the close-negative, and verifies that `.ts.txt` is never imported.
6. Implement the smallest checker-proven rule and run focused tests, then all tests,
   formatting, lint, typecheck, build, schema checks, compatibility checks, and public
   sanitation checks.
7. Update the authoritative [supported-patterns matrix](supported-patterns.md), any
   affected model/schema contract, and this fixture's provenance entry.

Use the [small NestJS application](../example-nestjs-app/FIXTURE.md) for end-to-end
report behavior. Use the [distributed frozen corpus](../test/fixtures/system-stitching/README.md)
for open-world topology semantics. The
[synthetic legacy walkthrough](examples/synthetic-legacy-system/README.md) shows how
one reviewed expectation is projected into public documentation without duplicating
the semantic source of truth.

## Local verification

From a clean source checkout:

```text
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run schema:check
pnpm run compatibility:check
pnpm run test
pnpm run audit:public
```

Do not add network access, target execution, dependency installation, or generated
private artifacts to an analyzer test. Never copy a private repository snippet into a
fixture, even after renaming identifiers. Independently author the smallest synthetic
shape from the public semantic contract and record it in
[Fixture and Example Provenance](legal/fixture-provenance.md).
