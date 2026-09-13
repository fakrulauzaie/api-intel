# Privacy, Threat Model, and Artifact Safety

Status: normative current guidance  
Applies from: Phase O1.2  
Telemetry: none

`api-intel` is local-first. Core scans parse and type-check files on the machine where
the command runs. They do not upload source, start the target application, import its
modules, contact its database or brokers, or send telemetry. `--open` opens a generated
local HTML file in the default browser; the report remains self-contained and does not
load remote scripts.

This boundary does not make every surrounding workflow offline. Installing the engine
or target dependencies can contact package registries. A CI provider can retain logs
and uploaded artifacts. Publishing a CI comment uses the separately configured GitHub
or GitLab adapter. An MCP host can read whatever artifact paths the user explicitly
grants to its local `api-intel-mcp` process. Review those systems' own data-handling
policies independently.

## Generated artifacts are sensitive

Treat `.api-intel/` and every derived report like internal architecture documentation.
Depending on the command and configuration, artifacts can contain:

- repository-relative source paths, line and column locations, class and method names;
- endpoint paths, guards, diagnostics, entities, columns, table names, cache keys,
  lock resources, queue names, message patterns, and outbound service targets;
- bounded source snippets retained as evidence;
- module ownership, call relationships, distributed topology declarations, policy
  results, and potential blast-radius paths; and
- volatile `run.json` metadata, including absolute input/config/output paths, tool
  versions, timing, and failure details.

The self-contained HTML graph embeds its data in the file. Renaming an artifact,
opening it locally, or putting it inside an archive does not redact it. The Markdown,
CSV, OpenAPI, CI, MCP, comparison, impact, and system-analysis views inherit the
sensitivity of their source artifacts.

## Redaction and proof limits

The engine excludes target payload values from canonical resource facts where the
documented extractor contract permits it. CI projections also neutralize untrusted
Markdown and bound selected text. These controls reduce accidental disclosure; they
are not a confidentiality guarantee or a general secret scanner.

Static redaction cannot reliably recognize every organization-specific identifier,
encoded or split secret, dynamic value, credential hidden in a snippet, customer name,
personal datum, or sensitive business rule. A successful release audit means only
that its documented patterns and private-material fingerprints found no unapproved
match in the audited inputs. It does not prove that arbitrary artifacts are safe to
publish.

Authorization to analyze a private system does not authorize publication of its source
or derived details. Public examples must be independently authored and synthetic;
renaming identifiers in copied code, output, or topology does not make it safe or
project-owned.

## Safe storage and sharing

1. Keep scan outputs outside version control unless a reviewed synthetic fixture
   deliberately requires them. Use the repository's existing ignore rules.
2. Give output directories, CI artifacts, MCP hosts, and support personnel the least
   access and shortest retention needed for the task.
3. Do not upload a complete `analysis.json`, graph, source snippet, topology manifest,
   or CI artifact to a public issue by default.
4. Before sharing, inspect the actual file—not only terminal output—and remove or
   regenerate sensitive evidence at the source. Search for organization names,
   endpoints, resource identifiers, credentials, user paths, and business data.
5. For support, begin with engine/schema versions, operating system, command shape with
   paths replaced by placeholders, result state, diagnostic codes, and the smallest
   synthetic reproduction. Share additional evidence privately only after review.
6. Deleting a local report does not delete copies retained by a CI provider, browser
   download, backup, issue, chat, or MCP host. Apply the retention controls of each
   system that received it.

## Threat boundaries

Target repositories, dependency declarations, configuration, topology manifests, and
downloaded CI artifacts are untrusted inputs. The analyzer avoids executing target
code, but parsing complex inputs still consumes CPU and memory and may expose names in
its outputs. Run untrusted repositories with ordinary OS/container isolation and
resource limits. Do not give the analyzer or CI publisher broad credentials.

The read-only core, optional browser preview, CI evaluation, provider comment
publishers, and MCP server are separate trust surfaces. Their permissions do not flow
automatically: a scan does not authorize upload, a CI evaluation does not authorize a
comment, and an artifact does not authorize an MCP host to read other filesystem
paths.

## Public-release sanitation gate

`pnpm run audit:public` audits the current Git candidate tree and the exact `npm pack
--dry-run` file list. It fails on unapproved high-confidence credential shapes,
organization-specific fingerprints, concrete user-home paths, sensitive filenames,
and unexpected generated-output directories. Synthetic negative-test values require
an exact path-scoped allowlist.

`pnpm run audit:public:history` is deliberately separate. A history finding is not
permission for the tool to rewrite commits. The audit records only categories, stable
non-secret IDs, and counts; it never writes matched values. The owner selected a new
sanitized public repository without legacy history, so the command distinguishes
`findings_detected` from the resolved `excluded_by_selected_strategy` publication
disposition. See the [current sanitation record](legal/public-release-audit.md).
