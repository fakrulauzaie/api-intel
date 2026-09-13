import { describe, expect, it } from 'vitest';
import { createSemanticKey } from '../../../src/comparison/semantic-key.js';
import type { AnalysisDocumentV3 } from '../../../src/model/analysis.js';
import { makeInteractionHandlerId, makeInteractionId } from '../../../src/model/ids.js';
import {
  interactionTargetKey,
  type InteractionHandlerRecord,
  type InteractionRecord,
  type MicroserviceMessageTarget,
} from '../../../src/model/interactions.js';
import type { PolicyResultsDocument } from '../../../src/policy/model.js';
import { assertValidPolicyResultsDocument } from '../../../src/policy/validate.js';
import {
  createQueryKernel,
  distributedCandidatesResponseSchema,
  policyResultsResponseSchema,
  type QueryInputError,
} from '../../../src/query/index.js';
import {
  stitchSystemAnalyses,
  type SystemAnalysisDocument,
  type SystemTopologyManifest,
} from '../../../src/system-analysis/index.js';
import { createMinimalAnalysisDocumentV3 } from '../../helpers/minimal-analysis.js';

const CANONICAL_PATTERN = '"orders.rebuild-index"';

function distributedAnalysis(role: 'producer' | 'consumer'): AnalysisDocumentV3 {
  const base = createMinimalAnalysisDocumentV3();
  const method = base.methods[0]!;
  const evidenceId = base.evidence[0]!.id;
  const target: MicroserviceMessageTarget = {
    targetKind: 'message',
    mode: 'request_response',
    patternKind: 'scalar',
    canonicalPattern: CANONICAL_PATTERN,
    clientToken:
      role === 'producer'
        ? { resolution: 'exact', value: 'MESSAGE_QUEUE_SERVICE' }
        : { resolution: 'dynamic', value: null },
    transport: 'rmq',
  };
  const interaction: InteractionRecord = {
    id: makeInteractionId({
      kind: 'microservice_message',
      sourceMethodId: method.id,
      targetKey: interactionTargetKey(target),
      applicationId: null,
      initiationEvidenceId: evidenceId,
    }),
    sourceMethodId: method.id,
    applicationId: null,
    direction: 'outbound',
    activation: 'proven_activated',
    boundary: 'external_or_unobserved',
    dispatchTiming: 'asynchronous',
    ruleId: 'test.query.microservice.producer',
    evidenceIds: [evidenceId],
    kind: 'microservice_message',
    target,
  };
  const handler: InteractionHandlerRecord = {
    id: makeInteractionHandlerId({
      kind: 'microservice_message',
      methodId: method.id,
      targetKey: interactionTargetKey(target),
      applicationId: null,
      handlerEvidenceId: evidenceId,
    }),
    methodId: method.id,
    applicationId: null,
    registrationState: 'proven_registered',
    ruleId: 'test.query.microservice.consumer',
    handlerEvidenceId: evidenceId,
    kind: 'microservice_message',
    target,
  };
  return {
    ...base,
    interactions: role === 'producer' ? [interaction] : [],
    interactionHandlers: role === 'consumer' ? [handler] : [],
    interactionAnalysis: {
      schemaKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      supportedKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      enabledKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      state: 'complete',
    },
  };
}

function topology(): SystemTopologyManifest {
  const contract = {
    targetKind: 'microservice_message' as const,
    mode: 'request_response' as const,
    patternKind: 'scalar' as const,
    canonicalPattern: CANONICAL_PATTERN,
  };
  return {
    schemaVersion: '1.0.0',
    systemName: 'query-system',
    brokerRealms: [
      {
        brokerAlias: 'orders-rmq',
        environmentAlias: 'test',
        technology: 'nest_microservices',
        transport: 'rmq',
        destination: { kind: 'queue', value: 'orders-queue' },
        prefix: null,
        namespace: null,
      },
    ],
    bindings: [
      {
        serviceNamespace: 'orders-api',
        role: 'producer',
        contract,
        analysisRecordId: null,
        brokerAlias: 'orders-rmq',
        environmentAlias: 'test',
      },
      {
        serviceNamespace: 'orders-worker',
        role: 'consumer',
        contract,
        analysisRecordId: null,
        brokerAlias: 'orders-rmq',
        environmentAlias: 'test',
      },
    ],
  };
}

function system(withTopology: boolean, withConsumer = true): SystemAnalysisDocument {
  return stitchSystemAnalyses({
    systemName: 'query-system',
    services: [
      {
        namespace: 'orders-api',
        artifactLabel: 'ticket-analysis.json',
        analysis: distributedAnalysis('producer'),
      },
      ...(withConsumer
        ? [
            {
              namespace: 'orders-worker',
              artifactLabel: 'orders-analysis.json',
              analysis: distributedAnalysis('consumer'),
            },
          ]
        : []),
    ],
    ...(withTopology ? { topology: topology() } : {}),
  });
}

