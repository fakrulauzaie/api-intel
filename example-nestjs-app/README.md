# Maintained NestJS Analysis Fixture

This project-authored application is the smallest end-to-end public fixture for
`api-intel`. It contains seven NestJS endpoints, TypeORM reads and writes, local
service calls, one guarded mutation, and one intentionally awkward legacy path.

The analyzer reads this source through the TypeScript compiler. It never imports the
application, runs NestJS, executes package scripts, or connects to SQLite. The exact
safety and ground-truth contract is in [FIXTURE.md](FIXTURE.md).

## Analyze it from the repository root

```text
pnpm run build
pnpm run cli -- doctor example-nestjs-app
pnpm run cli -- scan example-nestjs-app --with-graph --output .tmp/example-analysis
pnpm run cli -- trace .tmp/example-analysis/analysis.json --method POST --path /notes
```

The expected result is `completed_with_gaps`: supported endpoint, call, guard, and
database facts are still trustworthy, while deliberately unsupported or uncertain
forms remain diagnostics. Current generated public examples are checked in under
[`docs/examples/current/`](../docs/examples/current/).

## Optional application verification

Application execution is separate from analyzer verification. A fixture maintainer
may install and run the app's own tests when intentionally validating the sample:

```text
npm ci --ignore-scripts
npm test
npm run test:e2e
```

These commands are never invoked by `api-intel`.

## Ownership and license

The fixture is independently authored for this repository and distributed under the
root Apache-2.0 license. Framework package names and public decorator/API shapes state
the compatibility target; no upstream starter documentation, branding, badge token,
or organization-derived source is retained here.
