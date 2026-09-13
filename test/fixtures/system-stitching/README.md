# System Stitching Gate S0 Corpus

This frozen corpus defines Phase 45 topology semantics without running either source
service or implementing the Phase 46 stitch engine. The RMQ pair uses a
synthetic `orders-api-example` producer and `orders-worker-example` consumer. The
BullMQ pair provides the equivalent queue/worker boundary.

Every `.ts.txt` file is parsed and type-checked in an isolated temporary project and
must throw if accidentally executed. `gate.expected.json` covers co-located,
producer-only, consumer-only, multi-service, same-target collision, missing-topology,
and ambiguity cases for both technologies.

The corpus never treats a declared-realm candidate as broker delivery. Pattern,
queue, or job equality without an explicit environment and broker alias remains a
`target_only_candidate` and can never be a proven cross-service edge.

The maintained
[public walkthrough](../../../docs/examples/synthetic-legacy-system/README.md) projects
the exact `microservices-multi-service-declared-realm` expectation into a legacy
refactoring story. The test fixture and `gate.expected.json` remain the semantic source
of truth; the public summary is checked against them to prevent drift.
