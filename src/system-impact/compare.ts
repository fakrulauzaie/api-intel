import { hashContent } from '../model/hashing.js';
import { canonicalStringify } from '../model/ordering.js';
import {
  makeBrokerRealmId,
  systemInteractionContractKey,
  systemTopologyBindingMatchesEndpoint,
  validateSystemAnalysisDocument,
  validateSystemTopologyManifest,
  type SystemAnalysisDocument,
  type SystemInteractionCorrelationRecord,
  type SystemTopologyManifest,
} from '../system-analysis/index.js';
import {
  makeSystemImpactId,
  makeSystemImpactUncertaintyId,
  systemBrokerRealmImpactKey,
  systemConditionalCandidateImpactKey,
  systemCorrelationImpactKey,
  systemEndpointImpactKey,
  systemTopologyBindingImpactKey,
} from './ids.js';
import {
  SYSTEM_IMPACT_SCHEMA_VERSION,
  type CompareSystemImpactInput,
  type SystemBrokerRealmImpactChange,
  type SystemBrokerRealmImpactSnapshot,
  type SystemConditionalCandidateImpactChange,
  type SystemConditionalCandidateImpactSnapshot,
  type SystemCorrelationImpactChange,
  type SystemCorrelationImpactSnapshot,
  type SystemEndpointImpactChange,
  type SystemEndpointImpactSnapshot,
  type SystemImpactChangeKind,
  type SystemImpactDocumentV1,
  type SystemImpactInputSnapshot,
  type SystemImpactServiceObservation,
  type SystemImpactSide,
  type SystemImpactSideInput,
  type SystemImpactSummary,
  type SystemImpactUncertainty,
  type SystemImpactUncertaintyCode,
  type SystemServiceArtifactSnapshot,
  type SystemServiceImpactChange,
  type SystemTopologyArtifactSnapshot,
  type SystemTopologyBindingImpactChange,
  type SystemTopologyBindingImpactSnapshot,
} from './model.js';
import { assertValidSystemImpactDocument } from './validate.js';

export interface SystemImpactComparisonIssue {
  readonly path: string;
  readonly message: string;
}

export class SystemImpactComparisonError extends Error {
  readonly issues: readonly SystemImpactComparisonIssue[];

  constructor(issues: readonly SystemImpactComparisonIssue[]) {
    super(`System impact input is invalid with ${issues.length} issue(s).`);
    this.name = 'SystemImpactComparisonError';
    this.issues = issues;
  }
}

interface PreparedSide {
  readonly input: SystemImpactSideInput;
  readonly document: SystemAnalysisDocument | null;
  readonly topology: SystemTopologyManifest | null;
  readonly observations: ReadonlyMap<string, SystemImpactServiceObservation>;
  readonly snapshot: SystemImpactInputSnapshot;
}

type Keyed = { readonly key: string };

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function isKnownState(state: SystemImpactServiceObservation['state']): boolean {
  return state === 'available' || state === 'not_present';
}

function topologyIsKnown(side: PreparedSide): boolean {
  return side.input.topology.state === 'available' || side.input.topology.state === 'not_present';
}

function allServicesKnown(side: PreparedSide): boolean {
  return [...side.observations.values()].every(({ state }) => isKnownState(state));
}

function validateInputName(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(value) && value.length <= 128;
}

