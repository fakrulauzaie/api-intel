import type {
  SystemAnalysisDocument,
  SystemBrokerDestination,
  SystemBrokerTechnology,
  SystemBrokerTransport,
  SystemCorrelatableInteractionKind,
  SystemCorrelationAmbiguityReason,
  SystemCorrelationState,
  SystemEndpointRole,
  SystemInteractionContractTarget,
  SystemTopologyManifest,
  SystemUnmatchedReason,
} from '../system-analysis/model.js';
import type { AnalysisDocument, TraceCausalClass } from '../model/analysis.js';
import type { ImpactReasonCode, SourceChangeKind } from '../impact/model.js';

export const SYSTEM_IMPACT_SCHEMA_VERSION = '1.0.0' as const;
export const SYSTEM_IMPACT_SCHEMA_V2_VERSION = '2.0.0' as const;
export type SystemImpactSchemaVersion =
  | typeof SYSTEM_IMPACT_SCHEMA_VERSION
  | typeof SYSTEM_IMPACT_SCHEMA_V2_VERSION;

export const SYSTEM_IMPACT_ARTIFACT_STATES = [
  'available',
  'not_present',
  'missing',
  'incompatible',
] as const;
export type SystemImpactArtifactState = (typeof SYSTEM_IMPACT_ARTIFACT_STATES)[number];

export const SYSTEM_IMPACT_RESULT_STATES = ['completed', 'completed_with_unknowns'] as const;
export type SystemImpactResultState = (typeof SYSTEM_IMPACT_RESULT_STATES)[number];

export const SYSTEM_IMPACT_FACT_AVAILABILITY = ['available', 'partial', 'unavailable'] as const;
export type SystemImpactFactAvailability = (typeof SYSTEM_IMPACT_FACT_AVAILABILITY)[number];

export const SYSTEM_IMPACT_CHANGE_KINDS = ['added', 'removed', 'modified'] as const;
export type SystemImpactChangeKind = (typeof SYSTEM_IMPACT_CHANGE_KINDS)[number];

export const SYSTEM_IMPACT_SIDES = ['before', 'after', 'both'] as const;
export type SystemImpactSide = (typeof SYSTEM_IMPACT_SIDES)[number];

export const SYSTEM_IMPACT_UNCERTAINTY_CODES = [
  'SERVICE_ARTIFACT_MISSING',
  'SERVICE_ARTIFACT_INCOMPATIBLE',
  'TOPOLOGY_ARTIFACT_MISSING',
  'TOPOLOGY_ARTIFACT_INCOMPATIBLE',
  'SEMANTIC_IDENTITY_AMBIGUOUS',
  'CORRELATION_FACTS_UNAVAILABLE',
] as const;
export type SystemImpactUncertaintyCode = (typeof SYSTEM_IMPACT_UNCERTAINTY_CODES)[number];

export type SystemImpactUnavailableReason =
  | 'artifact_missing'
  | 'schema_incompatible'
  | 'artifact_invalid'
  | 'result_not_publishable';

export type SystemImpactServiceObservation =
  | { readonly namespace: string; readonly state: 'available' }
  | { readonly namespace: string; readonly state: 'not_present' }
  | {
      readonly namespace: string;
      readonly state: 'missing' | 'incompatible';
      readonly reason: SystemImpactUnavailableReason;
    };

export type SystemImpactTopologyObservation =
  | { readonly state: 'available'; readonly manifest: SystemTopologyManifest }
  | { readonly state: 'not_present' }
  | {
      readonly state: 'missing' | 'incompatible';
      readonly reason: SystemImpactUnavailableReason;
    };

export interface SystemImpactSideInput {
  readonly label: string;
  /** The already validated stitch result for exactly the available service observations. */
  readonly document: SystemAnalysisDocument | null;
  /** Both sides must declare the same service namespace scope. */
  readonly services: readonly SystemImpactServiceObservation[];
  readonly topology: SystemImpactTopologyObservation;
}

export interface CompareSystemImpactInput {
  readonly systemName: string;
  readonly before: SystemImpactSideInput;
  readonly after: SystemImpactSideInput;
}

