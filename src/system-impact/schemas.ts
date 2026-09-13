import { z } from 'zod';
import { jobQueueContractSchema, microserviceContractSchema } from '../system-analysis/schemas.js';
import {
  SYSTEM_BROKER_DESTINATION_KINDS,
  SYSTEM_BROKER_TECHNOLOGIES,
  SYSTEM_BROKER_TRANSPORTS,
  SYSTEM_CORRELATABLE_INTERACTION_KINDS,
  SYSTEM_CORRELATION_AMBIGUITY_REASONS,
  SYSTEM_CORRELATION_STATES,
  SYSTEM_ENDPOINT_ROLES,
  SYSTEM_UNMATCHED_REASONS,
} from '../system-analysis/model.js';
import { stableIdSchema } from '../model/schemas.js';
import { IMPACT_REASON_CODES } from '../impact/model.js';
import {
  SYSTEM_IMPACT_CHANGE_KINDS,
  SYSTEM_IMPACT_FACT_AVAILABILITY,
  SYSTEM_IMPACT_RESULT_STATES,
  SYSTEM_IMPACT_SCHEMA_VERSION,
  SYSTEM_IMPACT_SCHEMA_V2_VERSION,
  SYSTEM_IMPACT_GRAPH_EDGE_KINDS,
  SYSTEM_IMPACT_GRAPH_NODE_KINDS,
  SYSTEM_IMPACT_PROPAGATION_SEED_KINDS,
  SYSTEM_IMPACT_PROPAGATION_TRUNCATIONS,
  SYSTEM_IMPACT_SIDES,
  SYSTEM_IMPACT_UNCERTAINTY_CODES,
} from './model.js';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u);
const boundedText = z.string().min(1).max(1024);
const semanticKey = z.string().min(1).max(8192);
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const idFor = (kind: string) =>
  stableIdSchema.refine((value) => value.startsWith(`${kind}:`), {
    message: `Expected a ${kind} ID.`,
  });
const contractSchema = z.discriminatedUnion('targetKind', [
  jobQueueContractSchema,
  microserviceContractSchema,
]);

const availableServiceSnapshotSchema = z
  .object({
    namespace: identifier,
    state: z.literal('available'),
    serviceId: idFor('system_service'),
    analysisId: idFor('analysis'),
    analysisSchemaVersion: boundedText,
    analysisResultState: z.enum(['completed', 'completed_with_gaps']),
    displayName: boundedText,
    reason: z.null(),
  })
  .strict();
const notPresentServiceSnapshotSchema = z
  .object({
    namespace: identifier,
    state: z.literal('not_present'),
    serviceId: z.null(),
    analysisId: z.null(),
    analysisSchemaVersion: z.null(),
    analysisResultState: z.null(),
    displayName: z.null(),
    reason: z.null(),
  })
  .strict();
const unavailableServiceSnapshotSchema = z
  .object({
    namespace: identifier,
    state: z.enum(['missing', 'incompatible']),
    serviceId: z.null(),
    analysisId: z.null(),
    analysisSchemaVersion: z.null(),
    analysisResultState: z.null(),
    displayName: z.null(),
    reason: z.enum([
      'artifact_missing',
      'schema_incompatible',
      'artifact_invalid',
      'result_not_publishable',
    ]),
  })
  .strict();
const serviceSnapshotSchema = z.union([
  availableServiceSnapshotSchema,
  notPresentServiceSnapshotSchema,
  unavailableServiceSnapshotSchema,
]);

const topologySnapshotSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('available'),
      schemaVersion: boundedText,
      manifestFingerprint: fingerprint,
      reason: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal('not_present'),
      schemaVersion: z.null(),
      manifestFingerprint: z.null(),
      reason: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.enum(['missing', 'incompatible']),
      schemaVersion: z.null(),
      manifestFingerprint: z.null(),
      reason: z.enum([
        'artifact_missing',
        'schema_incompatible',
        'artifact_invalid',
        'result_not_publishable',
      ]),
    })
    .strict(),
]);

const factAvailabilitySchema = z
  .object({
    interactionEndpoints: z.enum(SYSTEM_IMPACT_FACT_AVAILABILITY),
    brokerRealms: z.enum(SYSTEM_IMPACT_FACT_AVAILABILITY),
    bindings: z.enum(SYSTEM_IMPACT_FACT_AVAILABILITY),
    correlations: z.enum(SYSTEM_IMPACT_FACT_AVAILABILITY),
  })
  .strict();
