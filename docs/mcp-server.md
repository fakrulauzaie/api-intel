# Local Artifact MCP Server

`api-intel-mcp` is a separately addressable, read-only stdio server over explicitly
supplied API Intelligence artifacts. It exposes the vendor-neutral P0 query kernel; it
does not scan a repository, import target code, execute a package, or write files.

## Build and start

Build the repository before starting the server:

```powershell
pnpm run build
pnpm run mcp -- --analysis current=.\reports\orders-api\.api-intel\analysis.json
```

The installed binary name is `api-intel-mcp`; its built repository entry is
`dist/mcp/index.js`. A host that accepts a command plus argument array can use the
equivalent shape below, replacing the absolute engine and artifact paths:

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/backend-api-intelligence-engine/dist/mcp/index.js",
    "--analysis",
    "orders=/absolute/path/to/orders-api/.api-intel/analysis.json",
    "--policy",
    "architecture=/absolute/path/to/orders-api/.api-intel/policy-results.json"
  ]
}
```

Host configuration formats and feature support differ. This local server does not
claim universal MCP-host compatibility.

### VS Code

VS Code accepts local server definitions under `servers` in a workspace
`.vscode/mcp.json` or user MCP configuration. Use absolute paths so the host does not
depend on its launch directory:

```json
{
  "servers": {
    "api-intel": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/backend-api-intelligence-engine/dist/mcp/index.js",
        "--analysis",
        "orders=/absolute/path/to/orders-api/analysis.json"
      ]
    }
  }
}
```

Review and accept the local-server trust prompt, then use **MCP: List Servers** to
inspect logs or restart it. See the current
[official VS Code MCP server guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

### Cursor

Cursor accepts project-local `.cursor/mcp.json` or user `~/.cursor/mcp.json` files. Its
local configuration uses the `mcpServers` key:

```json
{
  "mcpServers": {
    "api-intel": {
      "command": "node",
      "args": [
        "/absolute/path/to/backend-api-intelligence-engine/dist/mcp/index.js",
        "--analysis",
        "orders=/absolute/path/to/orders-api/analysis.json"
      ]
    }
  }
}
```

Enable only the tools needed for the task and keep invocation approval enabled where
appropriate. See the current
[official Cursor MCP guide](https://docs.cursor.com/context/model-context-protocol).

These examples configure the same stdio process; they do not assert that the hosts
render resources, completions, errors, or approvals identically. Other hosts should use
their documented command/argument format. Packaging as a host-specific extension is not
part of MCP v1.

## Explicit artifact inputs

Every input uses `<artifact-name>=<artifact-json-path>`. Names are stable query-facing
identities and must be unique across all roles.

```text
api-intel-mcp --analysis <name>=<analysis.json> [--analysis ...]
              [--system <name>=<system-analysis.json> ...]
              [--policy <name>=<policy-results.json> ...]
              [--before <name>=<analysis.json> --after <name>=<analysis.json>]
```

- `--analysis` is repeatable and accepts a validated `completed` or
  `completed_with_gaps` analysis.
- `--system` is repeatable and accepts a validated `SystemAnalysisDocument`.
- `--policy` is repeatable and accepts a validated `PolicyResultsDocument`.
- `--before` and `--after` declare one explicit comparison pair. They must appear
  together and both refer to analysis documents.
- `--help` and `--version` are standalone invocations.

Paths identify JSON files, not repositories or source directories. Tool calls name
only artifacts already registered at startup; they cannot submit new filesystem paths.

## Tools

Every tool returns its strict P0 response as structured content and one concise text
summary. P0 result, traversal, and pagination ceilings remain authoritative.

| Tool                          | Required artifact kind | Meaning                                                       |
| ----------------------------- | ---------------------- | ------------------------------------------------------------- |
| `list_endpoints`              | analysis               | Filter and page canonical endpoints.                          |
| `get_endpoint_trace`          | analysis               | Exact endpoint guards, call steps, and side-effect terminals. |
| `resolve_symbol`              | analysis               | Resolve a class or method by canonical ID or declaration.     |
| `get_symbol_dependents`       | analysis               | Current-snapshot reverse dependency paths.                    |
| `compare_analyses`            | two analyses           | Semantic before/after changes.                                |
| `get_change_impact`           | two analyses           | Evidence-backed potential direct/transitive impact.           |
| `find_distributed_candidates` | system analysis        | Exact structural queue/message correlation candidates.        |
| `get_policy_results`          | policy                 | Filter already-evaluated policy results.                      |

`compare_analyses` and `get_change_impact` require the two distinct artifact names in
the tool request. The `before` and `after` startup roles make the intended pair visible
in the registry summary but do not silently replace request fields.

`get_symbol_dependents` is deliberately described as snapshot dependency reachability,
not blast radius. `find_distributed_candidates` requires the complete canonical
contract target and preserves `declared_realm_candidate`, `target_only_candidate`,
`ambiguous`, or `unmatched`; a candidate is never proof of delivery or execution.

## Tool-result limits and cancellation

The complete canonical serialization of a successful tool result—structured content
plus its concise text projection—is capped at 512 KiB. A result that would exceed the
cap becomes a small MCP tool error instructing the caller to narrow filters, use a
cursor, or request a lower limit. The tool never substitutes a silently truncated object
that would violate the P0 response schema. Text summaries are independently capped at
512 characters.

Each tool yields to the protocol dispatcher before entering the synchronous query
kernel. If the client has canceled that request, the kernel is not invoked and the SDK
suppresses the canceled response. Once synchronous kernel computation has begun,
JavaScript cannot be preempted until it returns; ordinary P0 count, depth, and state
ceilings bound that work. The server creates no background job or task.

## Resources

The server exposes no whole-document resource. Its JSON resources are capped at
256 KiB each:

- `api-intel://registry/artifacts` — artifact descriptors, explicit roles, and runtime
  version metadata;