export interface SystemImpactPropagationServiceInput {
  readonly namespace: string;
  /** Required exactly when the corresponding P4.1 service observation is available. */
  readonly analysis: AnalysisDocument;
}

export interface SystemImpactPropagationSideInput {
  /** Required exactly when the P4.1 side has a system analysis ID. */
  readonly system: SystemAnalysisDocument | null;
  /** Exact source artifacts for every available service on this side. */
  readonly services: readonly SystemImpactPropagationServiceInput[];
}

export interface SystemImpactPropagationLimitsInput {
  readonly maxHops?: number | undefined;
  readonly maxPaths?: number | undefined;
  readonly maxEffectsPerPath?: number | undefined;
  readonly maxTraversalStates?: number | undefined;
}

export interface PropagateConditionalSystemImpactInput {
  readonly comparison: SystemImpactDocumentV1;
  readonly before: SystemImpactPropagationSideInput;
  readonly after: SystemImpactPropagationSideInput;
  readonly limits?: SystemImpactPropagationLimitsInput | undefined;
}

export type SystemServiceArtifactSnapshot =
  | {
      readonly namespace: string;
      readonly state: 'available';
      readonly serviceId: string;
      readonly analysisId: string;
      readonly analysisSchemaVersion: string;
      readonly analysisResultState: 'completed' | 'completed_with_gaps';
      readonly displayName: string;
      readonly reason: null;
    }
  | {
      readonly namespace: string;
      readonly state: 'not_present';
      readonly serviceId: null;
      readonly analysisId: null;
      readonly analysisSchemaVersion: null;
      readonly analysisResultState: null;
      readonly displayName: null;
      readonly reason: null;
    }
  | {
      readonly namespace: string;
      readonly state: 'missing' | 'incompatible';
      readonly serviceId: null;
      readonly analysisId: null;
      readonly analysisSchemaVersion: null;
      readonly analysisResultState: null;
      readonly displayName: null;
      readonly reason: SystemImpactUnavailableReason;
    };

export type SystemTopologyArtifactSnapshot =
  | {
      readonly state: 'available';
      readonly schemaVersion: string;
      readonly manifestFingerprint: string;
      readonly reason: null;
    }
  | {
      readonly state: 'not_present';
      readonly schemaVersion: null;
      readonly manifestFingerprint: null;
      readonly reason: null;
    }
  | {
      readonly state: 'missing' | 'incompatible';
      readonly schemaVersion: null;
      readonly manifestFingerprint: null;
      readonly reason: SystemImpactUnavailableReason;
    };

export interface SystemImpactFactAvailabilitySnapshot {
  readonly interactionEndpoints: SystemImpactFactAvailability;
  readonly brokerRealms: SystemImpactFactAvailability;
  readonly bindings: SystemImpactFactAvailability;
  readonly correlations: SystemImpactFactAvailability;
}

export interface SystemImpactInputSnapshot {
  readonly label: string;
  readonly systemAnalysisId: string | null;
  readonly systemAnalysisSchemaVersion: string | null;
  readonly services: readonly SystemServiceArtifactSnapshot[];
  readonly topology: SystemTopologyArtifactSnapshot;
  readonly facts: SystemImpactFactAvailabilitySnapshot;
}

export interface SystemEndpointImpactSnapshot {
  /** Namespaced source-record identity. Target text is never the identity. */
  readonly key: string;
  readonly endpointId: string;
  readonly serviceNamespace: string;
  readonly role: SystemEndpointRole;
  readonly kind: SystemCorrelatableInteractionKind;
  readonly analysisRecordId: string;
  readonly namespacedRecordId: string;
  readonly contract: SystemInteractionContractTarget;
  readonly contractKey: string;
  readonly sourceTransport: SystemBrokerTransport | null;
  readonly brokerRealmKey: string | null;
}

export interface SystemBrokerRealmImpactSnapshot {
  readonly key: string;
  readonly realmId: string;
  readonly brokerAlias: string;
  readonly environmentAlias: string;
  readonly technology: SystemBrokerTechnology;
  readonly transport: SystemBrokerTransport;
  readonly destination: SystemBrokerDestination;
  readonly prefix: string | null;
  readonly namespace: string | null;
}