const inputSnapshotSchema = z
  .object({
    label: z.string().min(1).max(128),
    systemAnalysisId: idFor('system_analysis').nullable(),
    systemAnalysisSchemaVersion: boundedText.nullable(),
    services: z.array(serviceSnapshotSchema),
    topology: topologySnapshotSchema,
    facts: factAvailabilitySchema,
  })
  .strict();

const endpointSnapshotSchema = z
  .object({
    key: semanticKey,
    endpointId: idFor('system_endpoint'),
    serviceNamespace: identifier,
    role: z.enum(SYSTEM_ENDPOINT_ROLES),
    kind: z.enum(SYSTEM_CORRELATABLE_INTERACTION_KINDS),
    analysisRecordId: stableIdSchema,
    namespacedRecordId: idFor('system_record'),
    contract: contractSchema,
    contractKey: semanticKey,
    sourceTransport: z.enum(SYSTEM_BROKER_TRANSPORTS).nullable(),
    brokerRealmKey: semanticKey.nullable(),
  })
  .strict();

const realmSnapshotSchema = z
  .object({
    key: semanticKey,
    realmId: idFor('broker_realm'),
    brokerAlias: identifier,
    environmentAlias: identifier,
    technology: z.enum(SYSTEM_BROKER_TECHNOLOGIES),
    transport: z.enum(SYSTEM_BROKER_TRANSPORTS),
    destination: z
      .object({ kind: z.enum(SYSTEM_BROKER_DESTINATION_KINDS), value: boundedText })
      .strict(),
    prefix: identifier.nullable(),
    namespace: identifier.nullable(),
  })
  .strict();

const bindingSnapshotSchema = z
  .object({
    key: semanticKey,
    serviceNamespace: identifier,
    role: z.enum(SYSTEM_ENDPOINT_ROLES),
    analysisRecordId: stableIdSchema.nullable(),
    contract: contractSchema,
    contractKey: semanticKey,
    brokerRealmKey: semanticKey,
  })
  .strict();

const correlationSnapshotSchema = z
  .object({
    key: semanticKey,
    correlationId: idFor('system_correlation'),
    kind: z.enum(SYSTEM_CORRELATABLE_INTERACTION_KINDS),
    contractKey: semanticKey,
    state: z.enum(SYSTEM_CORRELATION_STATES),
    producerEndpointKey: semanticKey.nullable(),
    consumerEndpointKeys: z.array(semanticKey),
    brokerRealmKey: semanticKey.nullable(),
    unmatchedReason: z.enum(SYSTEM_UNMATCHED_REASONS).nullable(),
    ambiguityReason: z.enum(SYSTEM_CORRELATION_AMBIGUITY_REASONS).nullable(),
  })
  .strict();

const conditionalCandidateSnapshotSchema = z
  .object({
    key: semanticKey,
    correlationId: idFor('system_correlation'),
    producerEndpointKey: semanticKey,
    consumerEndpointKeys: z.array(semanticKey).min(1),
    brokerRealmKey: semanticKey,
  })
  .strict();

function changeSchema<T extends z.ZodType>(snapshot: T) {
  return z
    .object({
      key: semanticKey,
      changeKind: z.enum(SYSTEM_IMPACT_CHANGE_KINDS),
      before: snapshot.nullable(),
      after: snapshot.nullable(),
      reasons: z.array(identifier).min(1),
    })
    .strict();
}

const summarySchema = z
  .object({
    servicesAdded: z.number().int().nonnegative(),
    servicesRemoved: z.number().int().nonnegative(),
    servicesModified: z.number().int().nonnegative(),
    producersAdded: z.number().int().nonnegative(),
    producersRemoved: z.number().int().nonnegative(),
    producersModified: z.number().int().nonnegative(),
    consumersAdded: z.number().int().nonnegative(),
    consumersRemoved: z.number().int().nonnegative(),
    consumersModified: z.number().int().nonnegative(),
    realmsAdded: z.number().int().nonnegative(),
    realmsRemoved: z.number().int().nonnegative(),
    realmsModified: z.number().int().nonnegative(),
    bindingsAdded: z.number().int().nonnegative(),
    bindingsRemoved: z.number().int().nonnegative(),
    bindingsModified: z.number().int().nonnegative(),
    correlationsAdded: z.number().int().nonnegative(),
    correlationsRemoved: z.number().int().nonnegative(),
    correlationsModified: z.number().int().nonnegative(),
    ambiguitiesIntroduced: z.number().int().nonnegative(),
    ambiguitiesResolved: z.number().int().nonnegative(),
    conditionalCandidatesAdded: z.number().int().nonnegative(),
    conditionalCandidatesRemoved: z.number().int().nonnegative(),
    conditionalCandidatesModified: z.number().int().nonnegative(),
    uncertainties: z.number().int().nonnegative(),
  })
  .strict();

