# Source-Free Reproduction and Support Bundle

Start here when a trace stops unexpectedly or a command fails. The first report should
describe the environment and result shape without sending source, paths, identifiers,
snippets, complete artifacts, or logs.

## 1. Collect local facts

Run locally and review the output before copying individual values:

```text
api-intel --version
node --version
api-intel doctor . --format json
```

Record only generic platform/architecture, exact package versions, result state,
artifact schema version, diagnostic-code counts, and whether a supported pattern was
expected. Do not paste the full doctor output if it contains a path or project name.

## 2. Fill the strict manifest

Copy `templates/support-diagnostic-manifest.example.json` from the source repository,
or create the same shape using the shipped data export
`@fakrulauzaie/api-intel/schemas/support-diagnostic-manifest.schema.json`. Keep every
privacy flag false except `reviewedByReporter`, which must be true after manual review.

The schema deliberately has no fields for source, repository path/revision, analysis
ID, symbol, route, table, queue, URL, evidence snippet, free-form log, or notes. The
manifest is a minimization aid, not a confidentiality guarantee.

## 3. Describe the behavior safely

In the issue form, state:

- the documented pattern you expected;
- the command category and result/exit state;
- the diagnostic codes and counts, without diagnostic messages;
- whether a smallest independently authored synthetic reproduction exists; and
- expected versus observed semantics using generic names.

Do **not** attach `analysis.json`, `run.json`, graph HTML, CI artifacts, topology files,
screenshots of private code, repository URLs, or terminal logs. A maintainer may ask
for a synthetic reproduction later. Sharing it remains a separate authorization and
manual-review decision.

See the full [Source-Free Diagnostic Manifest](support-diagnostic-manifest.md),
[Support Policy](../SUPPORT.md), and
[Privacy and Artifact Safety](privacy-and-artifact-safety.md).
