import { describe, expect, it } from 'vitest';
import { createStableId } from '../../../src/model/ids.js';
import {
  makeBrokerRealmId,
  makeNamespacedAnalysisRecordId,
  makeSystemAnalysisId,
  makeSystemCorrelationId,
  makeSystemDiagnosticId,
  makeSystemEndpointId,
  makeSystemServiceId,
  systemInteractionContractKey,
  type BrokerRealmRecord,
  type SystemAnalysisDocument,
  type SystemDiagnosticRecord,
  type SystemInteractionCorrelationRecord,
  type SystemInteractionEndpointRecord,
  type SystemServiceRecord,
  type SystemTopologyManifest,
} from '../../../src/system-analysis/index.js';
import {
  compareSystemAnalyses,
  serializeCanonicalSystemImpact,
  SystemImpactComparisonError,
  validateSystemImpactDocument,
  type CompareSystemImpactInput,
} from '../../../src/system-impact/index.js';

const contract = {
  targetKind: 'microservice_message',
  mode: 'request_response',
  patternKind: 'scalar',
  canonicalPattern: '"orders.rebuild-index"',
} as const;

function service(namespace: string): SystemServiceRecord {
  return {
    id: makeSystemServiceId(namespace),
    namespace,
    displayName: namespace,
    analysisId: createStableId('analysis', [namespace, 'stable-snapshot']),
    analysisSchemaVersion: '8.0.0',
    analysisResultState: 'completed',
    artifactLabel: `${namespace}-analysis.json`,
  };
}

function realm(): BrokerRealmRecord {
  const declaration = {
    brokerAlias: 'orders-rmq',
    environmentAlias: 'test',
    technology: 'nest_microservices',
    transport: 'rmq',
    destination: { kind: 'queue', value: 'orders_queue' },
    prefix: null,
    namespace: null,
  } as const;
  return {
    ...declaration,
    id: makeBrokerRealmId(declaration),
    declarationSource: 'topology_manifest',
  };
}

function sourceRecordId(namespace: string, role: 'producer' | 'consumer'): string {
  return createStableId(role === 'producer' ? 'interaction' : 'interaction_handler', [
    namespace,
    role,
    'stable-source-record',
  ]);
}

function endpoint(
  owner: SystemServiceRecord,
  role: 'producer' | 'consumer',
  brokerRealmId: string | null,
): SystemInteractionEndpointRecord {
  const analysisRecordId = sourceRecordId(owner.namespace, role);
  const namespacedId = makeNamespacedAnalysisRecordId({
    serviceNamespace: owner.namespace,
    analysisRecordId,
  });
  return {
    id: makeSystemEndpointId({ namespacedRecordId: namespacedId, role }),
    serviceId: owner.id,
    role,
    kind: 'microservice_message',
    analysisRecord: { serviceId: owner.id, analysisRecordId, namespacedId },
    contract,
    contractKey: systemInteractionContractKey(contract),
    sourceTransport: 'rmq',
    brokerRealmId,
  };
}

function correlation(input: Omit<SystemInteractionCorrelationRecord, 'id' | 'diagnosticIds'>): {
  readonly record: SystemInteractionCorrelationRecord;
  readonly diagnostic: SystemDiagnosticRecord | null;
} {
  const id = makeSystemCorrelationId(input);
  if (input.state === 'declared_realm_candidate') {
    return {
      record: { ...input, id, diagnosticIds: [] } as SystemInteractionCorrelationRecord,
      diagnostic: null,
    };
  }
  const code =
    input.state === 'target_only_candidate'
      ? 'SYSTEM_TARGET_ONLY_CANDIDATE'
      : input.unmatchedReason === 'producer_only'
        ? 'SYSTEM_PRODUCER_UNMATCHED'
        : 'SYSTEM_CORRELATION_AMBIGUOUS';
  const diagnosticBase = {
    code,
    severity: 'warning',
    message: `Static ${input.state} correlation.`,
    subjectId: id,
  } as const;
  const diagnostic = { ...diagnosticBase, id: makeSystemDiagnosticId(diagnosticBase) };
  return {
    record: { ...input, id, diagnosticIds: [diagnostic.id] } as SystemInteractionCorrelationRecord,
    diagnostic,
  };
}