const uncertaintySchema = z
  .object({
    id: idFor('system_impact_uncertainty'),
    code: z.enum(SYSTEM_IMPACT_UNCERTAINTY_CODES),
    side: z.enum(SYSTEM_IMPACT_SIDES),
    subjectKey: semanticKey,
    message: boundedText,
  })
  .strict();

export const systemImpactDocumentV1Schema = z
  .object({
    schemaVersion: z.literal(SYSTEM_IMPACT_SCHEMA_VERSION),
    impactId: idFor('system_impact'),
    systemName: identifier,
    resultState: z.enum(SYSTEM_IMPACT_RESULT_STATES),
    before: inputSnapshotSchema,
    after: inputSnapshotSchema,
    summary: summarySchema,
    serviceChanges: z.array(changeSchema(serviceSnapshotSchema)),
    producerChanges: z.array(changeSchema(endpointSnapshotSchema)),
    consumerChanges: z.array(changeSchema(endpointSnapshotSchema)),
    realmChanges: z.array(changeSchema(realmSnapshotSchema)),
    bindingChanges: z.array(changeSchema(bindingSnapshotSchema)),
    correlationChanges: z.array(changeSchema(correlationSnapshotSchema)),
    conditionalCandidateChanges: z.array(changeSchema(conditionalCandidateSnapshotSchema)),
    uncertainties: z.array(uncertaintySchema),
    propagation: z
      .object({
        state: z.literal('not_computed'),
        reason: z.literal('phase_p4_1_contract_only'),
      })
      .strict(),
  })
  .strict();

const propagationSeedSchema = z
  .object({
    id: idFor('system_impact_seed'),
    key: semanticKey,
    side: z.enum(['before', 'after']),
    kind: z.enum(SYSTEM_IMPACT_PROPAGATION_SEED_KINDS),
    serviceNamespace: identifier,
    sourceAnalysisId: idFor('analysis'),
    endpointId: idFor('endpoint').nullable(),
    producerEndpointKey: semanticKey.nullable(),
    localImpactFingerprint: fingerprint.nullable(),
    producerChangeKind: z.enum(SYSTEM_IMPACT_CHANGE_KINDS).nullable(),
    sourceChangeKinds: z.array(z.enum(['added', 'removed', 'modified'])),
    reasonCodes: z.array(z.enum(IMPACT_REASON_CODES)),
    direct: z.boolean().nullable(),
    assertionIds: z.array(idFor('assertion')),
    evidenceIds: z.array(idFor('evidence')),
  })
  .strict();

const propagationHopSchema = z
  .object({
    index: z.number().int().nonnegative(),
    correlationId: idFor('system_correlation'),
    correlationState: z.literal('declared_realm_candidate'),
    producerEndpointId: idFor('system_endpoint'),
    producerEndpointKey: semanticKey,
    producerServiceNamespace: identifier,
    producerAnalysisRecordId: stableIdSchema,
    brokerRealmId: idFor('broker_realm'),
    brokerRealmKey: semanticKey,
    consumerEndpointId: idFor('system_endpoint'),
    consumerEndpointKey: semanticKey,
    consumerServiceNamespace: identifier,
    consumerAnalysisRecordId: stableIdSchema,
    assertionIds: z.array(idFor('assertion')),
    evidenceIds: z.array(idFor('evidence')),
  })
  .strict();

const tableEffectSchema = z
  .object({
    id: idFor('system_impact_effect'),
    key: semanticKey,
    kind: z.literal('table'),
    serviceNamespace: identifier,
    analysisRecordId: idFor('table'),
    methodId: idFor('method'),
    label: boundedText,
    direction: z.enum(['READ', 'WRITE']),
    technology: z.null(),
    operation: z.null(),
    causalClass: z.literal('distributed_conditional'),
    assertionIds: z.array(idFor('assertion')),
    evidenceIds: z.array(idFor('evidence')),
  })
  .strict();
