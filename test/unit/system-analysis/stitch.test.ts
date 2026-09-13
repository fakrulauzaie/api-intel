import { describe, expect, it } from 'vitest';
import { createStableId } from '../../../src/model/ids.js';
import type { AnalysisDocumentV3 } from '../../../src/model/analysis.js';
import type {
  InteractionHandlerRecord,
  InteractionRecord,
} from '../../../src/model/interactions.js';
import {
  assertValidSystemTopologyManifest,
  serializeCanonicalSystemAnalysis,
  stitchSystemAnalyses,
  validateSystemAnalysisDocument,
  validateSystemTopologyManifest,
  type SystemTopologyManifest,
} from '../../../src/system-analysis/index.js';
import { createMinimalAnalysisDocumentV3 } from '../../helpers/minimal-analysis.js';

function analysis(input: {
  readonly namespace: string;
  readonly interactions?: readonly InteractionRecord[];
  readonly handlers?: readonly InteractionHandlerRecord[];
}): AnalysisDocumentV3 {
  const base = createMinimalAnalysisDocumentV3();
  return {
    ...base,
    resultState: 'completed',
    analysisRun: {
      ...base.analysisRun,
      id: createStableId('analysis', [input.namespace]),
    },
    interactions: input.interactions ?? [],
    interactionHandlers: input.handlers ?? [],
    interactionAnalysis: {
      schemaKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      supportedKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      enabledKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      state: 'complete',
    },
  };
}

function microProducer(input: {
  readonly namespace: string;
  readonly mode?: 'event' | 'request_response';
  readonly pattern?: string | null;
  readonly activation?: 'eager' | 'constructed_cold';
  readonly transport?: 'rmq' | 'kafka';
}): InteractionRecord {
  const pattern = input.pattern === undefined ? '"orders.rebuild-index"' : input.pattern;
  return {
    id: createStableId('interaction', [input.namespace, input.mode ?? 'request_response', pattern]),
    sourceMethodId: createStableId('method', [input.namespace, 'produce']),
    applicationId: null,
    direction: 'outbound',
    activation: input.activation ?? 'proven_activated',
    boundary: 'external_or_unobserved',
    dispatchTiming: 'asynchronous',
    ruleId: 'test.micro.producer',
    evidenceIds: [],
    kind: 'microservice_message',
    target: {
      targetKind: 'message',
      mode: input.mode ?? 'request_response',
      patternKind: pattern === null ? 'dynamic' : 'scalar',
      canonicalPattern: pattern,
      clientToken: { resolution: 'exact', value: 'MESSAGE_QUEUE_SERVICE' },
      transport: input.transport ?? 'rmq',
    },
  };
}

function microConsumer(namespace: string): InteractionHandlerRecord {
  return {
    id: createStableId('interaction_handler', [namespace, 'orders.rebuild-index']),
    methodId: createStableId('method', [namespace, 'consume']),
    applicationId: null,
    registrationState: 'proven_registered',
    ruleId: 'test.micro.consumer',
    handlerEvidenceId: createStableId('evidence', [namespace, 'handler']),
    kind: 'microservice_message',
    target: {
      targetKind: 'message',
      mode: 'request_response',
      patternKind: 'scalar',
      canonicalPattern: '"orders.rebuild-index"',
      clientToken: { resolution: 'dynamic', value: null },
      transport: 'rmq',
    },
  };
}

function bullProducer(namespace: string): InteractionRecord {
  return {
    id: createStableId('interaction', [namespace, 'reports', 'generate-pdf']),
    sourceMethodId: createStableId('method', [namespace, 'enqueue']),
    applicationId: null,
    direction: 'outbound',
    activation: 'eager',
    boundary: 'broker_or_worker_boundary',
    dispatchTiming: 'asynchronous',
    ruleId: 'test.bull.producer',
    evidenceIds: [],
    kind: 'job_queue',
    target: {
      targetKind: 'queue',
      technology: 'bullmq',
      queue: { resolution: 'exact', value: 'reports' },
      job: { resolution: 'exact', value: 'generate-pdf' },
    },
  };
}

