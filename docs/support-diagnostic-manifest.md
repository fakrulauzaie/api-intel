# Source-Free Support Diagnostic Manifest

Status: normative issue-intake format  
Schema: `schemas/support-diagnostic-manifest.schema.json`

The support manifest supplies environment and aggregate diagnostic facts without
copying target source or api-intel's architecture model. It is intentionally manual:
automatic “redaction” of a rich artifact could create false confidence and silently
carry a private field into a public issue.

## Create the manifest

1. Copy `templates/support-diagnostic-manifest.example.json` to a new local file.
2. Obtain the engine and Node versions with `api-intel --version` and `node --version`.
3. Read only the top-level `schemaVersion` and `resultState` from `analysis.json`.
4. Count diagnostics by `code` and `severity`; do not copy `message`, `subjectId`,
   `evidenceIds`, paths, snippets, or record IDs.
5. Record package versions only from the target's package manager metadata. Do not add
   its name or repository URL.
6. Validate the keys against
   `schemas/support-diagnostic-manifest.schema.json`, inspect the actual JSON, and then
   attach only that file to the matching public issue.

The strict schema rejects extra properties. The example contains `unknown` values and
an empty diagnostic list so it can be safely copied before information is added.

## Deliberately excluded

The format has no fields for repository name or revision, file paths, endpoint paths,
class/method/resource/table/queue/service identifiers, command arguments, timestamps,
diagnostic messages, source hashes, evidence, snippets, topology, policy results, or
free-form notes.

“Source-free” describes that field boundary, not a confidentiality guarantee. Version
combinations, aggregate counts, and diagnostic codes can still be sensitive. Review
them and obtain authorization before sharing. Never attach the source `analysis.json`
or `run.json` as proof that this manifest is safe.