const resourceEffectSchema = z
  .object({
    id: idFor('system_impact_effect'),
    key: semanticKey,
    kind: z.literal('resource'),
    serviceNamespace: identifier,
    analysisRecordId: idFor('resource_access'),
    methodId: idFor('method'),
    label: boundedText,
    direction: z.null(),
    technology: boundedText,
    operation: boundedText,
    causalClass: z.literal('distributed_conditional'),
    assertionIds: z.array(idFor('assertion')),
    evidenceIds: z.array(idFor('evidence')),
  })
  .strict();
const propagationEffectSchema = z.discriminatedUnion('kind', [
  tableEffectSchema,
  resourceEffectSchema,
]);

const propagationPathSchema = z
  .object({
    id: idFor('system_impact_path'),
    side: z.enum(['before', 'after']),
    seedId: idFor('system_impact_seed'),
    hops: z.array(propagationHopSchema).min(1),
    effects: z.array(propagationEffectSchema),
    completeness: z.enum(['complete', 'incomplete']),
    truncation: z.enum(SYSTEM_IMPACT_PROPAGATION_TRUNCATIONS),
    truncatedAtProducerEndpointId: idFor('system_endpoint').nullable(),
    diagnosticIds: z.array(idFor('diagnostic')),
  })
  .strict();

const overlayNodeSchema = z
  .object({
    nodeId: stableIdSchema,
    kind: z.enum(SYSTEM_IMPACT_GRAPH_NODE_KINDS),
    label: boundedText,
    parentNodeId: stableIdSchema.nullable(),
    serviceNamespace: identifier.nullable(),
    pathIds: z.array(idFor('system_impact_path')),
    effectIds: z.array(idFor('system_impact_effect')),
    classification: z.literal('distributed_conditional'),
  })
  .strict();
const overlayEdgeSchema = z
  .object({
    edgeId: stableIdSchema,
    source: stableIdSchema,
    target: stableIdSchema,
    kind: z.enum(SYSTEM_IMPACT_GRAPH_EDGE_KINDS),
    pathIds: z.array(idFor('system_impact_path')),
    classification: z.literal('distributed_conditional'),
  })
  .strict();
const overlaySchema = z
  .object({
    side: z.enum(['before', 'after']),
    systemAnalysisId: idFor('system_analysis'),
    nodes: z.array(overlayNodeSchema),
    edges: z.array(overlayEdgeSchema),
  })
  .strict();

const computedPropagationSchema = z
  .object({
    state: z.literal('computed'),
    classification: z.literal('distributed_conditional'),
    limits: z
      .object({
        maxHops: z.number().int().min(1).max(16),
        maxPaths: z.number().int().min(1).max(2_000),
        maxEffectsPerPath: z.number().int().min(1).max(500),
        maxTraversalStates: z.number().int().min(1).max(20_000),
      })
      .strict(),
    summary: z
      .object({
        seeds: z.number().int().nonnegative(),
        paths: z.number().int().nonnegative(),
        effects: z.number().int().nonnegative(),
        affectedServices: z.number().int().nonnegative(),
        cyclesTruncated: z.number().int().nonnegative(),
        hopLimitTruncations: z.number().int().nonnegative(),
        stateLimitReached: z.boolean(),
        pathsOmitted: z.number().int().nonnegative(),
        effectsOmitted: z.number().int().nonnegative(),
      })
      .strict(),
    sourceArtifacts: z.array(
      z
        .object({
          side: z.enum(['before', 'after']),
          serviceNamespace: identifier,
          analysisId: idFor('analysis'),
          schemaVersion: boundedText,
          resultState: z.enum(['completed', 'completed_with_gaps']),
          contentFingerprint: fingerprint,
        })
        .strict(),
    ),
    seeds: z.array(propagationSeedSchema),
    paths: z.array(propagationPathSchema),
    graphOverlays: z.array(overlaySchema),
  })
  .strict();

export const systemImpactDocumentV2Schema = systemImpactDocumentV1Schema
  .omit({ schemaVersion: true, propagation: true })
  .extend({
    schemaVersion: z.literal(SYSTEM_IMPACT_SCHEMA_V2_VERSION),
    propagation: computedPropagationSchema,
  })
  .strict();

export const systemImpactDocumentSchema = z.discriminatedUnion('schemaVersion', [
  systemImpactDocumentV1Schema,
  systemImpactDocumentV2Schema,
]);