function prepareSide(
  input: SystemImpactSideInput,
  systemName: string,
  path: string,
  issues: SystemImpactComparisonIssue[],
): PreparedSide | null {
  if (input.label.length === 0 || input.label.length > 128) {
    issues.push({ path: `${path}.label`, message: 'Label must contain 1 to 128 characters.' });
  }

  const observations = new Map<string, SystemImpactServiceObservation>();
  for (const [index, observation] of input.services.entries()) {
    if (!validateInputName(observation.namespace)) {
      issues.push({
        path: `${path}.services.${index}.namespace`,
        message: 'Service namespace is not a valid canonical identifier.',
      });
    }
    if (observations.has(observation.namespace)) {
      issues.push({
        path: `${path}.services.${index}.namespace`,
        message: `Service namespace ${observation.namespace} is repeated.`,
      });
    }
    if (
      (observation.state === 'missing' && observation.reason !== 'artifact_missing') ||
      (observation.state === 'incompatible' && observation.reason === 'artifact_missing')
    ) {
      issues.push({
        path: `${path}.services.${index}.reason`,
        message: 'Artifact state and unavailable reason are contradictory.',
      });
    }
    observations.set(observation.namespace, observation);
  }

  let document: SystemAnalysisDocument | null = null;
  if (input.document !== null) {
    const validation = validateSystemAnalysisDocument(input.document);
    if (!validation.success) {
      issues.push({
        path: `${path}.document`,
        message: `System analysis document failed integrity validation (${validation.issues.length} issue(s)).`,
      });
    } else {
      document = validation.data;
      if (document.systemName !== systemName) {
        issues.push({
          path: `${path}.document.systemName`,
          message: `Expected system ${systemName}, received ${document.systemName}.`,
        });
      }
    }
  }

  const availableNamespaces = [...observations.values()]
    .filter(({ state }) => state === 'available')
    .map(({ namespace }) => namespace)
    .sort(compareStrings);
  const documentNamespaces = (document?.services ?? [])
    .map(({ namespace }) => namespace)
    .sort(compareStrings);
  if (canonicalStringify(availableNamespaces) !== canonicalStringify(documentNamespaces)) {
    issues.push({
      path: `${path}.document.services`,
      message:
        'The system document must contain exactly the services observed as available on this side.',
    });
  }
  if (availableNamespaces.length === 0 && input.document !== null) {
    issues.push({
      path: `${path}.document`,
      message: 'A side with no available services must be null.',
    });
  }
  if (availableNamespaces.length > 0 && input.document === null) {
    issues.push({
      path: `${path}.document`,
      message: 'A side with available services requires a validated system document.',
    });
  }

  let topology: SystemTopologyManifest | null = null;
  if (input.topology.state === 'available') {
    const validation = validateSystemTopologyManifest(input.topology.manifest);
    if (!validation.success) {
      issues.push({
        path: `${path}.topology.manifest`,
        message: `Topology manifest failed validation (${validation.issues.length} issue(s)).`,
      });
    } else {
      topology = validation.data;
      if (topology.systemName !== systemName) {
        issues.push({
          path: `${path}.topology.manifest.systemName`,
          message: `Expected system ${systemName}, received ${topology.systemName}.`,
        });
      }
    }
  } else if (
    (input.topology.state === 'missing' && input.topology.reason !== 'artifact_missing') ||
    (input.topology.state === 'incompatible' && input.topology.reason === 'artifact_missing')
  ) {
    issues.push({
      path: `${path}.topology.reason`,
      message: 'Topology state and unavailable reason are contradictory.',
    });
  }

  if (document !== null && input.topology.state === 'not_present') {
    if (
      document.brokerRealms.length > 0 ||
      document.interactionEndpoints.some(({ brokerRealmId }) => brokerRealmId !== null)
    ) {
      issues.push({
        path: `${path}.topology`,
        message: 'A known-absent topology cannot accompany declared realm assignments.',
      });
    }
  }
  if (document !== null && topology !== null) {
    const declaredRealms = new Map(
      topology.brokerRealms.map((record) => [
        `${record.environmentAlias}:${record.brokerAlias}`,
        record,
      ]),
    );
    for (const [index, record] of document.brokerRealms.entries()) {
      const declared = declaredRealms.get(`${record.environmentAlias}:${record.brokerAlias}`);
      if (declared === undefined || makeBrokerRealmId(declared) !== record.id) {
        issues.push({
          path: `${path}.document.brokerRealms.${index}`,
          message: 'System realm facts must agree with the supplied topology manifest.',
        });
      }
    }
    if (document.brokerRealms.length !== topology.brokerRealms.length) {
      issues.push({
        path: `${path}.document.brokerRealms`,
        message: 'The system document and topology manifest must expose the same realm set.',
      });
    }

    const servicesById = new Map(document.services.map((record) => [record.id, record]));
    const realmIdsByAlias = new Map(
      topology.brokerRealms.map((record) => [
        `${record.environmentAlias}:${record.brokerAlias}`,
        makeBrokerRealmId(record),
      ]),
    );
    const matchedBindingIndexes = new Set<number>();
    for (const [index, endpoint] of document.interactionEndpoints.entries()) {
      const service = servicesById.get(endpoint.serviceId);
      if (service === undefined) continue;
      const matches = topology.bindings.flatMap((binding, bindingIndex) =>
        systemTopologyBindingMatchesEndpoint(binding, {
          namespace: service.namespace,
          role: endpoint.role,
          sourceRecordId: endpoint.analysisRecord.analysisRecordId,
          contract: endpoint.contract,
        })
          ? [{ binding, bindingIndex }]
          : [],
      );
      if (matches.length > 1) {
        issues.push({
          path: `${path}.document.interactionEndpoints.${index}.brokerRealmId`,
          message: 'More than one topology binding selects this system endpoint.',
        });
        continue;
      }
      const match = matches[0];
      const expectedRealmId =
        match === undefined
          ? null
          : (realmIdsByAlias.get(
              `${match.binding.environmentAlias}:${match.binding.brokerAlias}`,
            ) ?? null);
      if (endpoint.brokerRealmId !== expectedRealmId) {
        issues.push({
          path: `${path}.document.interactionEndpoints.${index}.brokerRealmId`,
          message: 'System endpoint realm assignment does not match canonical topology selection.',
        });
      }
      if (match !== undefined) matchedBindingIndexes.add(match.bindingIndex);
    }
    for (const [index, binding] of topology.bindings.entries()) {
      if (
        observations.get(binding.serviceNamespace)?.state === 'available' &&
        !matchedBindingIndexes.has(index)
      ) {
        issues.push({
          path: `${path}.topology.manifest.bindings.${index}`,
          message: 'A binding for an available service must select exactly one system endpoint.',
        });
      }
    }
  }
  if (topology !== null) {
    for (const [index, binding] of topology.bindings.entries()) {
      if (!observations.has(binding.serviceNamespace)) {
        issues.push({
          path: `${path}.topology.manifest.bindings.${index}.serviceNamespace`,
          message: 'Topology bindings must stay inside the explicit service comparison scope.',
        });
      }
    }
  }

  const serviceRecords = new Map(
    (document?.services ?? []).map((service) => [service.namespace, service]),
  );
  const serviceSnapshots = [...observations.values()]
    .map((observation): SystemServiceArtifactSnapshot => {
      if (observation.state === 'available') {
        const service = serviceRecords.get(observation.namespace);
        if (service === undefined) {
          return {
            namespace: observation.namespace,
            state: 'not_present',
            serviceId: null,
            analysisId: null,
            analysisSchemaVersion: null,
            analysisResultState: null,
            displayName: null,
            reason: null,
          };
        }
        return {
          namespace: observation.namespace,
          state: 'available',
          serviceId: service.id,
          analysisId: service.analysisId,
          analysisSchemaVersion: service.analysisSchemaVersion,
          analysisResultState: service.analysisResultState,
          displayName: service.displayName,
          reason: null,
        };
      }
      if (observation.state === 'not_present') {
        return {
          namespace: observation.namespace,
          state: 'not_present',
          serviceId: null,
          analysisId: null,
          analysisSchemaVersion: null,
          analysisResultState: null,
          displayName: null,
          reason: null,
        };
      }
      return {
        namespace: observation.namespace,
        state: observation.state,
        serviceId: null,
        analysisId: null,
        analysisSchemaVersion: null,
        analysisResultState: null,
        displayName: null,
        reason: observation.reason,
      };
    })
    .sort((left, right) => compareStrings(left.namespace, right.namespace));

  const topologySnapshot: SystemTopologyArtifactSnapshot =
    input.topology.state === 'available' && topology !== null
      ? {
          state: 'available',
          schemaVersion: topology.schemaVersion,
          manifestFingerprint: hashContent(canonicalStringify(topology)),
          reason: null,
        }
      : input.topology.state === 'not_present'
        ? {
            state: 'not_present',
            schemaVersion: null,
            manifestFingerprint: null,
            reason: null,
          }
        : {
            state: input.topology.state === 'available' ? 'incompatible' : input.topology.state,
            schemaVersion: null,
            manifestFingerprint: null,
            reason:
              input.topology.state === 'available' ? 'artifact_invalid' : input.topology.reason,
          };

  const unknownServices = serviceSnapshots.filter(
    ({ state }) => state === 'missing' || state === 'incompatible',
  ).length;
  const endpointAvailability =
    unknownServices === 0
      ? 'available'
      : unknownServices === serviceSnapshots.length
        ? 'unavailable'
        : 'partial';
  const topologyAvailability =
    topologySnapshot.state === 'missing' || topologySnapshot.state === 'incompatible'
      ? 'unavailable'
      : 'available';
  const correlationAvailability =
    endpointAvailability === 'available' && topologyAvailability === 'available'
      ? 'available'
      : 'unavailable';

  return {
    input,
    document,
    topology,
    observations,
    snapshot: {
      label: input.label,
      systemAnalysisId: document?.systemId ?? null,
      systemAnalysisSchemaVersion: document?.schemaVersion ?? null,
      services: serviceSnapshots,
      topology: topologySnapshot,
      facts: {
        interactionEndpoints: endpointAvailability,
        brokerRealms: topologyAvailability,
        bindings: topologyAvailability,
        correlations: correlationAvailability,
      },
    },
  };
}

