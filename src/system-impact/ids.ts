import { createStableId } from '../model/ids.js';
import { canonicalStringify } from '../model/ordering.js';
import type {
  SystemCorrelationImpactSnapshot,
  SystemImpactDocumentV1,
  SystemImpactDocumentV2,
  SystemImpactUncertaintyCode,
  SystemImpactSide,
} from './model.js';

export function systemEndpointImpactKey(input: {
  serviceNamespace: string;
  role: string;
  analysisRecordId: string;
}): string {
  return JSON.stringify([
    'system_endpoint',
    input.serviceNamespace,
    input.role,
    input.analysisRecordId,
  ]);
}

export function systemBrokerRealmImpactKey(input: {
  environmentAlias: string;
  brokerAlias: string;
}): string {
  return JSON.stringify(['broker_realm', input.environmentAlias, input.brokerAlias]);
}

export function systemTopologyBindingImpactKey(input: {
  serviceNamespace: string;
  role: string;
  analysisRecordId: string | null;
  contractKey: string;
}): string {
  return JSON.stringify([
    'topology_binding',
    input.serviceNamespace,
    input.role,
    input.analysisRecordId === null ? 'contract' : 'record',
    input.analysisRecordId ?? input.contractKey,
  ]);
}

export function systemCorrelationImpactKey(input: {
  kind: string;
  producerEndpointKey: string | null;
  consumerEndpointKeys: readonly string[];
}): string {
  return input.producerEndpointKey === null
    ? JSON.stringify([
        'system_correlation',
        input.kind,
        'consumers',
        ...[...input.consumerEndpointKeys].sort(),
      ])
    : JSON.stringify(['system_correlation', input.kind, 'producer', input.producerEndpointKey]);
}

export function systemConditionalCandidateImpactKey(
  input: Pick<SystemCorrelationImpactSnapshot, 'key'>,
): string {
  return JSON.stringify(['conditional_candidate', input.key]);
}

export function makeSystemImpactUncertaintyId(input: {
  code: SystemImpactUncertaintyCode;
  side: SystemImpactSide;
  subjectKey: string;
}): string {
  return createStableId('system_impact_uncertainty', [input.code, input.side, input.subjectKey]);
}

export function makeSystemImpactId(
  document: Omit<SystemImpactDocumentV1, 'impactId'> | Omit<SystemImpactDocumentV2, 'impactId'>,
): string {
  const normalizeSnapshot = (snapshot: unknown): unknown => {
    if (snapshot === null || typeof snapshot !== 'object') return snapshot;
    if (!('consumerEndpointKeys' in snapshot)) return snapshot;
    const value = snapshot as { readonly consumerEndpointKeys: readonly string[] };
    return { ...value, consumerEndpointKeys: [...value.consumerEndpointKeys].sort() };
  };
  const orderChanges = <T extends { readonly key: string; readonly reasons: readonly string[] }>(
    records: readonly T[],
  ) =>
    [...records]
      .map((record) => ({
        ...record,
        ...('before' in record ? { before: normalizeSnapshot(record.before) } : {}),
        ...('after' in record ? { after: normalizeSnapshot(record.after) } : {}),
        reasons: [...record.reasons].sort(),
      }))
      .sort((left, right) => left.key.localeCompare(right.key));
  const propagation =
    document.propagation.state === 'not_computed'
      ? document.propagation
      : {
          ...document.propagation,
          sourceArtifacts: [...document.propagation.sourceArtifacts].sort((left, right) =>
            `${left.side}:${left.serviceNamespace}`.localeCompare(
              `${right.side}:${right.serviceNamespace}`,
            ),
          ),
          seeds: [...document.propagation.seeds]
            .map((seed) => ({
              ...seed,
              sourceChangeKinds: [...seed.sourceChangeKinds].sort(),
              reasonCodes: [...seed.reasonCodes].sort(),
              assertionIds: [...seed.assertionIds].sort(),
              evidenceIds: [...seed.evidenceIds].sort(),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
          paths: [...document.propagation.paths]
            .map((path) => ({
              ...path,
              hops: [...path.hops]
                .map((hop) => ({
                  ...hop,
                  assertionIds: [...hop.assertionIds].sort(),
                  evidenceIds: [...hop.evidenceIds].sort(),
                }))
                .sort((left, right) => left.index - right.index),
              effects: [...path.effects]
                .map((effect) => ({
                  ...effect,
                  assertionIds: [...effect.assertionIds].sort(),
                  evidenceIds: [...effect.evidenceIds].sort(),
                }))
                .sort((left, right) => left.id.localeCompare(right.id)),
              diagnosticIds: [...path.diagnosticIds].sort(),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
          graphOverlays: [...document.propagation.graphOverlays]
            .map((overlay) => ({
              ...overlay,
              nodes: [...overlay.nodes]
                .map((node) => ({
                  ...node,
                  pathIds: [...node.pathIds].sort(),
                  effectIds: [...node.effectIds].sort(),
                }))
                .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
              edges: [...overlay.edges]
                .map((edge) => ({ ...edge, pathIds: [...edge.pathIds].sort() }))
                .sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
            }))
            .sort((left, right) => left.side.localeCompare(right.side)),
        };
  return createStableId('system_impact', [
    canonicalStringify({
      ...document,
      propagation,
      before: {
        ...document.before,
        services: [...document.before.services].sort((left, right) =>
          left.namespace.localeCompare(right.namespace),
        ),
      },
      after: {
        ...document.after,
        services: [...document.after.services].sort((left, right) =>
          left.namespace.localeCompare(right.namespace),
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
        left.id.localeCompare(right.id),
      ),
    }),
  ]);
}