export interface SystemTopologyBindingImpactSnapshot {
  readonly key: string;
  readonly serviceNamespace: string;
  readonly role: SystemEndpointRole;
  readonly analysisRecordId: string | null;
  readonly contract: SystemInteractionContractTarget;
  readonly contractKey: string;
  readonly brokerRealmKey: string;
}

export interface SystemCorrelationImpactSnapshot {
  readonly key: string;
  readonly correlationId: string;
  readonly kind: SystemCorrelatableInteractionKind;
  readonly contractKey: string;
  readonly state: SystemCorrelationState;
  readonly producerEndpointKey: string | null;
  readonly consumerEndpointKeys: readonly string[];
  readonly brokerRealmKey: string | null;
  readonly unmatchedReason: SystemUnmatchedReason | null;
  readonly ambiguityReason: SystemCorrelationAmbiguityReason | null;
}

export interface SystemConditionalCandidateImpactSnapshot {
  readonly key: string;
  readonly correlationId: string;
  readonly producerEndpointKey: string;
  readonly consumerEndpointKeys: readonly string[];
  readonly brokerRealmKey: string;
}

export interface SystemServiceImpactChange {
  readonly key: string;
  readonly changeKind: SystemImpactChangeKind;
  readonly before: SystemServiceArtifactSnapshot | null;
  readonly after: SystemServiceArtifactSnapshot | null;
  readonly reasons: readonly string[];
}

export interface SystemEndpointImpactChange {
  readonly key: string;
  readonly changeKind: SystemImpactChangeKind;
  readonly before: SystemEndpointImpactSnapshot | null;
  readonly after: SystemEndpointImpactSnapshot | null;
  readonly reasons: readonly string[];
}

export interface SystemBrokerRealmImpactChange {
  readonly key: string;
  readonly changeKind: SystemImpactChangeKind;
  readonly before: SystemBrokerRealmImpactSnapshot | null;
  readonly after: SystemBrokerRealmImpactSnapshot | null;
  readonly reasons: readonly string[];
}

export interface SystemTopologyBindingImpactChange {
  readonly key: string;
  readonly changeKind: SystemImpactChangeKind;
  readonly before: SystemTopologyBindingImpactSnapshot | null;
  readonly after: SystemTopologyBindingImpactSnapshot | null;
  readonly reasons: readonly string[];
}

export interface SystemCorrelationImpactChange {
  readonly key: string;
  readonly changeKind: SystemImpactChangeKind;
  readonly before: SystemCorrelationImpactSnapshot | null;
  readonly after: SystemCorrelationImpactSnapshot | null;
  readonly reasons: readonly string[];
}

export interface SystemConditionalCandidateImpactChange {
  readonly key: string;
  readonly changeKind: SystemImpactChangeKind;
  readonly before: SystemConditionalCandidateImpactSnapshot | null;
  readonly after: SystemConditionalCandidateImpactSnapshot | null;
  readonly reasons: readonly string[];
}

export interface SystemImpactUncertainty {
  readonly id: string;
  readonly code: SystemImpactUncertaintyCode;
  readonly side: SystemImpactSide;
  readonly subjectKey: string;
  readonly message: string;
}

export interface SystemImpactSummary {
  readonly servicesAdded: number;
  readonly servicesRemoved: number;
  readonly servicesModified: number;
  readonly producersAdded: number;
  readonly producersRemoved: number;
  readonly producersModified: number;
  readonly consumersAdded: number;
  readonly consumersRemoved: number;
  readonly consumersModified: number;
  readonly realmsAdded: number;
  readonly realmsRemoved: number;
  readonly realmsModified: number;
  readonly bindingsAdded: number;
  readonly bindingsRemoved: number;
  readonly bindingsModified: number;
  readonly correlationsAdded: number;
  readonly correlationsRemoved: number;
  readonly correlationsModified: number;
  readonly ambiguitiesIntroduced: number;
  readonly ambiguitiesResolved: number;
  readonly conditionalCandidatesAdded: number;
  readonly conditionalCandidatesRemoved: number;
  readonly conditionalCandidatesModified: number;
  readonly uncertainties: number;
}

