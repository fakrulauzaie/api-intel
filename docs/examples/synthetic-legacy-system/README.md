# Synthetic Legacy System Walkthrough

Status: maintained public example  
Ownership: project-authored synthetic material; Apache-2.0

This example models a common legacy split: an HTTP-facing `orders-api` asks an
`orders-worker` to rebuild an index through an RMQ queue. The producer and consumer are
separate static-analysis inputs, so matching message text alone is insufficient.

The executable source of truth is deliberately not copied into this directory:

- [producer source slice](../../../test/fixtures/system-stitching/microservices/orders-api-producer.ts.txt)
- [consumer source slice](../../../test/fixtures/system-stitching/microservices/orders-worker-consumer.ts.txt)
- [explicit topology](../../../test/fixtures/system-stitching/orders.topology.json)
- [complete positive/negative expectation manifest](../../../test/fixtures/system-stitching/gate.expected.json)

All source slices are `.ts.txt`, throw if accidentally evaluated, and are parsed and
type-checked only inside isolated tests. They contain generic project-authored names
and no external repository source or generated private artifact.

## Reviewed outcome

The concise [public expected artifact](expected-summary.json) is mechanically checked
against the `microservices-multi-service-declared-realm` case in the frozen manifest.
Its exact result is `declared_realm_candidate`: one static producer and one compatible
local consumer share the explicitly declared `shared-rmq`/`test` realm.

That result does not become a proven cross-service call. It must not imply broker
delivery, a cross-service synchronous path, or remote handler execution. Removing the
topology declaration changes the same text match to `target_only_candidate`; binding
the two services to different broker aliases produces `realm_mismatch`; adding a
second compatible request consumer produces ambiguity.

## Refactoring story

Assume `OrdersProducer.requestUpdate()` is being moved behind a cleaner workflow
service while `OrdersWorkerController.rebuildOrderIndex()` is split into smaller local
methods.

1. Scan the API and worker before the refactor and retain their canonical artifacts.
2. Refactor only local structure; keep the message mode, canonical pattern, and
   deployment-owned topology explicit.
3. Scan both services again and use `diff`/`impact` per repository.
4. Stitch the two post-refactor artifacts with the reviewed topology.
5. Accept local call-graph changes only after verifying that the external contract
   remains one `declared_realm_candidate` and that any worker-side table/resource
   effects still carry `distributed_conditional` causality.
6. Treat a new dynamic pattern, missing handler, realm mismatch, ambiguity, or
   diagnostic as a review decision—not as cosmetic graph noise.

This story demonstrates the intended product job: preserve externally significant
static facts while improving legacy implementation structure, and expose exactly
where proof becomes conditional.

## Verify the contract

From a source checkout:

```text
pnpm exec vitest run --configLoader runner test/unit/fixtures/system-stitching-gate-s0.test.ts test/unit/documentation/phase-o4-public-docs.test.ts
```

The first test validates and canonicalizes the complete topology matrix and type-checks
the source slices without importing them. The second binds this public summary and its
links to that maintained semantic source.