function addUncertainty(
  target: SystemImpactUncertainty[],
  code: SystemImpactUncertaintyCode,
  side: SystemImpactSide,
  subjectKey: string,
  message: string,
): void {
  target.push({
    id: makeSystemImpactUncertaintyId({ code, side, subjectKey }),
    code,
    side,
    subjectKey,
    message,
  });
}

function mapUnique<T extends Keyed>(
  records: readonly T[],
  collection: string,
  side: Exclude<SystemImpactSide, 'both'>,
  uncertainties: SystemImpactUncertainty[],
): { readonly records: Map<string, T>; readonly ambiguousKeys: ReadonlySet<string> } {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const values = groups.get(record.key) ?? [];
    values.push(record);
    groups.set(record.key, values);
  }
  const unique = new Map<string, T>();
  const ambiguousKeys = new Set<string>();
  for (const [key, values] of groups) {
    const first = values[0];
    if (values.length === 1 && first !== undefined) {
      unique.set(key, first);
    } else {
      ambiguousKeys.add(key);
      addUncertainty(
        uncertainties,
        'SEMANTIC_IDENTITY_AMBIGUOUS',
        side,
        `${collection}:${key}`,
        `More than one ${collection} record shares this semantic identity; no record was selected.`,
      );
    }
  }
  return { records: unique, ambiguousKeys };
}