export interface SystemImpactDocumentV1 {
  readonly schemaVersion: typeof SYSTEM_IMPACT_SCHEMA_VERSION;
  readonly impactId: string;
  readonly systemName: string;
  readonly resultState: SystemImpactResultState;
  readonly before: SystemImpactInputSnapshot;
  readonly after: SystemImpactInputSnapshot;
  readonly summary: SystemImpactSummary;
  readonly serviceChanges: readonly SystemServiceImpactChange[];
  readonly producerChanges: readonly SystemEndpointImpactChange[];
  readonly consumerChanges: readonly SystemEndpointImpactChange[];
  readonly realmChanges: readonly SystemBrokerRealmImpactChange[];
  readonly bindingChanges: readonly SystemTopologyBindingImpactChange[];
  readonly correlationChanges: readonly SystemCorrelationImpactChange[];
  /** Eligibility deltas only. Phase P4.1 does not calculate downstream paths or effects. */
  readonly conditionalCandidateChanges: readonly SystemConditionalCandidateImpactChange[];
  readonly uncertainties: readonly SystemImpactUncertainty[];
  readonly propagation: {
    readonly state: 'not_computed';
    readonly reason: 'phase_p4_1_contract_only';
  };
}

export const SYSTEM_IMPACT_PROPAGATION_SEED_KINDS = [
  'impacted_http_endpoint',
  'changed_producer',
] as const;
export type SystemImpactPropagationSeedKind = (typeof SYSTEM_IMPACT_PROPAGATION_SEED_KINDS)[number];

export const SYSTEM_IMPACT_PROPAGATION_TRUNCATIONS = ['none', 'cycle', 'hop_limit'] as const;
export type SystemImpactPropagationTruncation =
  (typeof SYSTEM_IMPACT_PROPAGATION_TRUNCATIONS)[number];