- `api-intel://artifact/{artifactName}/evidence/{evidenceId}` — one exact evidence
  record from a named analysis; and
- `api-intel://artifact/{artifactName}/record/{recordId}` — one exact ID-bearing
  top-level canonical record plus its collection name.

URI variables must use their exact canonical values and be percent encoded where
required. Unknown artifacts or IDs return the MCP resource-not-found error. Policy
results are selected through `get_policy_results` because policy result identity is a
semantic key rather than a canonical top-level record ID.

Artifact-name selectors must satisfy the same 128-character query-name contract used by
tools. Decoded evidence and record IDs are limited to 256 characters, and encoded URI
components are rejected above a fixed pre-decode bound. Invalid percent encoding,
path-shaped artifact names, and oversized selectors are rejected without filesystem
access.

## Startup trust boundary

Before opening the transport, the process:

1. accepts at most 64 explicitly named artifacts;
2. resolves each supplied path to its canonical local path;
3. rejects an artifact larger than 64 MiB before reading it;
4. reads and parses each canonical file once, even if multiple roles reference it;
5. validates the document family and allowed analysis result state;
6. deeply freezes validated documents; and
7. constructs the immutable query and selected-resource indexes.

Any argument, path, JSON, schema, or result-state failure prevents the MCP transport
from starting.

## Stdio discipline

The only transport is stdio. Once serving starts, stdout is reserved for MCP protocol
frames. The startup banner and transport diagnostics go to stderr. Do not wrap the
server in a launcher that prints banners or progress to stdout.

## Independent versions

| Domain             | Current version | Meaning                                           |
| ------------------ | --------------- | ------------------------------------------------- |
| MCP server         | `1.2.0`         | Startup, tool, resource, and adapter contract     |
| MCP resources      | `1.0.0`         | Selected JSON resource envelopes                  |
| API Intelligence   | `0.1.0-alpha.1` | Engine/package version                            |
| Query response     | `1.0.0`         | Transport-neutral query request/response contract |
| Analysis document  | per artifact    | Canonical repository-analysis schema              |
| System analysis    | per artifact    | Canonical cross-service system schema             |
| Policy results     | per artifact    | Evaluated architecture-policy schema              |
| TypeScript MCP SDK | `2.0.0`         | Pinned server transport implementation            |

Equal-looking semantic-version values do not couple these contracts. Each domain has
its own constant and changes only for changes to that contract.

## Gate MK0 verification

Gate MK0 is closed by frozen tests covering:

- initialization, tool/resource discovery, and every successful tool call;
- ambiguous endpoint selection without arbitrary traversal;
- schema-invalid, path-shaped, over-limit, and wrong-kind tool inputs;
- malformed and schema-invalid artifact files plus pre-read artifact size rejection;
- oversized tool and resource projections;
- request cancellation before kernel execution;
- byte-stable structured results across repeated calls;
- retained analyzer evidence redaction; and
- absence of scan, shell, network, mutation, prompt, sampling, background-task, and
  whole-document surfaces.

The synthetic agent-attribution corpus measures citation accuracy, omitted dependency
facts, and false relationship claims for frozen answer records. Its result is documented
in the [Phase P1.3 evaluation baseline](benchmarks/phase-p1-3-mcp-evaluation.md). It is
not a live-model benchmark and does not support a universal reliability multiplier.

## Non-goals

The server exposes no remote transport, authentication, repository scanning,
configuration discovery, shell access, arbitrary file query, network access, mutation,
source editing, prompts, agent sampling, background work, or host-specific extension
packaging.