function pairedUnique<T extends Keyed>(
  before: readonly T[],
  after: readonly T[],
  collection: string,
  uncertainties: SystemImpactUncertainty[],
): { readonly before: ReadonlyMap<string, T>; readonly after: ReadonlyMap<string, T> } {
  const left = mapUnique(before, collection, 'before', uncertainties);
  const right = mapUnique(after, collection, 'after', uncertainties);
  for (const key of new Set([...left.ambiguousKeys, ...right.ambiguousKeys])) {
    left.records.delete(key);
    right.records.delete(key);
  }
  return { before: left.records, after: right.records };
}

function compareMaps<T, C>(
  before: ReadonlyMap<string, T>,
  after: ReadonlyMap<string, T>,
  reasons: (before: T | null, after: T | null) => readonly string[],
  build: (
    key: string,
    changeKind: SystemImpactChangeKind,
    before: T | null,
    after: T | null,
    reasons: readonly string[],
  ) => C,
): C[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort(compareStrings);
  const changes: C[] = [];
  for (const key of keys) {
    const left = before.get(key) ?? null;
    const right = after.get(key) ?? null;
    const why = reasons(left, right);
    if (why.length === 0) continue;
    changes.push(
      build(
        key,
        left === null ? 'added' : right === null ? 'removed' : 'modified',
        left,
        right,
        why,
      ),
    );
  }
  return changes;
}

function changed(reason: string, left: unknown, right: unknown, output: string[]): void {
  if (canonicalStringify(left) !== canonicalStringify(right)) output.push(reason);
}

function projectEndpoints(side: PreparedSide): SystemEndpointImpactSnapshot[] {
  if (side.document === null) return [];
  const services = new Map(side.document.services.map((record) => [record.id, record.namespace]));
  const realms = new Map(
    side.document.brokerRealms.map((record) => [record.id, systemBrokerRealmImpactKey(record)]),
  );
  return side.document.interactionEndpoints.flatMap((record): SystemEndpointImpactSnapshot[] => {
    const namespace = services.get(record.serviceId);
    const observation = namespace === undefined ? undefined : side.observations.get(namespace);
    if (namespace === undefined || observation?.state !== 'available') return [];
    return [
      {
        key: systemEndpointImpactKey({
          serviceNamespace: namespace,
          role: record.role,
          analysisRecordId: record.analysisRecord.analysisRecordId,
        }),
        endpointId: record.id,
        serviceNamespace: namespace,
        role: record.role,
        kind: record.kind,
        analysisRecordId: record.analysisRecord.analysisRecordId,
        namespacedRecordId: record.analysisRecord.namespacedId,
        contract: record.contract,
        contractKey: record.contractKey,
        sourceTransport: record.sourceTransport,
        brokerRealmKey:
          record.brokerRealmId === null ? null : (realms.get(record.brokerRealmId) ?? null),
      },
    ];
  });
}

function projectRealms(side: PreparedSide): SystemBrokerRealmImpactSnapshot[] {
  if (side.topology === null) return [];
  return side.topology.brokerRealms.map((record) => ({
    key: systemBrokerRealmImpactKey(record),
    realmId: makeBrokerRealmId(record),
    brokerAlias: record.brokerAlias,
    environmentAlias: record.environmentAlias,
    technology: record.technology,
    transport: record.transport,
    destination: record.destination,
    prefix: record.prefix,
    namespace: record.namespace,
  }));
}

