# First Evidence-Backed Trace

**Evidence-backed blast radius for legacy NestJS systems.** `api-intel` proves
supported static paths to potential side-effect operations and reports exactly where
proof stops. It does not run the target application, import target modules, install
dependencies, contact infrastructure, or turn an unresolved path into a fact.

The commands below use the installed binary name. While working in this private source
repository, build once and replace `api-intel` with `pnpm run cli --`.

## 1. Preflight and initialize

Run the read-only preflight first:

```text
api-intel doctor .
```

Target dependencies must already be installed so TypeScript can resolve declarations.
If the application needs a non-default project, add `--tsconfig path/to/tsconfig.json`
to `doctor`, `init`, and `scan`.

`init` is also read-only by default. It previews the exact candidate file and reports
the proof gaps retained by `doctor`:

```text
api-intel init .
```

Create the previewed `api-intel.config.json` only after review:

```text
api-intel init . --write
```

Initialization requires TypeScript-resolved `@nestjs/common` declarations. It creates
only this strict, assumption-free configuration:

```json
{
  "version": 4
}
```

There is deliberately no overwrite option. If the file already exists, `init` leaves
it untouched and exits with code 9. It does not guess a raw-SQL dialect, authorization
mapping, policy, report recipe, output directory, or package-relative schema path.
Those choices require explicit project ownership. The shipped schema can be associated
later as described in [Project Configuration](project-configuration.md).

## 2. Generate and inspect the first graph

Interactive desktop path:

```text
api-intel scan . --with-graph --open
```

Headless or CI path:

```text
api-intel scan . --with-graph
```

Both paths create `.api-intel/analysis.json`, the endpoint catalogue, trace Markdown,
and the self-contained offline graph. `--open` only asks the host to preview the
finished local HTML artifact; it does not add network access to analysis.

List exact endpoint selectors, then request one trace:

```text
api-intel endpoints .api-intel/analysis.json
api-intel trace .api-intel/analysis.json --method POST --path /orders
```

An endpoint trace is canonical JSON. Read its `steps`, `terminals`, `resourceTerminals`,
`causalSummary`, evidence IDs, and diagnostic IDs together. A short trace is not proof
that the runtime has no other effects.

## 3. Compare before and after a refactor

Keep the two scans in separate directories:

```text
api-intel scan . --output .api-intel-before
# Apply and review the refactor.
api-intel scan . --output .api-intel-after
api-intel diff .api-intel-before/analysis.json .api-intel-after/analysis.json --format markdown --output .api-intel-change
api-intel impact .api-intel-before/analysis.json .api-intel-after/analysis.json --format markdown --output .api-intel-change
api-intel graph .api-intel-after/analysis.json --baseline .api-intel-before/analysis.json --output .api-intel-change --open
```

`diff` reports supported semantic changes. `impact` reports potential transitive reach,
not observed runtime execution. The graph's impact overlay has the same boundary.

## 4. Add an explicit policy gate

Initialization does not invent architecture policy. After the team selects a rule,
add it to `api-intel.config.json`, for example:

```json
{
  "version": 4,
  "rules": {
    "require-guard-on-write-endpoint": "error"
  }
}
```

Then evaluate the completed artifact:

```text
api-intel check .api-intel/analysis.json --config api-intel.config.json --format markdown
```

An `unknown` policy result stays distinct from pass and fail. It means the retained
facts cannot prove the rule either way.

## Proof gaps are part of the result

Before treating a graph or trace as complete, review:

- `doctor` warnings, especially unresolved declarations and unverified package
  versions;
- the analysis `resultState` (`completed_with_gaps` is not `completed`);
- diagnostic codes and their evidence locations;
- dynamic targets, unsupported callback forms, ambiguity, depth/fan-out limits, and
  external or unobserved service boundaries; and
- conditional labels on asynchronous or distributed paths.

The engine proves only its documented, tested patterns. It does not prove that an
unreported runtime effect is absent.