function document(input: {
  readonly services: readonly SystemServiceRecord[];
  readonly realms: readonly BrokerRealmRecord[];
  readonly endpoints: readonly SystemInteractionEndpointRecord[];
  readonly correlations: readonly SystemInteractionCorrelationRecord[];
  readonly diagnostics: readonly SystemDiagnosticRecord[];
}): SystemAnalysisDocument {
  return {
    schemaVersion: '1.0.0',
    systemId: makeSystemAnalysisId({
      systemName: 'ticket-platform',
      services: input.services,
      brokerRealmIds: input.realms.map(({ id }) => id),
      endpoints: input.endpoints,
      correlationIds: input.correlations.map(({ id }) => id),
      diagnosticIds: input.diagnostics.map(({ id }) => id),
    }),
    systemName: 'ticket-platform',
    sourceDocumentsEmbedded: false,
    services: input.services,
    brokerRealms: input.realms,
    interactionEndpoints: input.endpoints,
    correlations: input.correlations,
    diagnostics: input.diagnostics,
  };
}

function pairedDocument(declared: boolean): SystemAnalysisDocument {
  const ticket = service('orders-api');
  const worker = service('orders-worker');
  const broker = realm();
  const brokerId = declared ? broker.id : null;
  const producer = endpoint(ticket, 'producer', brokerId);
  const consumer = endpoint(worker, 'consumer', brokerId);
  const result = correlation(
    declared
      ? {
          state: 'declared_realm_candidate',
          kind: 'microservice_message',
          contractKey: producer.contractKey,
          producerEndpointId: producer.id,
          consumerEndpointIds: [consumer.id],
          brokerRealmId: broker.id,
          unmatchedReason: null,
          ambiguityReason: null,
        }
      : {
          state: 'target_only_candidate',
          kind: 'microservice_message',
          contractKey: producer.contractKey,
          producerEndpointId: producer.id,
          consumerEndpointIds: [consumer.id],
          brokerRealmId: null,
          unmatchedReason: null,
          ambiguityReason: null,
        },
  );
  return document({
    services: [ticket, worker],
    realms: declared ? [broker] : [],
    endpoints: [producer, consumer],
    correlations: [result.record],
    diagnostics: result.diagnostic === null ? [] : [result.diagnostic],
  });
}

function producerOnlyDocument(): SystemAnalysisDocument {
  const ticket = service('orders-api');
  const broker = realm();
  const producer = endpoint(ticket, 'producer', broker.id);
  const result = correlation({
    state: 'unmatched',
    kind: 'microservice_message',
    contractKey: producer.contractKey,
    producerEndpointId: producer.id,
    consumerEndpointIds: [],
    brokerRealmId: broker.id,
    unmatchedReason: 'producer_only',
    ambiguityReason: null,
  });
  return document({
    services: [ticket],
    realms: [broker],
    endpoints: [producer],
    correlations: [result.record],
    diagnostics: result.diagnostic === null ? [] : [result.diagnostic],
  });
}

function ambiguousDocument(ambiguous: boolean): SystemAnalysisDocument {
  const ticket = service('orders-api');
  const worker = service('orders-worker');
  const shadow = service('orders-shadow-worker');
  const producer = endpoint(ticket, 'producer', null);
  const consumer = endpoint(worker, 'consumer', null);
  const shadowConsumer = endpoint(shadow, 'consumer', null);
  const result = correlation(
    ambiguous
      ? {
          state: 'ambiguous',
          kind: 'microservice_message',
          contractKey: producer.contractKey,
          producerEndpointId: producer.id,
          consumerEndpointIds: [consumer.id, shadowConsumer.id],
          brokerRealmId: null,
          unmatchedReason: null,
          ambiguityReason: 'multiple_request_consumers',
        }
      : {
          state: 'target_only_candidate',
          kind: 'microservice_message',
          contractKey: producer.contractKey,
          producerEndpointId: producer.id,
          consumerEndpointIds: [consumer.id],
          brokerRealmId: null,
          unmatchedReason: null,
          ambiguityReason: null,
        },
  );
  return document({
    services: [ticket, worker, shadow],
    realms: [],
    endpoints: ambiguous ? [producer, consumer, shadowConsumer] : [producer, consumer],
    correlations: [result.record],
    diagnostics: result.diagnostic === null ? [] : [result.diagnostic],
  });
}