function projectBindings(side: PreparedSide): SystemTopologyBindingImpactSnapshot[] {
  if (side.topology === null) return [];
  return side.topology.bindings.map((record) => {
    const contractKey = systemInteractionContractKey(record.contract);
    return {
      key: systemTopologyBindingImpactKey({
        serviceNamespace: record.serviceNamespace,
        role: record.role,
        analysisRecordId: record.analysisRecordId,
        contractKey,
      }),
      serviceNamespace: record.serviceNamespace,
      role: record.role,
      analysisRecordId: record.analysisRecordId,
      contract: record.contract,
      contractKey,
      brokerRealmKey: systemBrokerRealmImpactKey(record),
    };
  });
}

function projectCorrelation(
  record: SystemInteractionCorrelationRecord,
  endpoints: ReadonlyMap<string, SystemEndpointImpactSnapshot>,
  realms: ReadonlyMap<string, string>,
): SystemCorrelationImpactSnapshot | null {
  const producer =
    record.producerEndpointId === null ? null : (endpoints.get(record.producerEndpointId) ?? null);
  const consumers = record.consumerEndpointIds.flatMap((id) => {
    const endpoint = endpoints.get(id);
    return endpoint === undefined ? [] : [endpoint];
  });
  if (
    (record.producerEndpointId !== null && producer === null) ||
    consumers.length !== record.consumerEndpointIds.length
  ) {
    return null;
  }
  const consumerEndpointKeys = consumers.map(({ key }) => key).sort(compareStrings);
  const producerEndpointKey = producer?.key ?? null;
  return {
    key: systemCorrelationImpactKey({
      kind: record.kind,
      producerEndpointKey,
      consumerEndpointKeys,
    }),
    correlationId: record.id,
    kind: record.kind,
    contractKey: record.contractKey,
    state: record.state,
    producerEndpointKey,
    consumerEndpointKeys,
    brokerRealmKey:
      record.brokerRealmId === null ? null : (realms.get(record.brokerRealmId) ?? null),
    unmatchedReason: record.unmatchedReason,
    ambiguityReason: record.ambiguityReason,
  };
}

function projectCorrelations(
  side: PreparedSide,
  projectedEndpoints: readonly SystemEndpointImpactSnapshot[],
): SystemCorrelationImpactSnapshot[] {
  if (side.document === null || !allServicesKnown(side) || !topologyIsKnown(side)) return [];
  const endpoints = new Map(projectedEndpoints.map((record) => [record.endpointId, record]));
  const realms = new Map(
    side.document.brokerRealms.map((record) => [record.id, systemBrokerRealmImpactKey(record)]),
  );
  return side.document.correlations.flatMap((record) => {
    const projected = projectCorrelation(record, endpoints, realms);
    return projected === null ? [] : [projected];
  });
}

function serviceReasons(
  before: SystemServiceArtifactSnapshot | null,
  after: SystemServiceArtifactSnapshot | null,
): readonly string[] {
  if (before === null) return ['service_added'];
  if (after === null) return ['service_removed'];
  const reasons: string[] = [];
  changed('analysis_identity_changed', before.analysisId, after.analysisId, reasons);
  changed(
    'analysis_schema_changed',
    before.analysisSchemaVersion,
    after.analysisSchemaVersion,
    reasons,
  );
  changed(
    'analysis_result_state_changed',
    before.analysisResultState,
    after.analysisResultState,
    reasons,
  );
  changed('display_name_changed', before.displayName, after.displayName, reasons);
  return reasons;
}

function endpointReasons(
  before: SystemEndpointImpactSnapshot | null,
  after: SystemEndpointImpactSnapshot | null,
): readonly string[] {
  if (before === null) return ['endpoint_added'];
  if (after === null) return ['endpoint_removed'];
  const reasons: string[] = [];
  changed('interaction_kind_changed', before.kind, after.kind, reasons);
  changed('contract_changed', before.contract, after.contract, reasons);
  changed('source_transport_changed', before.sourceTransport, after.sourceTransport, reasons);
  changed('broker_binding_changed', before.brokerRealmKey, after.brokerRealmKey, reasons);
  return reasons;
}