function bullConsumer(namespace: string): InteractionHandlerRecord {
  return {
    id: createStableId('interaction_handler', [namespace, 'reports']),
    methodId: createStableId('method', [namespace, 'process']),
    applicationId: null,
    registrationState: 'proven_registered',
    ruleId: 'test.bull.consumer',
    handlerEvidenceId: createStableId('evidence', [namespace, 'processor']),
    kind: 'job_queue',
    target: {
      targetKind: 'queue',
      technology: 'bullmq',
      queue: { resolution: 'exact', value: 'reports' },
      job: { resolution: 'dynamic', value: null },
    },
  };
}

function topology(input?: {
  readonly consumerNamespaces?: readonly string[];
  readonly consumerBrokerAlias?: string;
}): SystemTopologyManifest {
  const consumerNamespaces = input?.consumerNamespaces ?? ['orders-worker'];
  const realm = (brokerAlias: string) => ({
    brokerAlias,
    environmentAlias: 'test',
    technology: 'nest_microservices' as const,
    transport: 'rmq' as const,
    destination: { kind: 'queue' as const, value: 'orders_jobs' },
    prefix: null,
    namespace: null,
  });
  const contract = {
    targetKind: 'microservice_message' as const,
    mode: 'request_response' as const,
    patternKind: 'scalar' as const,
    canonicalPattern: '"orders.rebuild-index"',
  };
  return assertValidSystemTopologyManifest({
    schemaVersion: '1.0.0',
    systemName: 'orders-system',
    brokerRealms: [
      realm('primary-rmq'),
      ...(input?.consumerBrokerAlias === undefined ? [] : [realm(input.consumerBrokerAlias)]),
    ],
    bindings: [
      {
        serviceNamespace: 'orders-api',
        role: 'producer',
        contract,
        analysisRecordId: null,
        brokerAlias: 'primary-rmq',
        environmentAlias: 'test',
      },
      ...consumerNamespaces.map((serviceNamespace) => ({
        serviceNamespace,
        role: 'consumer' as const,
        contract,
        analysisRecordId: null,
        brokerAlias: input?.consumerBrokerAlias ?? 'primary-rmq',
        environmentAlias: 'test',
      })),
    ],
  });
}

function stitch(input: {
  readonly consumers?: readonly string[];
  readonly topology?: SystemTopologyManifest;
  readonly producer?: InteractionRecord;
}) {
  const consumerNamespaces = input.consumers ?? ['orders-worker'];
  return stitchSystemAnalyses({
    systemName: 'orders-system',
    services: [
      {
        namespace: 'orders-api',
        artifactLabel: 'orders-api-analysis.json',
        analysis: analysis({
          namespace: 'orders-api',
          interactions: [input.producer ?? microProducer({ namespace: 'orders-api' })],
        }),
      },
      ...consumerNamespaces.map((namespace) => ({
        namespace,
        artifactLabel: `${namespace}-analysis.json`,
        analysis: analysis({ namespace, handlers: [microConsumer(namespace)] }),
      })),
    ],
    ...(input.topology === undefined ? {} : { topology: input.topology }),
  });
}