function topology(): SystemTopologyManifest {
  const broker = realm();
  return {
    schemaVersion: '1.0.0',
    systemName: 'ticket-platform',
    brokerRealms: [
      {
        brokerAlias: broker.brokerAlias,
        environmentAlias: broker.environmentAlias,
        technology: broker.technology,
        transport: broker.transport,
        destination: broker.destination,
        prefix: broker.prefix,
        namespace: broker.namespace,
      },
    ],
    bindings: [
      {
        serviceNamespace: 'orders-api',
        role: 'producer',
        contract,
        analysisRecordId: sourceRecordId('orders-api', 'producer'),
        brokerAlias: broker.brokerAlias,
        environmentAlias: broker.environmentAlias,
      },
      {
        serviceNamespace: 'orders-worker',
        role: 'consumer',
        contract,
        analysisRecordId: sourceRecordId('orders-worker', 'consumer'),
        brokerAlias: broker.brokerAlias,
        environmentAlias: broker.environmentAlias,
      },
    ],
  };
}

function comparisonInput(): CompareSystemImpactInput {
  return {
    systemName: 'ticket-platform',
    before: {
      label: 'baseline',
      document: pairedDocument(false),
      services: [
        { namespace: 'orders-api', state: 'available' },
        { namespace: 'orders-worker', state: 'available' },
      ],
      topology: { state: 'not_present' },
    },
    after: {
      label: 'current',
      document: pairedDocument(true),
      services: [
        { namespace: 'orders-api', state: 'available' },
        { namespace: 'orders-worker', state: 'available' },
      ],
      topology: { state: 'available', manifest: topology() },
    },
  };
}