function realmReasons(
  before: SystemBrokerRealmImpactSnapshot | null,
  after: SystemBrokerRealmImpactSnapshot | null,
): readonly string[] {
  if (before === null) return ['realm_added'];
  if (after === null) return ['realm_removed'];
  const reasons: string[] = [];
  changed('technology_changed', before.technology, after.technology, reasons);
  changed('transport_changed', before.transport, after.transport, reasons);
  changed('destination_changed', before.destination, after.destination, reasons);
  changed('prefix_changed', before.prefix, after.prefix, reasons);
  changed('namespace_changed', before.namespace, after.namespace, reasons);
  return reasons;
}

function bindingReasons(
  before: SystemTopologyBindingImpactSnapshot | null,
  after: SystemTopologyBindingImpactSnapshot | null,
): readonly string[] {
  if (before === null) return ['binding_added'];
  if (after === null) return ['binding_removed'];
  const reasons: string[] = [];
  changed('contract_changed', before.contract, after.contract, reasons);
  changed('broker_realm_changed', before.brokerRealmKey, after.brokerRealmKey, reasons);
  return reasons;
}

function correlationReasons(
  before: SystemCorrelationImpactSnapshot | null,
  after: SystemCorrelationImpactSnapshot | null,
): readonly string[] {
  if (before === null) return ['correlation_added'];
  if (after === null) return ['correlation_removed'];
  const reasons: string[] = [];
  changed('contract_changed', before.contractKey, after.contractKey, reasons);
  changed('state_changed', before.state, after.state, reasons);
  changed(
    'consumer_selection_changed',
    before.consumerEndpointKeys,
    after.consumerEndpointKeys,
    reasons,
  );
  changed('broker_realm_changed', before.brokerRealmKey, after.brokerRealmKey, reasons);
  changed('unmatched_reason_changed', before.unmatchedReason, after.unmatchedReason, reasons);
  changed('ambiguity_reason_changed', before.ambiguityReason, after.ambiguityReason, reasons);
  return reasons;
}

function candidateFrom(
  correlation: SystemCorrelationImpactSnapshot | null,
): SystemConditionalCandidateImpactSnapshot | null {
  if (
    correlation === null ||
    correlation.state !== 'declared_realm_candidate' ||
    correlation.producerEndpointKey === null ||
    correlation.brokerRealmKey === null
  ) {
    return null;
  }
  return {
    key: systemConditionalCandidateImpactKey(correlation),
    correlationId: correlation.correlationId,
    producerEndpointKey: correlation.producerEndpointKey,
    consumerEndpointKeys: correlation.consumerEndpointKeys,
    brokerRealmKey: correlation.brokerRealmKey,
  };
}

function conditionalChanges(
  correlations: readonly SystemCorrelationImpactChange[],
): SystemConditionalCandidateImpactChange[] {
  return correlations.flatMap((change) => {
    const before = candidateFrom(change.before);
    const after = candidateFrom(change.after);
    if (before === null && after === null) return [];
    const reasons =
      before === null
        ? ['candidate_added']
        : after === null
          ? ['candidate_removed']
          : canonicalStringify(before) === canonicalStringify(after)
            ? []
            : ['candidate_modified'];
    if (reasons.length === 0) return [];
    return [
      {
        key: before?.key ?? after?.key ?? change.key,
        changeKind: before === null ? 'added' : after === null ? 'removed' : 'modified',
        before,
        after,
        reasons,
      },
    ];
  });
}

function count(
  changes: readonly { readonly changeKind: SystemImpactChangeKind }[],
  kind: SystemImpactChangeKind,
): number {
  return changes.filter(({ changeKind }) => changeKind === kind).length;
}

