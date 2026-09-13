# Differential System Impact

Milestone P4 provides two pure, versioned contracts over explicitly supplied static
artifacts. P4.1 compares system facts. P4.2 optionally continues evidence-backed local
changes across explicit broker-realm candidates into bounded worker paths. Neither
phase scans a repository, reads source control, imports target code, contacts a broker,
or claims runtime delivery.

The implementation is under `src/system-impact/`:

- `compareSystemAnalyses()` returns schema `1.0.0`, with
  `propagation.state = "not_computed"`;
- `propagateConditionalSystemImpact()` validates that P4.1 document and returns schema
  `2.0.0`, with `propagation.classification = "distributed_conditional"`;
- `serializeCanonicalSystemImpact()` supports both versions;
- `renderOfflineSystemImpactReport()` applies one P4.2 side overlay to the matching
  validated `SystemReportDocument` without changing the report schema.

## P4.1 comparison coverage

Both sides declare the same service namespace scope. Each service is classified
independently:

| State          | Meaning                                                        | May prove add/remove? |
| -------------- | -------------------------------------------------------------- | --------------------- |
| `available`    | A valid system snapshot contains that service artifact.        | Yes                   |
| `not_present`  | The service is known not to exist in that repository snapshot. | Yes                   |
| `missing`      | The expected artifact could not be supplied.                   | No                    |
| `incompatible` | The artifact is invalid, unsupported, or not publishable.      | No                    |

Topology has the same states. `not_present` means a topology is known not to have been
declared for that snapshot; it is not a missing manifest. Missing or incompatible
coverage produces `completed_with_unknowns`, records a typed uncertainty, and withholds
facts that would otherwise turn unavailable input into a false removal.

For an available topology, the comparer reuses the stitcher's canonical binding
selector. The realm assignments in the system document must agree with that exact
manifest. A valid system document paired with a different valid manifest is rejected.

## Semantic identities

- Services use the declared namespace.
- Producers and consumers use namespace, role, and the canonical source interaction
  or handler record ID. Queue or pattern text is never a stand-alone identity.
- Broker realms use explicit environment and broker aliases.
- Topology bindings use an exact source-record selector when declared, otherwise the
  complete structural contract.
- Correlations are anchored to producer identity. Consumer-only inventory uses the
  sorted consumer identities.

If records collide on one semantic identity, comparison records
`SEMANTIC_IDENTITY_AMBIGUOUS`, suppresses that key on both sides, and never chooses an
arbitrary candidate.

Schema `1.0.0` has separate collections for service, producer, consumer, realm,
binding, correlation, ambiguity, and declared-realm eligibility changes.
`conditionalCandidateChanges` are eligibility deltas only, not delivered-message
paths. Every P4.1 document contains:

```json
{
  "propagation": {
    "state": "not_computed",
    "reason": "phase_p4_1_contract_only"
  }
}
```

## P4.2 inputs and derivation

P4.2 accepts the validated P4.1 document, the exact before/after system documents, and
the exact source analysis artifact for every service marked `available` on each side.
Source analysis identity, schema, result state, and the complete projected distributed
record inventory must agree with the system snapshot. Schema `2.0.0` also publishes a
canonical content fingerprint for every side/service source artifact, so identical run
metadata cannot hide different source bytes. Input order is irrelevant.

For each service available on both sides, P4.2 calls the existing repository-local
potential-impact analyzer in memory. It does not serialize an intermediate impact file.
Two seed forms are retained:

1. a locally impacted HTTP endpoint whose canonical trace reaches an eligible
   distributed producer; and
2. a producer record that P4.1 itself reports as added, removed, or modified.

Each HTTP seed retains the content fingerprint of its derived local impact, local
reason/source-change kinds, assertion IDs, and evidence IDs. Each producer seed retains
its change kind and source interaction evidence. Source documents are referenced, not
embedded.

## Traversal and honesty boundary

Only a correlation whose state is exactly `declared_realm_candidate` is traversable.
target-only, ambiguous, and unmatched correlations remain inventory and never become a
P4.2 hop. Each retained hop records:

```text
changed endpoint or producer
  -> proven producer in its source artifact
  - - explicit declared-realm candidate - -> broker realm
  - - static delivery candidate - -> consumer handler
  -> source-local handler trace
  -> table/resource effect
```

If the consumer handler initiates another distributed producer, traversal may continue
through that producer's own declared-realm correlation. A repeated producer terminates
the branch with `truncation = "cycle"`. Hop, path, per-path effect, and traversal-state
ceilings are always recorded. Omitted path/effect counts remain explicit.

BullMQ exact-job producers reuse branch-selection facts when available. Effects from an
unselected branch are not attributed to the producer. Source-local distributed handler
matching is not used as a substitute for a system correlation; the cross-boundary
continuation still requires the declared realm.

Every downstream table or resource record has
`causalClass = "distributed_conditional"` and retains source analysis record, method,
assertion, and evidence IDs. A `complete` source-local trace still does not prove
deployment, routing, message delivery, acknowledgement, handler execution, or effect
execution.

Default limits are four broker hops, 200 retained paths, 64 effects per path, and 1,000
traversal states. Callers may lower them or raise them only within the hard schema
ceilings. Limit and cycle termination never silently disappear from the document.

## Graph overlay

P4.2 publishes one overlay for each available system side. Overlay node IDs align with
the existing system report's service, broker, endpoint, and effect node IDs. Cascade-
only edges receive their own stable impact-edge identity. Every node and edge retains
the path IDs that caused it to be highlighted.

```typescript
const impactV1 = compareSystemAnalyses(comparisonInput);
const impactV2 = propagateConditionalSystemImpact({
  comparison: impactV1,
  before: { system: beforeSystem, services: beforeSourceArtifacts },
  after: { system: afterSystem, services: afterSourceArtifacts },
});

const html = await renderOfflineSystemImpactReport({
  report: afterSystemReport,
  impact: impactV2,
  side: 'after',
});
```

The self-contained HTML opens in **Potential impact** view. Highlighted nodes and edges
mean only that an evidence-backed local change has a bounded static path through an
explicit topology candidate. The ordinary `stitch --with-graph` report remains a
current-snapshot topology view and is not changed into a differential report.

## CI boundary

P4.2 makes a qualified statement such as “this local change potentially affects this
worker/table through a distributed-conditional path” available to future adapters.
The existing P3 GitHub and GitLab workflows compare one repository pair and do not
automatically acquire, trust, or publish multi-service P4.2 artifacts. A future CI
composition must bind every service revision and topology artifact before using this
result; it cannot infer remote repositories from queue or pattern text.

## Non-goals

- Repository checkout, branch/merge-base discovery, or artifact acquisition.
- Queue/pattern-text-only producer/consumer matching.
- Runtime deployment, broker routing, delivery, acknowledgement, or execution claims.
- Unbounded traversal or speculative dynamic-target resolution.
- Automatic P3 CI publication or privileged pull-request comments.