export interface SystemDistributedImpactSeed {
  readonly id: string;
  readonly key: string;
  readonly side: Exclude<SystemImpactSide, 'both'>;
  readonly kind: SystemImpactPropagationSeedKind;
  readonly serviceNamespace: string;
  readonly sourceAnalysisId: string;
  readonly endpointId: string | null;
  readonly producerEndpointKey: string | null;
  readonly localImpactFingerprint: string | null;
  readonly producerChangeKind: SystemImpactChangeKind | null;
  readonly sourceChangeKinds: readonly SourceChangeKind[];
  readonly reasonCodes: readonly ImpactReasonCode[];
  readonly direct: boolean | null;
  readonly assertionIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface SystemDistributedImpactHop {
  readonly index: number;
  readonly correlationId: string;
  readonly correlationState: 'declared_realm_candidate';
  readonly producerEndpointId: string;
  readonly producerEndpointKey: string;
  readonly producerServiceNamespace: string;
  readonly producerAnalysisRecordId: string;
  readonly brokerRealmId: string;
  readonly brokerRealmKey: string;
  readonly consumerEndpointId: string;
  readonly consumerEndpointKey: string;
  readonly consumerServiceNamespace: string;
  readonly consumerAnalysisRecordId: string;
  readonly assertionIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export type SystemDistributedImpactEffect =
  | {
      readonly id: string;
      readonly key: string;
      readonly kind: 'table';
      readonly serviceNamespace: string;
      readonly analysisRecordId: string;
      readonly methodId: string;
      readonly label: string;
      readonly direction: 'READ' | 'WRITE';
      readonly technology: null;
      readonly operation: null;
      readonly causalClass: Extract<TraceCausalClass, 'distributed_conditional'>;
      readonly assertionIds: readonly string[];
      readonly evidenceIds: readonly string[];
    }
  | {
      readonly id: string;
      readonly key: string;
      readonly kind: 'resource';
      readonly serviceNamespace: string;
      readonly analysisRecordId: string;
      readonly methodId: string;
      readonly label: string;
      readonly direction: null;
      readonly technology: string;
      readonly operation: string;
      readonly causalClass: Extract<TraceCausalClass, 'distributed_conditional'>;
      readonly assertionIds: readonly string[];
      readonly evidenceIds: readonly string[];
    };

export interface SystemDistributedImpactPath {
  readonly id: string;
  readonly side: Exclude<SystemImpactSide, 'both'>;
  readonly seedId: string;
  readonly hops: readonly SystemDistributedImpactHop[];
  readonly effects: readonly SystemDistributedImpactEffect[];
  readonly completeness: 'complete' | 'incomplete';
  readonly truncation: SystemImpactPropagationTruncation;
  readonly truncatedAtProducerEndpointId: string | null;
  readonly diagnosticIds: readonly string[];
}

export const SYSTEM_IMPACT_GRAPH_NODE_KINDS = [
  'service',
  'broker_realm',
  'broker_destination',
  'http_endpoint',
  'producer',
  'consumer',
  'table_effect',
  'resource_effect',
] as const;
export type SystemImpactGraphNodeKind = (typeof SYSTEM_IMPACT_GRAPH_NODE_KINDS)[number];

export const SYSTEM_IMPACT_GRAPH_EDGE_KINDS = [
  'initiates',
  'conditional_route',
  'conditional_candidate',
  'conditional_effect',
] as const;
export type SystemImpactGraphEdgeKind = (typeof SYSTEM_IMPACT_GRAPH_EDGE_KINDS)[number];

export interface SystemImpactGraphOverlayNode {
  /** Matches the corresponding SystemReport graph node ID. */
  readonly nodeId: string;
  readonly kind: SystemImpactGraphNodeKind;
  readonly label: string;
  readonly parentNodeId: string | null;
  readonly serviceNamespace: string | null;
  readonly pathIds: readonly string[];
  readonly effectIds: readonly string[];
  readonly classification: 'distributed_conditional';
}

export interface SystemImpactGraphOverlayEdge {
  /** Matches the corresponding SystemReport edge ID where that edge exists. */
  readonly edgeId: string;
  readonly source: string;
  readonly target: string;
  readonly kind: SystemImpactGraphEdgeKind;
  readonly pathIds: readonly string[];
  readonly classification: 'distributed_conditional';
}

export interface SystemImpactGraphOverlay {
  readonly side: Exclude<SystemImpactSide, 'both'>;
  readonly systemAnalysisId: string;
  readonly nodes: readonly SystemImpactGraphOverlayNode[];
  readonly edges: readonly SystemImpactGraphOverlayEdge[];
}

export interface SystemImpactPropagationSummary {
  readonly seeds: number;
  readonly paths: number;
  readonly effects: number;
  readonly affectedServices: number;
  readonly cyclesTruncated: number;
  readonly hopLimitTruncations: number;
  readonly stateLimitReached: boolean;
  readonly pathsOmitted: number;
  readonly effectsOmitted: number;
}

export interface SystemImpactPropagationSourceArtifact {
  readonly side: Exclude<SystemImpactSide, 'both'>;
  readonly serviceNamespace: string;
  readonly analysisId: string;
  readonly schemaVersion: string;
  readonly resultState: 'completed' | 'completed_with_gaps';
  readonly contentFingerprint: string;
}

export interface SystemImpactDocumentV2
  extends Omit<SystemImpactDocumentV1, 'schemaVersion' | 'propagation'> {
  readonly schemaVersion: typeof SYSTEM_IMPACT_SCHEMA_V2_VERSION;
  readonly propagation: {
    readonly state: 'computed';
    readonly classification: 'distributed_conditional';
    readonly limits: {
      readonly maxHops: number;
      readonly maxPaths: number;
      readonly maxEffectsPerPath: number;
      readonly maxTraversalStates: number;
    };
    readonly summary: SystemImpactPropagationSummary;
    readonly sourceArtifacts: readonly SystemImpactPropagationSourceArtifact[];
    readonly seeds: readonly SystemDistributedImpactSeed[];
    readonly paths: readonly SystemDistributedImpactPath[];
    readonly graphOverlays: readonly SystemImpactGraphOverlay[];
  };
}

export type SystemImpactDocument = SystemImpactDocumentV1 | SystemImpactDocumentV2;