function summary(input: {
  services: readonly SystemServiceImpactChange[];
  producers: readonly SystemEndpointImpactChange[];
  consumers: readonly SystemEndpointImpactChange[];
  realms: readonly SystemBrokerRealmImpactChange[];
  bindings: readonly SystemTopologyBindingImpactChange[];
  correlations: readonly SystemCorrelationImpactChange[];
  conditional: readonly SystemConditionalCandidateImpactChange[];
  uncertainties: readonly SystemImpactUncertainty[];
}): SystemImpactSummary {
  const ambiguityTransitions = input.correlations.reduce(
    (accumulator, change) => {
      const before = change.before?.state === 'ambiguous';
      const after = change.after?.state === 'ambiguous';
      if (!before && after) accumulator.introduced += 1;
      if (before && !after) accumulator.resolved += 1;
      return accumulator;
    },
    { introduced: 0, resolved: 0 },
  );
  return {
    servicesAdded: count(input.services, 'added'),
    servicesRemoved: count(input.services, 'removed'),
    servicesModified: count(input.services, 'modified'),
    producersAdded: count(input.producers, 'added'),
    producersRemoved: count(input.producers, 'removed'),
    producersModified: count(input.producers, 'modified'),
    consumersAdded: count(input.consumers, 'added'),
    consumersRemoved: count(input.consumers, 'removed'),
    consumersModified: count(input.consumers, 'modified'),
    realmsAdded: count(input.realms, 'added'),
    realmsRemoved: count(input.realms, 'removed'),
    realmsModified: count(input.realms, 'modified'),
    bindingsAdded: count(input.bindings, 'added'),
    bindingsRemoved: count(input.bindings, 'removed'),
    bindingsModified: count(input.bindings, 'modified'),
    correlationsAdded: count(input.correlations, 'added'),
    correlationsRemoved: count(input.correlations, 'removed'),
    correlationsModified: count(input.correlations, 'modified'),
    ambiguitiesIntroduced: ambiguityTransitions.introduced,
    ambiguitiesResolved: ambiguityTransitions.resolved,
    conditionalCandidatesAdded: count(input.conditional, 'added'),
    conditionalCandidatesRemoved: count(input.conditional, 'removed'),
    conditionalCandidatesModified: count(input.conditional, 'modified'),
    uncertainties: input.uncertainties.length,
  };
}