function policyDocument(): PolicyResultsDocument {
  const analysis = createMinimalAnalysisDocumentV3();
  const subject = {
    semanticKey: createSemanticKey('analysis', ['query-policy']),
    displayName: 'analysis',
    canonicalIds: [analysis.analysisRun.id],
  };
  return assertValidPolicyResultsDocument({
    schemaVersion: '1.0.0',
    analysis: {
      analysisId: analysis.analysisRun.id,
      analysisSchemaVersion: analysis.schemaVersion,
      resultState: 'completed',
    },
    baseline: null,
    configuration: {
      version: 1,
      rules: [
        {
          ruleId: 'require-complete-write-trace',
          severity: 'warn',
          onUnknown: 'error',
        },
        {
          ruleId: 'require-guard-on-write-endpoint',
          severity: 'error',
          onUnknown: 'warn',
        },
      ],
    },
    summary: {
      passed: 0,
      failed: 0,
      unknown: 2,
      notApplicable: 0,
      warnings: 1,
      errors: 1,
      blocking: 1,
    },
    results: [
      {
        ruleId: 'require-complete-write-trace',
        ruleVersion: '1.0.0',
        severity: 'error',
        outcome: 'unknown',
        blocking: true,
        reasonCode: 'write_trace_unknown',
        message: 'Trace completeness is not proven.',
        subject,
        evidenceIds: [analysis.evidence[0]!.id],
      },
      {
        ruleId: 'require-guard-on-write-endpoint',
        ruleVersion: '1.0.0',
        severity: 'warn',
        outcome: 'unknown',
        blocking: false,
        reasonCode: 'write_endpoint_guard_unknown',
        message: 'Guard state is not proven.',
        subject,
        evidenceIds: [analysis.evidence[0]!.id],
      },
    ],
  });
}

function errorCode(error: unknown): string | undefined {
  return (error as Partial<QueryInputError>).code;
}

describe('distributed and policy evidence queries', () => {
  it('requires a complete structural target and preserves every system correlation state', () => {
    const kernel = createQueryKernel({
      artifacts: [
        { name: 'declared', kind: 'system_analysis', document: system(true) },
        { name: 'target-only', kind: 'system_analysis', document: system(false) },
        { name: 'unmatched', kind: 'system_analysis', document: system(false, false) },
      ],
    });
    const target = {
      targetKind: 'microservice_message' as const,
      mode: 'request_response' as const,
      patternKind: 'scalar' as const,
      canonicalPattern: CANONICAL_PATTERN,
    };
    for (const [artifactName, expectedState] of [
      ['declared', 'declared_realm_candidate'],
      ['target-only', 'target_only_candidate'],
      ['unmatched', 'unmatched'],
    ] as const) {
      const response = kernel.findDistributedCandidates({
        artifactName,
        kind: 'microservice_message',
        target,
      });
      expect(distributedCandidatesResponseSchema.safeParse(response).success).toBe(true);
      expect(response.candidates.map(({ state }) => state)).toContain(expectedState);
      expect(response.candidates[0]!.canonicalIds.length).toBeGreaterThan(0);
    }
    try {
      kernel.findDistributedCandidates({
        artifactName: 'declared',
        kind: 'job_queue',
        target,
      });
      throw new Error('Expected mismatched structural kind to fail.');
    } catch (error) {
      expect(errorCode(error)).toBe('INVALID_QUERY');
    }
  });

  it('filters policy unknown and blocking independently without changing either fact', () => {
    const policy = policyDocument();
    const kernel = createQueryKernel({
      artifacts: [{ name: 'policy', kind: 'policy', document: policy }],
    });
    const blocking = kernel.getPolicyResults({
      artifactName: 'policy',
      filters: { outcomes: ['unknown'], blocking: true },
    });
    const nonBlocking = kernel.getPolicyResults({
      artifactName: 'policy',
      filters: { outcomes: ['unknown'], blocking: false },
    });

    expect(policyResultsResponseSchema.safeParse(blocking).success).toBe(true);
    expect(policyResultsResponseSchema.safeParse(nonBlocking).success).toBe(true);
    expect(blocking.results).toMatchObject([{ outcome: 'unknown', blocking: true }]);
    expect(nonBlocking.results).toMatchObject([{ outcome: 'unknown', blocking: false }]);
    expect(blocking.filteredSummary).toMatchObject({ unknown: 1, blocking: 1, errors: 1 });
    expect(nonBlocking.filteredSummary).toMatchObject({ unknown: 1, blocking: 0, warnings: 1 });
    expect(blocking.sourceSummary).toEqual(policy.summary);
  });
});