describe('Phase 46 artifact-only stitch engine', () => {
  it('correlates the orders API/worker request only as a declared-realm candidate', () => {
    const document = stitch({ topology: topology() });
    expect(document.correlations).toEqual([
      expect.objectContaining({
        state: 'declared_realm_candidate',
        brokerRealmId: document.brokerRealms[0]?.id,
        unmatchedReason: null,
      }),
    ]);
    expect(validateSystemAnalysisDocument(document)).toMatchObject({ success: true });
    expect(document.sourceDocumentsEmbedded).toBe(false);
  });

  it('keeps matching targets without topology non-traversable and deterministic', () => {
    const forward = stitch({});
    const reversed = stitchSystemAnalyses({
      systemName: forward.systemName,
      services: [
        {
          namespace: 'orders-worker',
          artifactLabel: 'orders-worker-analysis.json',
          analysis: analysis({
            namespace: 'orders-worker',
            handlers: [microConsumer('orders-worker')],
          }),
        },
        {
          namespace: 'orders-api',
          artifactLabel: 'orders-api-analysis.json',
          analysis: analysis({
            namespace: 'orders-api',
            interactions: [microProducer({ namespace: 'orders-api' })],
          }),
        },
      ],
    });
    expect(forward.correlations[0]).toMatchObject({ state: 'target_only_candidate' });
    expect(serializeCanonicalSystemAnalysis(reversed)).toBe(
      serializeCanonicalSystemAnalysis(forward),
    );
  });

  it('preserves realm collisions and request fan-out as distinct uncertainty states', () => {
    const mismatch = stitch({
      topology: topology({ consumerBrokerAlias: 'shadow-rmq' }),
    });
    expect(mismatch.correlations[0]).toMatchObject({
      state: 'unmatched',
      unmatchedReason: 'realm_mismatch',
    });

    const consumers = ['orders-worker-a', 'orders-worker-b'];
    const ambiguous = stitch({
      consumers,
      topology: topology({ consumerNamespaces: consumers }),
    });
    expect(ambiguous.correlations).toEqual([
      expect.objectContaining({
        state: 'ambiguous',
        ambiguityReason: 'multiple_request_consumers',
      }),
    ]);
  });

  it('matches an exact BullMQ producer to a queue-wide worker contract', () => {
    const manifest = assertValidSystemTopologyManifest({
      schemaVersion: '1.0.0',
      systemName: 'reports-system',
      brokerRealms: [
        {
          brokerAlias: 'reports-redis',
          environmentAlias: 'test',
          technology: 'bullmq',
          transport: 'bullmq',
          destination: { kind: 'queue', value: 'reports' },
          prefix: null,
          namespace: null,
        },
      ],
      bindings: [
        {
          serviceNamespace: 'reports-api',
          role: 'producer',
          contract: {
            targetKind: 'job_queue',
            technology: 'bullmq',
            queue: 'reports',
            job: 'generate-pdf',
          },
          analysisRecordId: null,
          brokerAlias: 'reports-redis',
          environmentAlias: 'test',
        },
        {
          serviceNamespace: 'reports-worker',
          role: 'consumer',
          contract: {
            targetKind: 'job_queue',
            technology: 'bullmq',
            queue: 'reports',
            job: null,
          },
          analysisRecordId: null,
          brokerAlias: 'reports-redis',
          environmentAlias: 'test',
        },
      ],
    });
    const document = stitchSystemAnalyses({
      systemName: 'reports-system',
      topology: manifest,
      services: [
        {
          namespace: 'reports-api',
          artifactLabel: 'reports-api-analysis.json',
          analysis: analysis({
            namespace: 'reports-api',
            interactions: [bullProducer('reports-api')],
          }),
        },
        {
          namespace: 'reports-worker',
          artifactLabel: 'reports-worker-analysis.json',
          analysis: analysis({
            namespace: 'reports-worker',
            handlers: [bullConsumer('reports-worker')],
          }),
        },
      ],
    });
    expect(document.correlations[0]).toMatchObject({ state: 'declared_realm_candidate' });
    expect(validateSystemAnalysisDocument(document)).toMatchObject({ success: true });
  });

  it('keeps cold and dynamic producers explicitly unsupported', () => {
    const cold = stitch({
      producer: microProducer({ namespace: 'orders-api', activation: 'constructed_cold' }),
    });
    expect(cold.correlations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'unmatched',
          unmatchedReason: 'unsupported_identity',
        }),
      ]),
    );
    expect(cold.diagnostics.map(({ code }) => code)).toContain('SYSTEM_TARGET_UNSUPPORTED');

    const dynamic = stitch({
      producer: microProducer({ namespace: 'orders-api', pattern: null }),
    });
    expect(dynamic.correlations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'unmatched',
          unmatchedReason: 'unsupported_identity',
        }),
      ]),
    );
  });

  it('rejects incompatible, duplicate, and unresolved topology declarations', () => {
    expect(
      validateSystemTopologyManifest({
        schemaVersion: '1.0.0',
        systemName: 'bad-system',
        brokerRealms: [
          {
            brokerAlias: 'bad',
            environmentAlias: 'test',
            technology: 'bullmq',
            transport: 'rmq',
            destination: { kind: 'queue', value: 'reports' },
            prefix: null,
            namespace: null,
          },
        ],
        bindings: [],
      }),
    ).toMatchObject({ success: false });
    expect(() =>
      stitchSystemAnalyses({
        systemName: 'orders-system',
        topology: topology(),
        services: [
          {
            namespace: 'orders-api',
            artifactLabel: 'orders-api-analysis.json',
            analysis: analysis({ namespace: 'orders-api', interactions: [] }),
          },
        ],
      }),
    ).toThrow('did not select a source record');
    expect(() =>
      stitch({
        topology: topology(),
        producer: microProducer({ namespace: 'orders-api', transport: 'kafka' }),
      }),
    ).toThrow('contradicts source transport kafka');
  });
});