export function compareSystemAnalyses(input: CompareSystemImpactInput): SystemImpactDocumentV1 {
  const issues: SystemImpactComparisonIssue[] = [];
  if (!validateInputName(input.systemName)) {
    issues.push({
      path: 'systemName',
      message: 'System name is not a valid canonical identifier.',
    });
  }
  const before = prepareSide(input.before, input.systemName, 'before', issues);
  const after = prepareSide(input.after, input.systemName, 'after', issues);
  if (before !== null && after !== null) {
    const beforeScope = [...before.observations.keys()].sort(compareStrings);
    const afterScope = [...after.observations.keys()].sort(compareStrings);
    if (canonicalStringify(beforeScope) !== canonicalStringify(afterScope)) {
      issues.push({
        path: 'services',
        message: 'Baseline and current sides must declare the same service namespace scope.',
      });
    }
  }
  if (issues.length > 0 || before === null || after === null) {
    throw new SystemImpactComparisonError(issues);
  }

  const uncertainties: SystemImpactUncertainty[] = [];
  for (const [sideName, prepared] of [
    ['before', before],
    ['after', after],
  ] as const) {
    for (const observation of prepared.observations.values()) {
      if (observation.state === 'missing' || observation.state === 'incompatible') {
        addUncertainty(
          uncertainties,
          observation.state === 'missing'
            ? 'SERVICE_ARTIFACT_MISSING'
            : 'SERVICE_ARTIFACT_INCOMPATIBLE',
          sideName,
          `service:${observation.namespace}`,
          observation.state === 'missing'
            ? 'The service artifact is unavailable; service facts are unknown, not absent.'
            : 'The service artifact is incompatible or invalid; service facts are unknown, not absent.',
        );
      }
    }
    if (
      prepared.input.topology.state === 'missing' ||
      prepared.input.topology.state === 'incompatible'
    ) {
      addUncertainty(
        uncertainties,
        prepared.input.topology.state === 'missing'
          ? 'TOPOLOGY_ARTIFACT_MISSING'
          : 'TOPOLOGY_ARTIFACT_INCOMPATIBLE',
        sideName,
        `topology:${input.systemName}`,
        prepared.input.topology.state === 'missing'
          ? 'The topology artifact is unavailable; realm and binding facts are unknown, not absent.'
          : 'The topology artifact is incompatible or invalid; realm and binding facts are unknown, not absent.',
      );
    }
  }

  const serviceBefore = new Map(
    before.snapshot.services
      .filter(({ state }) => state === 'available')
      .map((record) => [record.namespace, record]),
  );
  const serviceAfter = new Map(
    after.snapshot.services
      .filter(({ state }) => state === 'available')
      .map((record) => [record.namespace, record]),
  );
  for (const namespace of before.observations.keys()) {
    const left = before.observations.get(namespace);
    const right = after.observations.get(namespace);
    if (left?.state === 'not_present') serviceBefore.delete(namespace);
    if (right?.state === 'not_present') serviceAfter.delete(namespace);
    if (
      left === undefined ||
      right === undefined ||
      !isKnownState(left.state) ||
      !isKnownState(right.state)
    ) {
      serviceBefore.delete(namespace);
      serviceAfter.delete(namespace);
    }
  }
  const serviceChanges = compareMaps(
    serviceBefore,
    serviceAfter,
    serviceReasons,
    (key, changeKind, left, right, reasons): SystemServiceImpactChange => ({
      key,
      changeKind,
      before: left,
      after: right,
      reasons,
    }),
  );

  const beforeEndpoints = projectEndpoints(before).filter((record) => {
    const current = after.observations.get(record.serviceNamespace);
    return current !== undefined && isKnownState(current.state);
  });
  const afterEndpoints = projectEndpoints(after).filter((record) => {
    const baseline = before.observations.get(record.serviceNamespace);
    return baseline !== undefined && isKnownState(baseline.state);
  });
  const endpointMaps = pairedUnique(
    beforeEndpoints,
    afterEndpoints,
    'interaction endpoint',
    uncertainties,
  );
  const endpointChanges = compareMaps(
    endpointMaps.before,
    endpointMaps.after,
    endpointReasons,
    (key, changeKind, left, right, reasons): SystemEndpointImpactChange => ({
      key,
      changeKind,
      before: left,
      after: right,
      reasons,
    }),
  );
  const producerChanges = endpointChanges.filter(
    (change) => (change.before ?? change.after)?.role === 'producer',
  );
  const consumerChanges = endpointChanges.filter(
    (change) => (change.before ?? change.after)?.role === 'consumer',
  );

  const topologyComparable = topologyIsKnown(before) && topologyIsKnown(after);
  const realmMaps = topologyComparable
    ? pairedUnique(projectRealms(before), projectRealms(after), 'broker realm', uncertainties)
    : null;
  const realmChanges =
    realmMaps === null
      ? []
      : compareMaps(
          realmMaps.before,
          realmMaps.after,
          realmReasons,
          (key, changeKind, left, right, reasons): SystemBrokerRealmImpactChange => ({
            key,
            changeKind,
            before: left,
            after: right,
            reasons,
          }),
        );
  const bindingMaps = topologyComparable
    ? pairedUnique(
        projectBindings(before),
        projectBindings(after),
        'topology binding',
        uncertainties,
      )
    : null;
  const bindingChanges =
    bindingMaps === null
      ? []
      : compareMaps(
          bindingMaps.before,
          bindingMaps.after,
          bindingReasons,
          (key, changeKind, left, right, reasons): SystemTopologyBindingImpactChange => ({
            key,
            changeKind,
            before: left,
            after: right,
            reasons,
          }),
        );

  const correlationsComparable =
    topologyComparable && allServicesKnown(before) && allServicesKnown(after);
  if (!correlationsComparable) {
    addUncertainty(
      uncertainties,
      'CORRELATION_FACTS_UNAVAILABLE',
      'both',
      `correlations:${input.systemName}`,
      'Correlation changes were not calculated because complete service and topology observations are required on both sides.',
    );
  }
  const correlationMaps = correlationsComparable
    ? pairedUnique(
        projectCorrelations(before, projectEndpoints(before)),
        projectCorrelations(after, projectEndpoints(after)),
        'system correlation',
        uncertainties,
      )
    : null;
  const correlationChanges =
    correlationMaps === null
      ? []
      : compareMaps(
          correlationMaps.before,
          correlationMaps.after,
          correlationReasons,
          (key, changeKind, left, right, reasons): SystemCorrelationImpactChange => ({
            key,
            changeKind,
            before: left,
            after: right,
            reasons,
          }),
        );
  const conditionalCandidateChanges = conditionalChanges(correlationChanges);

  uncertainties.sort((left, right) => compareStrings(left.id, right.id));
  const documentWithoutId: Omit<SystemImpactDocumentV1, 'impactId'> = {
    schemaVersion: SYSTEM_IMPACT_SCHEMA_VERSION,
    systemName: input.systemName,
    resultState: uncertainties.length === 0 ? 'completed' : 'completed_with_unknowns',
    before: before.snapshot,
    after: after.snapshot,
    summary: summary({
      services: serviceChanges,
      producers: producerChanges,
      consumers: consumerChanges,
      realms: realmChanges,
      bindings: bindingChanges,
      correlations: correlationChanges,
      conditional: conditionalCandidateChanges,
      uncertainties,
    }),
    serviceChanges,
    producerChanges,
    consumerChanges,
    realmChanges,
    bindingChanges,
    correlationChanges,
    conditionalCandidateChanges,
    uncertainties,
    propagation: { state: 'not_computed', reason: 'phase_p4_1_contract_only' },
  };
  return assertValidSystemImpactDocument({
    ...documentWithoutId,
    impactId: makeSystemImpactId(documentWithoutId),
  }) as SystemImpactDocumentV1;
}
