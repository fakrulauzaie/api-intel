import { canonicalStringify } from '../model/ordering.js';
import { createStableId } from '../model/ids.js';
import {
  makeBrokerRealmId,
  makeNamespacedAnalysisRecordId,
  makeSystemEndpointId,
  makeSystemServiceId,
  systemInteractionContractKey,
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
import type {
  SystemCorrelationImpactChange,
  SystemImpactChangeKind,
  SystemImpactDocument,
  SystemImpactInputSnapshot,
  SystemImpactSummary,
  SystemServiceArtifactSnapshot,
  SystemEndpointImpactSnapshot,
  SystemBrokerRealmImpactSnapshot,
  SystemTopologyBindingImpactSnapshot,
  SystemCorrelationImpactSnapshot,
  SystemConditionalCandidateImpactSnapshot,
} from './model.js';
import { systemImpactDocumentSchema } from './schemas.js';

export const SYSTEM_IMPACT_INTEGRITY_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'DUPLICATE_IDENTITY',
  'IDENTITY_MISMATCH',
  'COMPARISON_INVALID',
  'AVAILABILITY_INVALID',
  'SUMMARY_MISMATCH',
  'PROPAGATION_INVALID',
] as const;
export type SystemImpactIntegrityIssueCode = (typeof SYSTEM_IMPACT_INTEGRITY_ISSUE_CODES)[number];

export interface SystemImpactIntegrityIssue {
  readonly code: SystemImpactIntegrityIssueCode;
  readonly path?: string;
  readonly message: string;
}

export type SystemImpactValidationResult =
  | { readonly success: true; readonly data: SystemImpactDocument }
  | { readonly success: false; readonly issues: readonly SystemImpactIntegrityIssue[] };

export class SystemImpactDocumentError extends Error {
  readonly issues: readonly SystemImpactIntegrityIssue[];