describe('Phase P4.1 system comparison contract', () => {
  it('compares source-record identities and reports conditional eligibility without propagating effects', () => {
    const result = compareSystemAnalyses(comparisonInput());

    expect(result.resultState).toBe('completed');
    expect(result.serviceChanges).toHaveLength(0);
    expect(result.producerChanges).toMatchObject([
      { changeKind: 'modified', reasons: ['broker_binding_changed'] },
    ]);
    expect(result.consumerChanges).toMatchObject([
      { changeKind: 'modified', reasons: ['broker_binding_changed'] },
    ]);
    expect(result.realmChanges).toMatchObject([{ changeKind: 'added' }]);
    expect(result.bindingChanges).toHaveLength(2);
    expect(result.correlationChanges).toMatchObject([
      { changeKind: 'modified', reasons: ['state_changed', 'broker_realm_changed'] },
    ]);
    expect(result.conditionalCandidateChanges).toMatchObject([{ changeKind: 'added' }]);
    expect(result.propagation).toEqual({
      state: 'not_computed',
      reason: 'phase_p4_1_contract_only',
    });
    expect(validateSystemImpactDocument(result)).toEqual({ success: true, data: result });
  });

  it('treats unavailable service artifacts as unknown instead of removed', () => {
    const input = comparisonInput();
    const result = compareSystemAnalyses({
      ...input,
      before: { ...input.after, label: 'baseline' },
      after: {
        label: 'current',
        document: producerOnlyDocument(),
        services: [
          { namespace: 'orders-api', state: 'available' },
          { namespace: 'orders-worker', state: 'missing', reason: 'artifact_missing' },
        ],
        topology: { state: 'available', manifest: topology() },
      },
    });

    expect(result.resultState).toBe('completed_with_unknowns');
    expect(result.serviceChanges).toHaveLength(0);
    expect(result.consumerChanges).toHaveLength(0);
    expect(result.correlationChanges).toHaveLength(0);
    expect(result.conditionalCandidateChanges).toHaveLength(0);
    expect(result.uncertainties.map(({ code }) => code)).toEqual([
      'CORRELATION_FACTS_UNAVAILABLE',
      'SERVICE_ARTIFACT_MISSING',
    ]);
    expect(result.after.facts).toMatchObject({
      interactionEndpoints: 'partial',
      correlations: 'unavailable',
    });
  });

  it('reports removal only when the comparison explicitly proves known absence', () => {
    const input = comparisonInput();
    const result = compareSystemAnalyses({
      ...input,
      before: { ...input.after, label: 'baseline' },
      after: {
        label: 'current',
        document: producerOnlyDocument(),
        services: [
          { namespace: 'orders-api', state: 'available' },
          { namespace: 'orders-worker', state: 'not_present' },
        ],
        topology: { state: 'available', manifest: topology() },
      },
    });

    expect(result.resultState).toBe('completed');
    expect(result.serviceChanges).toMatchObject([{ key: 'orders-worker', changeKind: 'removed' }]);
    expect(result.consumerChanges).toMatchObject([{ changeKind: 'removed' }]);
    expect(result.correlationChanges).toMatchObject([
      {
        changeKind: 'modified',
        reasons: ['state_changed', 'consumer_selection_changed', 'unmatched_reason_changed'],
      },
    ]);
    expect(result.conditionalCandidateChanges).toMatchObject([{ changeKind: 'removed' }]);
  });

  it('tracks ambiguity transitions without promoting target-only matches', () => {
    const services = [
      { namespace: 'orders-api', state: 'available' },
      { namespace: 'orders-worker', state: 'available' },
      { namespace: 'orders-shadow-worker', state: 'available' },
    ] as const;
    const result = compareSystemAnalyses({
      systemName: 'ticket-platform',
      before: {
        label: 'baseline',
        document: ambiguousDocument(false),
        services,
        topology: { state: 'not_present' },
      },
      after: {
        label: 'current',
        document: ambiguousDocument(true),
        services,
        topology: { state: 'not_present' },
      },
    });

    expect(result.summary.ambiguitiesIntroduced).toBe(1);
    expect(result.correlationChanges).toMatchObject([
      {
        changeKind: 'modified',
        after: { state: 'ambiguous' },
        reasons: ['state_changed', 'consumer_selection_changed', 'ambiguity_reason_changed'],
      },
    ]);
    expect(result.conditionalCandidateChanges).toHaveLength(0);
  });

  it('withholds topology and correlation deltas when a topology artifact is missing', () => {
    const input = comparisonInput();
    const result = compareSystemAnalyses({
      ...input,
      before: { ...input.after, label: 'baseline' },
      after: {
        ...input.after,
        topology: { state: 'missing', reason: 'artifact_missing' },
      },
    });

    expect(result.resultState).toBe('completed_with_unknowns');
    expect(result.realmChanges).toHaveLength(0);
    expect(result.bindingChanges).toHaveLength(0);
    expect(result.correlationChanges).toHaveLength(0);
    expect(result.uncertainties.map(({ code }) => code)).toEqual([
      'CORRELATION_FACTS_UNAVAILABLE',
      'TOPOLOGY_ARTIFACT_MISSING',
    ]);
  });

  it('has deterministic ordering and rejects identity, summary, and scope corruption', () => {
    const result = compareSystemAnalyses(comparisonInput());
    const reordered = {
      ...result,
      bindingChanges: [...result.bindingChanges].reverse(),
      before: { ...result.before, services: [...result.before.services].reverse() },
    };
    expect(serializeCanonicalSystemImpact(reordered)).toBe(serializeCanonicalSystemImpact(result));
    expect(
      validateSystemImpactDocument({
        ...result,
        summary: { ...result.summary, bindingsAdded: 99 },
      }),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'SUMMARY_MISMATCH' })]),
    });
    expect(
      validateSystemImpactDocument({
        ...result,
        impactId: createStableId('system_impact', ['wrong']),
      }),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'IDENTITY_MISMATCH' })]),
    });
    expect(validateSystemImpactDocument({ ...result, unsupportedField: true })).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'SCHEMA_INVALID' })]),
    });

    const input = comparisonInput();
    expect(() =>
      compareSystemAnalyses({
        ...input,
        after: { ...input.after, services: [{ namespace: 'orders-api', state: 'available' }] },
      }),
    ).toThrow(SystemImpactComparisonError);
    expect(() =>
      compareSystemAnalyses({
        ...input,
        after: {
          ...input.after,
          topology: {
            state: 'available',
            manifest: { ...topology(), bindings: [] },
          },
        },
      }),
    ).toThrow(SystemImpactComparisonError);
  });
});
