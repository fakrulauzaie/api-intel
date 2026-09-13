# Vendor-Neutral Query Kernel

The query kernel is a local, synchronous, read-only API above validated canonical
artifacts. Milestone P0 provides artifact registration, exact selectors, and bounded
semantic operations. It is intentionally independent of MCP, CI providers,
command-line source scans, and filesystem discovery.

## Artifact registry

`createQueryKernel()` accepts explicitly named documents with one of these kinds:

- `analysis`;
- `comparison`;
- `impact`;
- `policy`;
- `system_analysis`; or
- `system_report`.

Callers must use the existing integrity validator for each document before
registration. The kernel does not reinterpret an invalid document as partial data.
Artifact names are limited to 128 ASCII letters, digits, dots, underscores, or
hyphens and cannot contain path separators.

Every descriptor contains:

- `documentId`: a content address over the kind and canonical serialized document;
- `canonicalDocumentId`: the analysis run, system, or system-report ID when the
  document family defines one, otherwise `null`;
- the document kind and schema version; and
- its declared or conservatively combined result state. `system_report` uses
  `not_declared` because that derived contract contains no source-analysis result
  state.

Registration order does not affect descriptor order or identities.

## Endpoint selectors

Every selector returns exactly one state: `not_found`, `resolved`, or `ambiguous`.

An endpoint is selected either by its full canonical endpoint ID or by an exact
uppercase HTTP method and normalized route path. Route selection can legitimately
match multiple canonical endpoints—for example, when distinct handlers occupy the
same route slot. The response is then `ambiguous` and retains every bounded match; it
does not choose one handler.

Each endpoint match contains its canonical ID, method/path, all ordered
`ENDPOINT_IMPLEMENTED_BY` assertion references, direct endpoint diagnostic IDs, and
the evidence IDs from those handler assertions.

## Symbol selectors

P0.1 defines symbols narrowly as canonical class and method records. Select by:

1. full canonical class or method ID; or
2. normalized repository-relative `sourcePath` plus exact `qualifiedName`, optionally
   constrained by `kind` and a one-based source `location`.

The source location is compared with the declaration evidence range using an inclusive
start and exclusive end. It never causes a source-file read. Absolute paths, `..`,
backslashes, incomplete name-only requests, and arbitrary fuzzy selection are rejected.
Overloads or duplicate qualified declarations remain explicit ambiguous matches.

Each symbol match retains its source-file ID and path, declaration evidence ID and
range, full qualified name, display label, and class roles or method owner/signature.

## Bounds and response invariants

Defaults are 25 results per query and a configurable hard ceiling of 100. Kernel
configuration may lower or raise those values up to the absolute contract ceiling of
1,000. A larger request is clamped to the kernel ceiling and recorded as
`requested` versus `applied`.

Every response uses query schema `1.0.0` and records `totalMatches`, `returned`, and
`omitted`. Selector state is derived from the total before truncation, so a two-match
query limited to one result remains `ambiguous`. Matches, diagnostics, and evidence
references are unique and deterministically ordered. Runtime response schemas reject
inconsistent state, counts, ordering, or reference unions.

Cursor-based list operations use an exclusive canonical-key cursor. Their page
metadata distinguishes the total filtered collection, records skipped entries, and
provides `nextCursor` only when another bounded page exists. Endpoint traces bound
guards, assertion steps, table terminals, resource terminals, diagnostics, and causal
interaction/branch IDs independently. Reverse traversal has separate ceilings for
depth and visited states (defaults 5 and 1,000; absolute ceilings 10 and 10,000).

## Bounded semantic operations

`listEndpoints` filters by HTTP methods, literal path prefix, and presence or absence
of direct diagnostics, then pages by canonical endpoint ID.

`getEndpointTrace` first applies the exact endpoint selector. A route collision returns
`ambiguous` and no trace. Once exactly one endpoint is selected, the operation delegates
to the existing canonical endpoint-trace builder; it does not reimplement traversal.
Canonical-ID selection uses a one-endpoint projection solely to prevent a duplicate
route slot from overriding the already proven ID selection.

`compareAnalyses` and `getChangeImpact` require distinct, explicitly named before and
after analysis artifacts in a completed or completed-with-gaps state. They call the
existing comparison and potential-impact engines in memory. Responses retain the
before/after artifact roles, a content address for the derived document, semantic
families, reason codes, canonical IDs, evidence IDs, and omitted counts. Impact results
also expose the number of retained canonical paths behind each endpoint projection.

`getSymbolDependents` is current-snapshot reverse reachability, not change impact. A
method seeds itself; a class deterministically seeds its canonical member methods. The
only traversable reverse edges are resolved or ambiguous `METHOD_CALLS_METHOD`,
`ENDPOINT_IMPLEMENTED_BY`, and `HANDLER_IMPLEMENTED_BY` assertions. Each result keeps
the complete assertion path, evidence, and aggregate certainty. Cycles, depth, state
count, seed output, and result output are bounded explicitly.

`findDistributedCandidates` requires both `job_queue` or `microservice_message` and the
complete structural contract target. Matching uses the same canonical contract key as
system stitching. It returns the system document's declared-realm, target-only,
ambiguous, or unmatched state unchanged; target text alone is never sufficient.

`getPolicyResults` filters a registered `PolicyResultsDocument` by rule, outcome,
severity, or the independent blocking flag. It does not rerun policy evaluation.
Source and filtered summaries remain separate, and `unknown` is never rewritten as
`fail` or inferred to be blocking.

## Programmatic example

```typescript
import { createQueryKernel } from './src/query/index.js';

const kernel = createQueryKernel({
  artifacts: [{ name: 'current', kind: 'analysis', document: validatedAnalysis }],
});

const endpoint = kernel.resolveEndpoint({
  artifactName: 'current',
  selector: { by: 'route', httpMethod: 'PUT', path: '/resolve' },
  limit: 10,
});

const symbol = kernel.resolveSymbol({
  artifactName: 'current',
  selector: {
    by: 'declaration',
    sourcePath: 'src/modules/workflow/workflow.service.ts',
    qualifiedName: 'WorkflowService.resolveTicket',
    kind: 'method',
  },
});

const trace = kernel.getEndpointTrace({
  artifactName: 'current',
  selector: { by: 'canonical_id', canonicalId: endpoint.matches[0].canonicalId },
  limit: 25,
});

const dependents = kernel.getSymbolDependents({
  artifactName: 'current',
  selector: symbol.selector,
  maxDepth: 4,
  limit: 25,
});
```

The returned facts prove only what is present in the supplied artifacts. Milestone P0
performs no repository scan, target import or execution, network access, filesystem
lookup, or write. Gate PK0 freezes this boundary across analysis schemas v1-v8 and the
system-analysis schema.