  constructor(issues: readonly SystemImpactIntegrityIssue[]) {
    super(
      `System impact document is invalid with ${issues.length} issue(s): ${issues
        .map((issue) => `${issue.path ?? '<document>'}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'SystemImpactDocumentError';
    this.issues = issues;
  }
}

function mismatch(
  issues: SystemImpactIntegrityIssue[],
  path: string,
  actual: string,
  expected: string,
): void {
  if (actual !== expected) {
    issues.push({
      code: 'IDENTITY_MISMATCH',
      path,
      message: `Expected ${expected}, received ${actual}.`,
    });
  }
}

function addDuplicateIssues(
  document: SystemImpactDocument,
  issues: SystemImpactIntegrityIssue[],
): void {
  for (const [path, records] of [
    ['before.services', document.before.services],
    ['after.services', document.after.services],
    ['serviceChanges', document.serviceChanges],
    ['producerChanges', document.producerChanges],
    ['consumerChanges', document.consumerChanges],
    ['realmChanges', document.realmChanges],
    ['bindingChanges', document.bindingChanges],
    ['correlationChanges', document.correlationChanges],
    ['conditionalCandidateChanges', document.conditionalCandidateChanges],
  ] as const) {
    const seen = new Set<string>();
    for (const [index, record] of records.entries()) {
      const key = 'namespace' in record ? record.namespace : record.key;
      if (seen.has(key)) {
        issues.push({
          code: 'DUPLICATE_IDENTITY',
          path: `${path}.${index}`,
          message: `Semantic identity ${key} is repeated.`,
        });
      }
      seen.add(key);
    }
  }
  const ids = new Set<string>();
  for (const [index, uncertainty] of document.uncertainties.entries()) {
    if (ids.has(uncertainty.id)) {
      issues.push({
        code: 'DUPLICATE_IDENTITY',
        path: `uncertainties.${index}.id`,
        message: `Uncertainty ${uncertainty.id} is repeated.`,
      });
    }
    ids.add(uncertainty.id);
  }
}

function addInputAvailabilityIssues(
  snapshot: SystemImpactInputSnapshot,
  path: string,
  issues: SystemImpactIntegrityIssue[],
): void {
  const unavailable = snapshot.services.filter(
    ({ state }) => state === 'missing' || state === 'incompatible',
  ).length;
  for (const [index, service] of snapshot.services.entries()) {
    if (
      (service.state === 'missing' && service.reason !== 'artifact_missing') ||
      (service.state === 'incompatible' && service.reason === 'artifact_missing')
    ) {
      issues.push({
        code: 'AVAILABILITY_INVALID',
        path: `${path}.services.${index}.reason`,
        message: 'Artifact state and unavailable reason are contradictory.',
      });
    }
  }
  if (
    (snapshot.topology.state === 'missing' && snapshot.topology.reason !== 'artifact_missing') ||
    (snapshot.topology.state === 'incompatible' && snapshot.topology.reason === 'artifact_missing')
  ) {
    issues.push({
      code: 'AVAILABILITY_INVALID',
      path: `${path}.topology.reason`,
      message: 'Topology state and unavailable reason are contradictory.',
    });
  }
  const expectedEndpoints =
    unavailable === 0
      ? 'available'
      : unavailable === snapshot.services.length
        ? 'unavailable'
        : 'partial';
  const expectedTopology =
    snapshot.topology.state === 'missing' || snapshot.topology.state === 'incompatible'
      ? 'unavailable'
      : 'available';
  const expectedCorrelations =
    expectedEndpoints === 'available' && expectedTopology === 'available'
      ? 'available'
      : 'unavailable';
  for (const [field, actual, expected] of [
    ['interactionEndpoints', snapshot.facts.interactionEndpoints, expectedEndpoints],
    ['brokerRealms', snapshot.facts.brokerRealms, expectedTopology],
    ['bindings', snapshot.facts.bindings, expectedTopology],
    ['correlations', snapshot.facts.correlations, expectedCorrelations],
  ] as const) {
    if (actual !== expected) {
      issues.push({
        code: 'AVAILABILITY_INVALID',
        path: `${path}.facts.${field}`,
        message: `Expected ${expected}, received ${actual}.`,
      });
    }
  }

  const available = snapshot.services.filter(({ state }) => state === 'available').length;
  const hasDocument =
    snapshot.systemAnalysisId !== null && snapshot.systemAnalysisSchemaVersion !== null;
  if (available > 0 !== hasDocument) {
    issues.push({
      code: 'AVAILABILITY_INVALID',
      path: `${path}.systemAnalysisId`,
      message:
        'System document provenance must exist exactly when at least one service is available.',
    });
  }
}

function expectedChangeKind(
  before: unknown | null,
  after: unknown | null,
): SystemImpactChangeKind | null {
  if (before === null && after !== null) return 'added';
  if (before !== null && after === null) return 'removed';
  if (before !== null && after !== null) return 'modified';
  return null;
}

function addReason(reason: string, left: unknown, right: unknown, output: string[]): void {
  if (canonicalStringify(left) !== canonicalStringify(right)) output.push(reason);
}

function reasonsForService(
  before: SystemServiceArtifactSnapshot | null,
  after: SystemServiceArtifactSnapshot | null,
): readonly string[] {
  if (before === null) return ['service_added'];
  if (after === null) return ['service_removed'];
  const reasons: string[] = [];
  addReason('analysis_identity_changed', before.analysisId, after.analysisId, reasons);
  addReason(
    'analysis_schema_changed',
    before.analysisSchemaVersion,
    after.analysisSchemaVersion,
    reasons,
  );
  addReason(
    'analysis_result_state_changed',
    before.analysisResultState,
    after.analysisResultState,
    reasons,
  );
  addReason('display_name_changed', before.displayName, after.displayName, reasons);
  return reasons;
}

function reasonsForEndpoint(
  before: SystemEndpointImpactSnapshot | null,
  after: SystemEndpointImpactSnapshot | null,
): readonly string[] {
  if (before === null) return ['endpoint_added'];
  if (after === null) return ['endpoint_removed'];
  const reasons: string[] = [];
  addReason('interaction_kind_changed', before.kind, after.kind, reasons);
  addReason('contract_changed', before.contract, after.contract, reasons);
  addReason('source_transport_changed', before.sourceTransport, after.sourceTransport, reasons);
  addReason('broker_binding_changed', before.brokerRealmKey, after.brokerRealmKey, reasons);
  return reasons;
}

function reasonsForRealm(
  before: SystemBrokerRealmImpactSnapshot | null,
  after: SystemBrokerRealmImpactSnapshot | null,
): readonly string[] {
  if (before === null) return ['realm_added'];
  if (after === null) return ['realm_removed'];
  const reasons: string[] = [];
  addReason('technology_changed', before.technology, after.technology, reasons);
  addReason('transport_changed', before.transport, after.transport, reasons);
  addReason('destination_changed', before.destination, after.destination, reasons);
  addReason('prefix_changed', before.prefix, after.prefix, reasons);
  addReason('namespace_changed', before.namespace, after.namespace, reasons);
  return reasons;
}

function reasonsForBinding(
  before: SystemTopologyBindingImpactSnapshot | null,
  after: SystemTopologyBindingImpactSnapshot | null,
): readonly string[] {
  if (before === null) return ['binding_added'];
  if (after === null) return ['binding_removed'];
  const reasons: string[] = [];
  addReason('contract_changed', before.contract, after.contract, reasons);
  addReason('broker_realm_changed', before.brokerRealmKey, after.brokerRealmKey, reasons);
  return reasons;
}

function reasonsForCorrelation(
  before: SystemCorrelationImpactSnapshot | null,
  after: SystemCorrelationImpactSnapshot | null,
): readonly string[] {
  if (before === null) return ['correlation_added'];
  if (after === null) return ['correlation_removed'];
  const reasons: string[] = [];
  addReason('contract_changed', before.contractKey, after.contractKey, reasons);
  addReason('state_changed', before.state, after.state, reasons);
  addReason(
    'consumer_selection_changed',
    before.consumerEndpointKeys,
    after.consumerEndpointKeys,
    reasons,
  );
  addReason('broker_realm_changed', before.brokerRealmKey, after.brokerRealmKey, reasons);
  addReason('unmatched_reason_changed', before.unmatchedReason, after.unmatchedReason, reasons);
  addReason('ambiguity_reason_changed', before.ambiguityReason, after.ambiguityReason, reasons);
  return reasons;
}

function reasonsForConditional(
  before: SystemConditionalCandidateImpactSnapshot | null,
  after: SystemConditionalCandidateImpactSnapshot | null,
): readonly string[] {
  if (before === null) return ['candidate_added'];
  if (after === null) return ['candidate_removed'];
  return canonicalStringify(before) === canonicalStringify(after) ? [] : ['candidate_modified'];
}

function expectedReasons(
  path: string,
  before: unknown | null,
  after: unknown | null,
): readonly string[] {
  if (path === 'serviceChanges') {
    return reasonsForService(
      before as SystemServiceArtifactSnapshot | null,
      after as SystemServiceArtifactSnapshot | null,
    );
  }
  if (path === 'producerChanges' || path === 'consumerChanges') {
    return reasonsForEndpoint(
      before as SystemEndpointImpactSnapshot | null,
      after as SystemEndpointImpactSnapshot | null,
    );
  }
  if (path === 'realmChanges') {
    return reasonsForRealm(
      before as SystemBrokerRealmImpactSnapshot | null,
      after as SystemBrokerRealmImpactSnapshot | null,
    );
  }
  if (path === 'bindingChanges') {
    return reasonsForBinding(
      before as SystemTopologyBindingImpactSnapshot | null,
      after as SystemTopologyBindingImpactSnapshot | null,
    );
  }
  if (path === 'correlationChanges') {
    return reasonsForCorrelation(
      before as SystemCorrelationImpactSnapshot | null,
      after as SystemCorrelationImpactSnapshot | null,
    );
  }
  return reasonsForConditional(
    before as SystemConditionalCandidateImpactSnapshot | null,
    after as SystemConditionalCandidateImpactSnapshot | null,
  );
}

function addChangeShapeIssues(
  document: SystemImpactDocument,
  issues: SystemImpactIntegrityIssue[],
): void {
  for (const [path, changes] of [
    ['serviceChanges', document.serviceChanges],
    ['producerChanges', document.producerChanges],
    ['consumerChanges', document.consumerChanges],
    ['realmChanges', document.realmChanges],
    ['bindingChanges', document.bindingChanges],
    ['correlationChanges', document.correlationChanges],
    ['conditionalCandidateChanges', document.conditionalCandidateChanges],
  ] as const) {
    for (const [index, change] of changes.entries()) {
      const expected = expectedChangeKind(change.before, change.after);
      if (expected === null || expected !== change.changeKind) {
        issues.push({
          code: 'COMPARISON_INVALID',
          path: `${path}.${index}.changeKind`,
          message:
            'Added, removed, and modified records require the corresponding before/after shape.',
        });
      }
      const selected = change.before ?? change.after;
      if (selected !== null) {
        const expectedKey =
          path === 'serviceChanges'
            ? (selected as { readonly namespace: string }).namespace
            : (selected as { readonly key: string }).key;
        if (change.key !== expectedKey) {
          issues.push({
            code: 'IDENTITY_MISMATCH',
            path: `${path}.${index}.key`,
            message: `Expected change key ${expectedKey}, received ${change.key}.`,
          });
        }
      }
      if (
        change.before !== null &&
        change.after !== null &&
        canonicalStringify(change.before) === canonicalStringify(change.after)
      ) {
        issues.push({
          code: 'COMPARISON_INVALID',
          path: `${path}.${index}`,
          message: 'A modified record must contain a semantic difference.',
        });
      }
      if (new Set(change.reasons).size !== change.reasons.length) {
        issues.push({
          code: 'DUPLICATE_IDENTITY',
          path: `${path}.${index}.reasons`,
          message: 'Change reasons must be unique.',
        });
      }
      const expectedReasonsForChange = expectedReasons(path, change.before, change.after);
      if (
        canonicalStringify([...change.reasons].sort()) !==
        canonicalStringify([...expectedReasonsForChange].sort())
      ) {
        issues.push({
          code: 'COMPARISON_INVALID',
          path: `${path}.${index}.reasons`,
          message: 'Change reasons do not match the retained before/after semantic difference.',
        });
      }
      if (
        path === 'serviceChanges' &&
        [change.before, change.after].some(
          (snapshot) =>
            snapshot !== null && (snapshot as SystemServiceArtifactSnapshot).state !== 'available',
        )
      ) {
        issues.push({
          code: 'COMPARISON_INVALID',
          path: `${path}.${index}`,
          message: 'Service changes may contain only available artifact snapshots.',
        });
      }
    }
  }

  for (const [index, change] of document.producerChanges.entries()) {
    if ((change.before ?? change.after)?.role !== 'producer') {
      issues.push({
        code: 'COMPARISON_INVALID',
        path: `producerChanges.${index}`,
        message: 'Producer changes must contain producer endpoint snapshots.',
      });
    }
  }
  for (const [index, change] of document.consumerChanges.entries()) {
    if ((change.before ?? change.after)?.role !== 'consumer') {
      issues.push({
        code: 'COMPARISON_INVALID',
        path: `consumerChanges.${index}`,
        message: 'Consumer changes must contain consumer endpoint snapshots.',
      });
    }
  }
}

function addSnapshotIdentityIssues(
  document: SystemImpactDocument,
  issues: SystemImpactIntegrityIssue[],
): void {
  for (const [path, snapshot] of [
    ['before', document.before],
    ['after', document.after],
  ] as const) {
    for (const [index, service] of snapshot.services.entries()) {
      if (service.state === 'available') {
        mismatch(
          issues,
          `${path}.services.${index}.serviceId`,
          service.serviceId,
          makeSystemServiceId(service.namespace),
        );
      }
    }
  }

  const endpointSnapshots = [...document.producerChanges, ...document.consumerChanges].flatMap(
    ({ before, after }) => [before, after].filter((value) => value !== null),
  );
  for (const [index, snapshot] of endpointSnapshots.entries()) {
    if (snapshot === null) continue;
    mismatch(
      issues,
      `endpointSnapshots.${index}.key`,
      snapshot.key,
      systemEndpointImpactKey(snapshot),
    );
    mismatch(
      issues,
      `endpointSnapshots.${index}.namespacedRecordId`,
      snapshot.namespacedRecordId,
      makeNamespacedAnalysisRecordId({
        serviceNamespace: snapshot.serviceNamespace,
        analysisRecordId: snapshot.analysisRecordId,
      }),
    );
    mismatch(
      issues,
      `endpointSnapshots.${index}.endpointId`,
      snapshot.endpointId,
      makeSystemEndpointId({
        namespacedRecordId: snapshot.namespacedRecordId,
        role: snapshot.role,
      }),
    );
    mismatch(
      issues,
      `endpointSnapshots.${index}.contractKey`,
      snapshot.contractKey,
      systemInteractionContractKey(snapshot.contract),
    );
    if (snapshot.contract.targetKind !== snapshot.kind) {
      issues.push({
        code: 'COMPARISON_INVALID',
        path: `endpointSnapshots.${index}.contract`,
        message: 'Endpoint interaction kind and contract target kind must match.',
      });
    }
  }

  const realmSnapshots = document.realmChanges.flatMap(({ before, after }) =>
    [before, after].filter((value) => value !== null),
  );
  for (const [index, snapshot] of realmSnapshots.entries()) {
    if (snapshot === null) continue;
    mismatch(
      issues,
      `realmSnapshots.${index}.key`,
      snapshot.key,
      systemBrokerRealmImpactKey(snapshot),
    );
    mismatch(
      issues,
      `realmSnapshots.${index}.realmId`,
      snapshot.realmId,
      makeBrokerRealmId(snapshot),
    );
  }

  const bindingSnapshots = document.bindingChanges.flatMap(({ before, after }) =>
    [before, after].filter((value) => value !== null),
  );
  for (const [index, snapshot] of bindingSnapshots.entries()) {
    if (snapshot === null) continue;
    mismatch(
      issues,
      `bindingSnapshots.${index}.key`,
      snapshot.key,
      systemTopologyBindingImpactKey(snapshot),
    );
    mismatch(
      issues,
      `bindingSnapshots.${index}.contractKey`,
      snapshot.contractKey,
      systemInteractionContractKey(snapshot.contract),
    );
  }

  const correlationSnapshots = document.correlationChanges.flatMap(({ before, after }) =>
    [before, after].filter((value) => value !== null),
  );
  for (const [index, snapshot] of correlationSnapshots.entries()) {
    if (snapshot === null) continue;
    mismatch(
      issues,
      `correlationSnapshots.${index}.key`,
      snapshot.key,
      systemCorrelationImpactKey(snapshot),
    );
    const shapeValid =
      (snapshot.state === 'declared_realm_candidate' &&
        snapshot.producerEndpointKey !== null &&
        snapshot.consumerEndpointKeys.length > 0 &&
        snapshot.brokerRealmKey !== null &&
        snapshot.unmatchedReason === null &&
        snapshot.ambiguityReason === null) ||
      (snapshot.state === 'target_only_candidate' &&
        snapshot.producerEndpointKey !== null &&
        snapshot.consumerEndpointKeys.length > 0 &&
        snapshot.brokerRealmKey === null &&
        snapshot.unmatchedReason === null &&
        snapshot.ambiguityReason === null) ||
      (snapshot.state === 'ambiguous' &&
        snapshot.producerEndpointKey !== null &&
        snapshot.consumerEndpointKeys.length > 1 &&
        snapshot.unmatchedReason === null &&
        snapshot.ambiguityReason !== null) ||
      (snapshot.state === 'unmatched' &&
        snapshot.unmatchedReason !== null &&
        snapshot.ambiguityReason === null);
    if (!shapeValid) {
      issues.push({
        code: 'COMPARISON_INVALID',
        path: `correlationSnapshots.${index}`,
        message: 'Correlation state and producer/consumer/realm/reason shape are inconsistent.',
      });
    }
  }

  const candidateSnapshots = document.conditionalCandidateChanges.flatMap(({ before, after }) =>
    [before, after].filter((value) => value !== null),
  );
  for (const [index, snapshot] of candidateSnapshots.entries()) {
    if (snapshot === null) continue;
    const correlation = document.correlationChanges
      .flatMap(({ before, after }) => [before, after])
      .find((value) => value?.correlationId === snapshot.correlationId);
    if (correlation !== undefined && correlation !== null) {
      mismatch(
        issues,
        `conditionalCandidateSnapshots.${index}.key`,
        snapshot.key,
        systemConditionalCandidateImpactKey(correlation),
      );
      if (
        correlation.state !== 'declared_realm_candidate' ||
        correlation.producerEndpointKey !== snapshot.producerEndpointKey ||
        correlation.brokerRealmKey !== snapshot.brokerRealmKey ||
        canonicalStringify(correlation.consumerEndpointKeys) !==
          canonicalStringify(snapshot.consumerEndpointKeys)
      ) {
        issues.push({
          code: 'COMPARISON_INVALID',
          path: `conditionalCandidateSnapshots.${index}`,
          message: 'A conditional candidate must exactly project a declared-realm correlation.',
        });
      }
    } else {
      issues.push({
        code: 'COMPARISON_INVALID',
        path: `conditionalCandidateSnapshots.${index}.correlationId`,
        message: 'A conditional candidate must reference a retained correlation change snapshot.',
      });
    }
  }

  for (const [index, uncertainty] of document.uncertainties.entries()) {
    mismatch(
      issues,
      `uncertainties.${index}.id`,
      uncertainty.id,
      makeSystemImpactUncertaintyId(uncertainty),
    );
  }
}

function count(
  changes: readonly { readonly changeKind: SystemImpactChangeKind }[],
  kind: SystemImpactChangeKind,
): number {
  return changes.filter(({ changeKind }) => changeKind === kind).length;
}

function expectedSummary(document: SystemImpactDocument): SystemImpactSummary {
  const ambiguity = document.correlationChanges.reduce(
    (value, change: SystemCorrelationImpactChange) => {
      const before = change.before?.state === 'ambiguous';
      const after = change.after?.state === 'ambiguous';
      if (!before && after) value.introduced += 1;
      if (before && !after) value.resolved += 1;
      return value;
    },
    { introduced: 0, resolved: 0 },
  );
  return {
    servicesAdded: count(document.serviceChanges, 'added'),
    servicesRemoved: count(document.serviceChanges, 'removed'),
    servicesModified: count(document.serviceChanges, 'modified'),
    producersAdded: count(document.producerChanges, 'added'),
    producersRemoved: count(document.producerChanges, 'removed'),
    producersModified: count(document.producerChanges, 'modified'),
    consumersAdded: count(document.consumerChanges, 'added'),
    consumersRemoved: count(document.consumerChanges, 'removed'),
    consumersModified: count(document.consumerChanges, 'modified'),
    realmsAdded: count(document.realmChanges, 'added'),
    realmsRemoved: count(document.realmChanges, 'removed'),
    realmsModified: count(document.realmChanges, 'modified'),
    bindingsAdded: count(document.bindingChanges, 'added'),
    bindingsRemoved: count(document.bindingChanges, 'removed'),
    bindingsModified: count(document.bindingChanges, 'modified'),
    correlationsAdded: count(document.correlationChanges, 'added'),
    correlationsRemoved: count(document.correlationChanges, 'removed'),
    correlationsModified: count(document.correlationChanges, 'modified'),
    ambiguitiesIntroduced: ambiguity.introduced,
    ambiguitiesResolved: ambiguity.resolved,
    conditionalCandidatesAdded: count(document.conditionalCandidateChanges, 'added'),
    conditionalCandidatesRemoved: count(document.conditionalCandidateChanges, 'removed'),
    conditionalCandidatesModified: count(document.conditionalCandidateChanges, 'modified'),
    uncertainties: document.uncertainties.length,
  };
}

function stateFor(snapshot: SystemImpactInputSnapshot, namespace: string): string | undefined {
  return snapshot.services.find((record) => record.namespace === namespace)?.state;
}

function addAvailabilityBoundaryIssues(
  document: SystemImpactDocument,
  issues: SystemImpactIntegrityIssue[],
): void {
  for (const [path, changes] of [
    ['producerChanges', document.producerChanges],
    ['consumerChanges', document.consumerChanges],
  ] as const) {
    for (const [index, change] of changes.entries()) {
      const beforeNamespace = change.before?.serviceNamespace;
      const afterNamespace = change.after?.serviceNamespace;
      const beforeValid =
        beforeNamespace === undefined || stateFor(document.before, beforeNamespace) === 'available';
      const afterValid =
        afterNamespace === undefined || stateFor(document.after, afterNamespace) === 'available';
      if (!beforeValid || !afterValid) {
        issues.push({
          code: 'AVAILABILITY_INVALID',
          path: `${path}.${index}`,
          message: 'Each endpoint snapshot requires an available service artifact on that side.',
        });
      }
    }
  }

  for (const [index, change] of document.serviceChanges.entries()) {
    for (const [side, snapshot, inputSnapshot] of [
      ['before', change.before, document.before],
      ['after', change.after, document.after],
    ] as const) {
      if (snapshot === null) continue;
      const source = inputSnapshot.services.find(
        ({ namespace }) => namespace === snapshot.namespace,
      );
      if (source === undefined || canonicalStringify(source) !== canonicalStringify(snapshot)) {
        issues.push({
          code: 'AVAILABILITY_INVALID',
          path: `serviceChanges.${index}.${side}`,
          message: 'Service change snapshots must be copied from the corresponding input coverage.',
        });
      }
    }
  }

  const topologyKnown = [document.before, document.after].every(
    ({ topology }) => topology.state === 'available' || topology.state === 'not_present',
  );
  if (!topologyKnown && (document.realmChanges.length > 0 || document.bindingChanges.length > 0)) {
    issues.push({
      code: 'AVAILABILITY_INVALID',
      path: 'topology',
      message: 'Realm and binding changes require known topology observations on both sides.',
    });
  }
  for (const [path, changes] of [
    ['realmChanges', document.realmChanges],
    ['bindingChanges', document.bindingChanges],
  ] as const) {
    for (const [index, change] of changes.entries()) {
      if (change.before !== null && document.before.topology.state !== 'available') {
        issues.push({
          code: 'AVAILABILITY_INVALID',
          path: `${path}.${index}.before`,
          message: 'A baseline topology snapshot requires an available baseline manifest.',
        });
      }
      if (change.after !== null && document.after.topology.state !== 'available') {
        issues.push({
          code: 'AVAILABILITY_INVALID',
          path: `${path}.${index}.after`,
          message: 'A current topology snapshot requires an available current manifest.',
        });
      }
    }
  }
  const correlationsKnown =
    document.before.facts.correlations === 'available' &&
    document.after.facts.correlations === 'available';
  if (
    !correlationsKnown &&
    (document.correlationChanges.length > 0 || document.conditionalCandidateChanges.length > 0)
  ) {
    issues.push({
      code: 'AVAILABILITY_INVALID',
      path: 'correlationChanges',
      message:
        'Correlation changes require complete service and topology observations on both sides.',
    });
  }
  if (correlationsKnown) {
    for (const [index, change] of document.correlationChanges.entries()) {
      if (change.before !== null && document.before.systemAnalysisId === null) {
        issues.push({
          code: 'AVAILABILITY_INVALID',
          path: `correlationChanges.${index}.before`,
          message: 'A baseline correlation snapshot requires a baseline system document.',
        });
      }
      if (change.after !== null && document.after.systemAnalysisId === null) {
        issues.push({
          code: 'AVAILABILITY_INVALID',
          path: `correlationChanges.${index}.after`,
          message: 'A current correlation snapshot requires a current system document.',
        });
      }
    }
  }

  for (const [path, snapshot] of [
    ['before', document.before],
    ['after', document.after],
  ] as const) {
    for (const [index, service] of snapshot.services.entries()) {
      if (service.state !== 'missing' && service.state !== 'incompatible') continue;
      const expectedCode =
        service.state === 'missing' ? 'SERVICE_ARTIFACT_MISSING' : 'SERVICE_ARTIFACT_INCOMPATIBLE';
      const found = document.uncertainties.some(
        ({ code, side, subjectKey }) =>
          code === expectedCode && side === path && subjectKey === `service:${service.namespace}`,
      );
      if (!found) {
        issues.push({
          code: 'AVAILABILITY_INVALID',
          path: `${path}.services.${index}`,
          message: 'Unavailable service coverage requires its typed uncertainty record.',
        });
      }
    }
    if (snapshot.topology.state === 'missing' || snapshot.topology.state === 'incompatible') {
      const expectedCode =
        snapshot.topology.state === 'missing'
          ? 'TOPOLOGY_ARTIFACT_MISSING'
          : 'TOPOLOGY_ARTIFACT_INCOMPATIBLE';
      const found = document.uncertainties.some(
        ({ code, side, subjectKey }) =>
          code === expectedCode &&
          side === path &&
          subjectKey === `topology:${document.systemName}`,
      );
      if (!found) {
        issues.push({
          code: 'AVAILABILITY_INVALID',
          path: `${path}.topology`,
          message: 'Unavailable topology coverage requires its typed uncertainty record.',
        });
      }
    }
  }
  if (!correlationsKnown) {
    const found = document.uncertainties.some(
      ({ code, side, subjectKey }) =>
        code === 'CORRELATION_FACTS_UNAVAILABLE' &&
        side === 'both' &&
        subjectKey === `correlations:${document.systemName}`,
    );
    if (!found) {
      issues.push({
        code: 'AVAILABILITY_INVALID',
        path: 'uncertainties',
        message: 'Unavailable correlation facts require an explicit comparison uncertainty.',
      });
    }
  }
}

function addPropagationIssues(
  document: SystemImpactDocument,
  issues: SystemImpactIntegrityIssue[],
): void {
  if (document.propagation.state !== 'computed') return;
  const propagation = document.propagation;
  if (propagation.paths.length > propagation.limits.maxPaths) {
    issues.push({
      code: 'PROPAGATION_INVALID',
      path: 'propagation.paths',
      message: 'Retained path count exceeds the published propagation limit.',
    });
  }
  const artifactKeys = new Set<string>();
  for (const [index, artifact] of propagation.sourceArtifacts.entries()) {
    const key = `${artifact.side}:${artifact.serviceNamespace}`;
    if (artifactKeys.has(key)) {
      issues.push({
        code: 'DUPLICATE_IDENTITY',
        path: `propagation.sourceArtifacts.${index}`,
        message: `Propagation source artifact ${key} is repeated.`,
      });
    }
    artifactKeys.add(key);
    const snapshot = artifact.side === 'before' ? document.before : document.after;
    const service = snapshot.services.find(
      ({ namespace }) => namespace === artifact.serviceNamespace,
    );
    if (
      service?.state !== 'available' ||
      service.analysisId !== artifact.analysisId ||
      service.analysisSchemaVersion !== artifact.schemaVersion ||
      service.analysisResultState !== artifact.resultState
    ) {
      issues.push({
        code: 'PROPAGATION_INVALID',
        path: `propagation.sourceArtifacts.${index}`,
        message: 'Propagation source provenance does not match its P4.1 service snapshot.',
      });
    }
  }
  for (const [side, snapshot] of [
    ['before', document.before],
    ['after', document.after],
  ] as const) {
    for (const service of snapshot.services) {
      if (service.state === 'available' && !artifactKeys.has(`${side}:${service.namespace}`)) {
        issues.push({
          code: 'PROPAGATION_INVALID',
          path: 'propagation.sourceArtifacts',
          message: `Available ${side} service ${service.namespace} lacks source provenance.`,
        });
      }
    }
  }
  const seedById = new Map<string, (typeof propagation.seeds)[number]>();
  for (const [index, seed] of propagation.seeds.entries()) {
    if (seedById.has(seed.id)) {
      issues.push({
        code: 'DUPLICATE_IDENTITY',
        path: `propagation.seeds.${index}.id`,
        message: `Propagation seed ${seed.id} is repeated.`,
      });
    }
    seedById.set(seed.id, seed);
    const expectedId = createStableId('system_impact_seed', [
      seed.side,
      seed.key,
      seed.kind === 'impacted_http_endpoint'
        ? seed.localImpactFingerprint
        : seed.producerChangeKind,
    ]);
    mismatch(issues, `propagation.seeds.${index}.id`, seed.id, expectedId);
    const httpShape =
      seed.endpointId !== null &&
      seed.producerEndpointKey === null &&
      seed.localImpactFingerprint !== null &&
      seed.producerChangeKind === null &&
      seed.direct !== null;
    const producerShape =
      seed.endpointId === null &&
      seed.producerEndpointKey !== null &&
      seed.localImpactFingerprint === null &&
      seed.producerChangeKind !== null &&
      seed.direct === null;
    if (
      (seed.kind === 'impacted_http_endpoint' && !httpShape) ||
      (seed.kind === 'changed_producer' && !producerShape)
    ) {
      issues.push({
        code: 'PROPAGATION_INVALID',
        path: `propagation.seeds.${index}`,
        message: 'Propagation seed fields contradict its seed kind.',
      });
    }
  }

  const pathById = new Map<string, (typeof propagation.paths)[number]>();
  for (const [index, path] of propagation.paths.entries()) {
    if (pathById.has(path.id)) {
      issues.push({
        code: 'DUPLICATE_IDENTITY',
        path: `propagation.paths.${index}.id`,
        message: `Propagation path ${path.id} is repeated.`,
      });
    }
    pathById.set(path.id, path);
    if (
      path.hops.length > propagation.limits.maxHops ||
      path.effects.length > propagation.limits.maxEffectsPerPath
    ) {
      issues.push({
        code: 'PROPAGATION_INVALID',
        path: `propagation.paths.${index}`,
        message: 'Retained hops or effects exceed the published propagation limits.',
      });
    }
    const seed = seedById.get(path.seedId);
    if (seed === undefined || seed.side !== path.side) {
      issues.push({
        code: 'PROPAGATION_INVALID',
        path: `propagation.paths.${index}.seedId`,
        message: 'Path seed must exist and belong to the same snapshot side.',
      });
    }
    if (
      (path.truncation === 'none') !== (path.truncatedAtProducerEndpointId === null) ||
      (path.truncation !== 'none' && path.completeness !== 'incomplete')
    ) {
      issues.push({
        code: 'PROPAGATION_INVALID',
        path: `propagation.paths.${index}.truncation`,
        message: 'Truncation target and completeness must agree with truncation state.',
      });
    }
    for (const [hopIndex, hop] of path.hops.entries()) {
      if (hop.index !== hopIndex) {
        issues.push({
          code: 'PROPAGATION_INVALID',
          path: `propagation.paths.${index}.hops.${hopIndex}.index`,
          message: 'Hop indexes must be contiguous and start at zero.',
        });
      }
      if (
        hop.producerEndpointKey !==
          systemEndpointImpactKey({
            serviceNamespace: hop.producerServiceNamespace,
            role: 'producer',
            analysisRecordId: hop.producerAnalysisRecordId,
          }) ||
        hop.consumerEndpointKey !==
          systemEndpointImpactKey({
            serviceNamespace: hop.consumerServiceNamespace,
            role: 'consumer',
            analysisRecordId: hop.consumerAnalysisRecordId,
          })
      ) {
        issues.push({
          code: 'PROPAGATION_INVALID',
          path: `propagation.paths.${index}.hops.${hopIndex}`,
          message: 'Hop endpoint semantic keys do not match their source record identities.',
        });
      }
      if (
        hopIndex > 0 &&
        path.hops[hopIndex - 1]!.consumerServiceNamespace !== hop.producerServiceNamespace
      ) {
        issues.push({
          code: 'PROPAGATION_INVALID',
          path: `propagation.paths.${index}.hops.${hopIndex}`,
          message: 'A cascading producer must belong to the preceding consumer service.',
        });
      }
    }
    const lastService = path.hops.at(-1)?.consumerServiceNamespace;
    for (const [effectIndex, effect] of path.effects.entries()) {
      mismatch(
        issues,
        `propagation.paths.${index}.effects.${effectIndex}.id`,
        effect.id,
        createStableId('system_impact_effect', [effect.key]),
      );
      if (effect.serviceNamespace !== lastService) {
        issues.push({
          code: 'PROPAGATION_INVALID',
          path: `propagation.paths.${index}.effects.${effectIndex}.serviceNamespace`,
          message: 'A path effect must belong to its terminal consumer service.',
        });
      }
    }
    const expectedPathId = createStableId('system_impact_path', [
      path.side,
      path.seedId,
      ...path.hops.flatMap((hop) => [hop.correlationId, hop.consumerEndpointId]),
      ...path.effects.map(({ id }) => id).sort(),
      path.truncation,
      path.truncatedAtProducerEndpointId,
    ]);
    mismatch(issues, `propagation.paths.${index}.id`, path.id, expectedPathId);
  }

  const overlaySides = new Set<string>();
  for (const [index, overlay] of propagation.graphOverlays.entries()) {
    if (overlaySides.has(overlay.side)) {
      issues.push({
        code: 'DUPLICATE_IDENTITY',
        path: `propagation.graphOverlays.${index}.side`,
        message: `Graph overlay side ${overlay.side} is repeated.`,
      });
    }
    overlaySides.add(overlay.side);
    const snapshot = overlay.side === 'before' ? document.before : document.after;
    if (overlay.systemAnalysisId !== snapshot.systemAnalysisId) {
      issues.push({
        code: 'PROPAGATION_INVALID',
        path: `propagation.graphOverlays.${index}.systemAnalysisId`,
        message: 'Graph overlay must identify its exact system snapshot.',
      });
    }
    const nodeIds = new Set<string>();
    for (const [nodeIndex, node] of overlay.nodes.entries()) {
      if (nodeIds.has(node.nodeId)) {
        issues.push({
          code: 'DUPLICATE_IDENTITY',
          path: `propagation.graphOverlays.${index}.nodes.${nodeIndex}.nodeId`,
          message: `Overlay node ${node.nodeId} is repeated.`,
        });
      }
      nodeIds.add(node.nodeId);
      if (
        node.pathIds.some((id) => pathById.get(id)?.side !== overlay.side) ||
        node.effectIds.some(
          (effectId) =>
            !propagation.paths.some(
              (path) =>
                path.side === overlay.side && path.effects.some(({ id }) => id === effectId),
            ),
        )
      ) {
        issues.push({
          code: 'PROPAGATION_INVALID',
          path: `propagation.graphOverlays.${index}.nodes.${nodeIndex}`,
          message: 'Overlay node references a missing or opposite-side path/effect.',
        });
      }
    }
    const edgeIds = new Set<string>();
    for (const [edgeIndex, edge] of overlay.edges.entries()) {
      if (edgeIds.has(edge.edgeId)) {
        issues.push({
          code: 'DUPLICATE_IDENTITY',
          path: `propagation.graphOverlays.${index}.edges.${edgeIndex}.edgeId`,
          message: `Overlay edge ${edge.edgeId} is repeated.`,
        });
      }
      edgeIds.add(edge.edgeId);
      if (
        !nodeIds.has(edge.source) ||
        !nodeIds.has(edge.target) ||
        edge.pathIds.some((id) => pathById.get(id)?.side !== overlay.side)
      ) {
        issues.push({
          code: 'PROPAGATION_INVALID',
          path: `propagation.graphOverlays.${index}.edges.${edgeIndex}`,
          message: 'Overlay edge endpoints and paths must exist on the same side.',
        });
      }
    }
    for (const [nodeIndex, node] of overlay.nodes.entries()) {
      if (node.parentNodeId !== null && !nodeIds.has(node.parentNodeId)) {
        issues.push({
          code: 'PROPAGATION_INVALID',
          path: `propagation.graphOverlays.${index}.nodes.${nodeIndex}.parentNodeId`,
          message: 'Overlay node parent must exist in the same overlay.',
        });
      }
    }
  }

  const uniqueEffects = new Set(
    propagation.paths.flatMap((path) => path.effects.map(({ id }) => id)),
  );
  const affectedServices = new Set(
    propagation.paths.flatMap((path) => [
      ...path.hops.map(({ consumerServiceNamespace }) => consumerServiceNamespace),
      ...path.effects.map(({ serviceNamespace }) => serviceNamespace),
    ]),
  );
  const expected = {
    seeds: propagation.seeds.length,
    paths: propagation.paths.length,
    effects: uniqueEffects.size,
    affectedServices: affectedServices.size,
    cyclesTruncated: propagation.paths.filter(({ truncation }) => truncation === 'cycle').length,
    hopLimitTruncations: propagation.paths.filter(({ truncation }) => truncation === 'hop_limit')
      .length,
    stateLimitReached: propagation.summary.stateLimitReached,
    pathsOmitted: propagation.summary.pathsOmitted,
    effectsOmitted: propagation.summary.effectsOmitted,
  };
  if (canonicalStringify(expected) !== canonicalStringify(propagation.summary)) {
    issues.push({
      code: 'SUMMARY_MISMATCH',
      path: 'propagation.summary',
      message: 'Propagation summary does not match retained seeds, paths, and effects.',
    });
  }
}

export function validateSystemImpactDocument(input: unknown): SystemImpactValidationResult {
  const parsed = systemImpactDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_INVALID',
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  const document = parsed.data as SystemImpactDocument;
  const issues: SystemImpactIntegrityIssue[] = [];
  addDuplicateIssues(document, issues);
  addInputAvailabilityIssues(document.before, 'before', issues);
  addInputAvailabilityIssues(document.after, 'after', issues);
  const beforeScope = document.before.services.map(({ namespace }) => namespace).sort();
  const afterScope = document.after.services.map(({ namespace }) => namespace).sort();
  if (canonicalStringify(beforeScope) !== canonicalStringify(afterScope)) {
    issues.push({
      code: 'COMPARISON_INVALID',
      path: 'services',
      message: 'Before and after service namespace scopes must be identical.',
    });
  }
  addChangeShapeIssues(document, issues);
  addSnapshotIdentityIssues(document, issues);
  addAvailabilityBoundaryIssues(document, issues);
  addPropagationIssues(document, issues);
  if (
    document.resultState !==
    (document.uncertainties.length === 0 ? 'completed' : 'completed_with_unknowns')
  ) {
    issues.push({
      code: 'AVAILABILITY_INVALID',
      path: 'resultState',
      message: 'Result state must expose whether comparison uncertainties exist.',
    });
  }
  const summary = expectedSummary(document);
  if (canonicalStringify(document.summary) !== canonicalStringify(summary)) {
    issues.push({
      code: 'SUMMARY_MISMATCH',
      path: 'summary',
      message: 'Summary counts do not match the retained change and uncertainty records.',
    });
  }
  const { impactId: _impactId, ...withoutId } = document;
  void _impactId;
  mismatch(issues, 'impactId', document.impactId, makeSystemImpactId(withoutId));
  return issues.length === 0 ? { success: true, data: document } : { success: false, issues };
}

export function assertValidSystemImpactDocument(input: unknown): SystemImpactDocument {
  const result = validateSystemImpactDocument(input);
  if (!result.success) throw new SystemImpactDocumentError(result.issues);
  return result.data;
}
