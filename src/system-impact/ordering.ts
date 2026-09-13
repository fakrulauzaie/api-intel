import { canonicalStringify } from '../model/ordering.js';
import type { SystemImpactDocument } from './model.js';
import { assertValidSystemImpactDocument } from './validate.js';

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function normalizeSnapshot<T>(snapshot: T): T {
  if (snapshot === null || typeof snapshot !== 'object' || !('consumerEndpointKeys' in snapshot)) {
    return snapshot;
  }
  const value = snapshot as T & { readonly consumerEndpointKeys: readonly string[] };
  return { ...value, consumerEndpointKeys: [...value.consumerEndpointKeys].sort(compareStrings) };
}

function orderChanges<
  T extends {
    readonly key: string;
    readonly reasons: readonly string[];
    readonly before: unknown;
    readonly after: unknown;
  },
>(records: readonly T[]): T[] {
  return [...records]
    .map(
      (record) =>
        ({
          ...record,
          before: normalizeSnapshot(record.before),
          after: normalizeSnapshot(record.after),
          reasons: [...record.reasons].sort(compareStrings),
        }) as T,
    )
    .sort((left, right) => compareStrings(left.key, right.key));
}

export function canonicalizeSystemImpactDocument(
  input: SystemImpactDocument,
): SystemImpactDocument {
  const document = assertValidSystemImpactDocument(input);
  const propagation =
    document.propagation.state === 'not_computed'
      ? document.propagation
      : {
          ...document.propagation,
          sourceArtifacts: [...document.propagation.sourceArtifacts].sort((left, right) =>
            compareStrings(
              `${left.side}:${left.serviceNamespace}`,
              `${right.side}:${right.serviceNamespace}`,
            ),
          ),
          seeds: [...document.propagation.seeds]
            .map((seed) => ({
              ...seed,
              sourceChangeKinds: [...seed.sourceChangeKinds].sort(compareStrings),
              reasonCodes: [...seed.reasonCodes].sort(compareStrings),
              assertionIds: [...seed.assertionIds].sort(compareStrings),
              evidenceIds: [...seed.evidenceIds].sort(compareStrings),
            }))
            .sort((left, right) => compareStrings(left.id, right.id)),
          paths: [...document.propagation.paths]
            .map((path) => ({
              ...path,
              hops: [...path.hops]
                .map((hop) => ({
                  ...hop,
                  assertionIds: [...hop.assertionIds].sort(compareStrings),
                  evidenceIds: [...hop.evidenceIds].sort(compareStrings),
                }))
                .sort((left, right) => left.index - right.index),
              effects: [...path.effects]
                .map((effect) => ({
                  ...effect,
                  assertionIds: [...effect.assertionIds].sort(compareStrings),
                  evidenceIds: [...effect.evidenceIds].sort(compareStrings),
                }))
                .sort((left, right) => compareStrings(left.id, right.id)),
              diagnosticIds: [...path.diagnosticIds].sort(compareStrings),
            }))
            .sort((left, right) => compareStrings(left.id, right.id)),
          graphOverlays: [...document.propagation.graphOverlays]
            .map((overlay) => ({
              ...overlay,
              nodes: [...overlay.nodes]
                .map((node) => ({
                  ...node,
                  pathIds: [...node.pathIds].sort(compareStrings),
                  effectIds: [...node.effectIds].sort(compareStrings),
                }))
                .sort((left, right) => compareStrings(left.nodeId, right.nodeId)),
              edges: [...overlay.edges]
                .map((edge) => ({
                  ...edge,
                  pathIds: [...edge.pathIds].sort(compareStrings),
                }))
                .sort((left, right) => compareStrings(left.edgeId, right.edgeId)),
            }))
            .sort((left, right) => compareStrings(left.side, right.side)),
        };
  return {
    ...document,
    propagation,
    before: {
      ...document.before,
      services: [...document.before.services].sort((left, right) =>
        compareStrings(left.namespace, right.namespace),
      ),
    },
    after: {
      ...document.after,
      services: [...document.after.services].sort((left, right) =>
        compareStrings(left.namespace, right.namespace),
      ),
    },
    serviceChanges: orderChanges(document.serviceChanges),
    producerChanges: orderChanges(document.producerChanges),
    consumerChanges: orderChanges(document.consumerChanges),
    realmChanges: orderChanges(document.realmChanges),
    bindingChanges: orderChanges(document.bindingChanges),
    correlationChanges: orderChanges(document.correlationChanges),
    conditionalCandidateChanges: orderChanges(document.conditionalCandidateChanges),
    uncertainties: [...document.uncertainties].sort((left, right) =>
      compareStrings(left.id, right.id),
    ),
  } as SystemImpactDocument;
}

export function serializeCanonicalSystemImpact(document: SystemImpactDocument): string {
  return canonicalStringify(canonicalizeSystemImpactDocument(document));
}
