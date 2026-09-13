import {
  analyzePotentialImpact,
  serializeImpactDocument,
  type ImpactDocument,
} from '../impact/index.js';
import { hashContent } from '../model/hashing.js';
import { createStableId } from '../model/ids.js';
import {
  analysisHasInteractionFacts,
  analysisHasResourceAccessFacts,
  type AnalysisDocument,
  type EndpointTraceStep,
  type InteractionHandlerTraceView,
} from '../model/analysis.js';
import { assertValidAnalysisDocument } from '../evidence/validate.js';
import { resourceAccessLabel } from '../model/resource-access.js';
import { serializeCanonicalAnalysis } from '../model/ordering.js';
import {
  makeSystemReportEdgeId,
  makeSystemReportNodeId,
  systemCorrelationHasDeclaredRealmCandidate,
  validateSystemAnalysisDocument,
  type SystemAnalysisDocument,
  type SystemInteractionEndpointRecord,
} from '../system-analysis/index.js';
import { buildEndpointTrace } from '../tracing/endpoint-trace.js';
import { buildInteractionHandlerTrace } from '../tracing/interaction-handler-trace.js';
import { selectJobQueueBranches } from '../tracing/job-queue-branch-selection.js';
import { analysisHasJobQueueBranchFacts } from '../model/analysis.js';
import { makeSystemImpactId, systemBrokerRealmImpactKey, systemEndpointImpactKey } from './ids.js';
import {
  SYSTEM_IMPACT_SCHEMA_V2_VERSION,
  type PropagateConditionalSystemImpactInput,
  type SystemDistributedImpactEffect,
  type SystemDistributedImpactHop,
  type SystemDistributedImpactPath,
  type SystemDistributedImpactSeed,
  type SystemImpactDocumentV1,
  type SystemImpactDocumentV2,
  type SystemImpactGraphEdgeKind,
  type SystemImpactGraphNodeKind,
  type SystemImpactGraphOverlay,
  type SystemImpactGraphOverlayEdge,
  type SystemImpactGraphOverlayNode,
  type SystemImpactInputSnapshot,
  type SystemImpactPropagationSideInput,
} from './model.js';
import { assertValidSystemImpactDocument } from './validate.js';

export const DEFAULT_SYSTEM_IMPACT_PROPAGATION_LIMITS = {
  maxHops: 4,
  maxPaths: 200,
  maxEffectsPerPath: 64,
  maxTraversalStates: 1_000,
} as const;

export const MAX_SYSTEM_IMPACT_PROPAGATION_LIMITS = {
  maxHops: 16,
  maxPaths: 2_000,
  maxEffectsPerPath: 500,
  maxTraversalStates: 20_000,
} as const;

export interface SystemImpactPropagationIssue {
  readonly path: string;
  readonly message: string;
}

export class SystemImpactPropagationError extends Error {
  readonly issues: readonly SystemImpactPropagationIssue[];

  constructor(issues: readonly SystemImpactPropagationIssue[]) {
    super(`System impact propagation input is invalid with ${issues.length} issue(s).`);
    this.name = 'SystemImpactPropagationError';
    this.issues = issues;
  }
}

interface SideContext {
  readonly side: 'before' | 'after';
  readonly snapshot: SystemImpactInputSnapshot;
  readonly system: SystemAnalysisDocument | null;
  readonly analysesByNamespace: ReadonlyMap<string, AnalysisDocument>;
  readonly serviceNamespaceById: ReadonlyMap<string, string>;
  readonly endpointById: ReadonlyMap<string, SystemInteractionEndpointRecord>;
  readonly endpointBySourceRecord: ReadonlyMap<string, SystemInteractionEndpointRecord>;
  readonly correlationsByProducerId: ReadonlyMap<
    string,
    readonly SystemAnalysisDocument['correlations'][number][]
  >;
}

interface LocalImpactContext {
  readonly namespace: string;
  readonly impact: ImpactDocument;
  readonly fingerprint: string;
}

interface TraversalState {
  readonly seed: SystemDistributedImpactSeed;
  readonly producerEndpointId: string;
  readonly hops: readonly SystemDistributedImpactHop[];
  readonly visitedProducerEndpointIds: ReadonlySet<string>;
  readonly producerInitiationAssertionIds: readonly string[];
  readonly producerInitiationEvidenceIds: readonly string[];
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function endpointContractLabel(endpoint: SystemInteractionEndpointRecord): string {
  return endpoint.contract.targetKind === 'job_queue'
    ? `${endpoint.contract.technology} ${endpoint.contract.queue ?? '<dynamic>'} / ${endpoint.contract.job ?? '<queue-wide or dynamic>'}`
    : `${endpoint.contract.mode.replace('_', ' ')} ${endpoint.contract.canonicalPattern ?? '<dynamic>'}`;
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareStrings);
}

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return normalized;
}

function availableNamespaces(snapshot: SystemImpactInputSnapshot): string[] {
  return snapshot.services
    .filter(({ state }) => state === 'available')
    .map(({ namespace }) => namespace)
    .sort(compareStrings);
}

function prepareSide(
  side: 'before' | 'after',
  snapshot: SystemImpactInputSnapshot,
  input: SystemImpactPropagationSideInput,
  issues: SystemImpactPropagationIssue[],
): SideContext {
  let system: SystemAnalysisDocument | null = null;
  if (input.system !== null) {
    const result = validateSystemAnalysisDocument(input.system);
    if (!result.success) {
      issues.push({
        path: `${side}.system`,
        message: `System analysis failed integrity validation (${result.issues.length} issue(s)).`,
      });
    } else {
      system = result.data;
    }
  }
  if ((snapshot.systemAnalysisId === null) !== (system === null)) {
    issues.push({
      path: `${side}.system`,
      message: 'System artifact presence must match the P4.1 input snapshot.',
    });
  }
  if (system !== null && system.systemId !== snapshot.systemAnalysisId) {
    issues.push({
      path: `${side}.system.systemId`,
      message: `Expected ${snapshot.systemAnalysisId}, received ${system.systemId}.`,
    });
  }

  const analysesByNamespace = new Map<string, AnalysisDocument>();
  for (const [index, service] of input.services.entries()) {
    if (analysesByNamespace.has(service.namespace)) {
      issues.push({
        path: `${side}.services.${index}.namespace`,
        message: `Service namespace ${service.namespace} is repeated.`,
      });
      continue;
    }
    try {
      analysesByNamespace.set(service.namespace, assertValidAnalysisDocument(service.analysis));
    } catch {
      issues.push({
        path: `${side}.services.${index}.analysis`,
        message: 'Source analysis failed integrity validation.',
      });
    }
  }
  const expected = availableNamespaces(snapshot);
  const actual = [...analysesByNamespace.keys()].sort(compareStrings);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    issues.push({
      path: `${side}.services`,
      message: 'Source artifacts must contain exactly every service observed as available.',
    });
  }
  for (const serviceSnapshot of snapshot.services) {
    if (serviceSnapshot.state !== 'available') continue;
    const analysis = analysesByNamespace.get(serviceSnapshot.namespace);
    if (analysis === undefined) continue;
    if (
      analysis.analysisRun.id !== serviceSnapshot.analysisId ||
      analysis.schemaVersion !== serviceSnapshot.analysisSchemaVersion ||
      analysis.resultState !== serviceSnapshot.analysisResultState
    ) {
      issues.push({
        path: `${side}.services.${serviceSnapshot.namespace}`,
        message: 'Source artifact identity, schema, or result state differs from P4.1 provenance.',
      });
    }
  }

  if (system !== null) {
    const systemServiceByNamespace = new Map(
      system.services.map((service) => [service.namespace, service]),
    );
    for (const [namespace, analysis] of analysesByNamespace) {
      const systemService = systemServiceByNamespace.get(namespace);
      if (
        systemService === undefined ||
        systemService.analysisId !== analysis.analysisRun.id ||
        systemService.analysisSchemaVersion !== analysis.schemaVersion ||
        systemService.analysisResultState !== analysis.resultState
      ) {
        issues.push({
          path: `${side}.services.${namespace}`,
          message: 'Source artifact does not agree with the system service provenance.',
        });
        continue;
      }
      if (!analysisHasInteractionFacts(analysis)) {
        issues.push({
          path: `${side}.services.${namespace}.analysis`,
          message: 'Conditional propagation requires interaction-capable source artifacts.',
        });
        continue;
      }
      const expectedRecords = system.interactionEndpoints
        .filter(({ serviceId }) => serviceId === systemService.id)
        .map(({ role, analysisRecord }) => `${role}:${analysisRecord.analysisRecordId}`)
        .sort(compareStrings);
      const actualRecords = [
        ...analysis.interactions
          .filter(({ kind }) => kind === 'job_queue' || kind === 'microservice_message')
          .map(({ id }) => `producer:${id}`),
        ...analysis.interactionHandlers
          .filter(({ kind }) => kind === 'job_queue' || kind === 'microservice_message')
          .map(({ id }) => `consumer:${id}`),
      ].sort(compareStrings);
      if (JSON.stringify(expectedRecords) !== JSON.stringify(actualRecords)) {
        issues.push({
          path: `${side}.services.${namespace}.analysis`,
          message: 'Source distributed records do not agree with the supplied system snapshot.',
        });
      }
    }
  }

  const serviceNamespaceById = new Map(
    (system?.services ?? []).map((service) => [service.id, service.namespace]),
  );
  const endpointById = new Map(
    (system?.interactionEndpoints ?? []).map((endpoint) => [endpoint.id, endpoint]),
  );
  const endpointBySourceRecord = new Map<string, SystemInteractionEndpointRecord>();
  for (const endpoint of system?.interactionEndpoints ?? []) {
    const namespace = serviceNamespaceById.get(endpoint.serviceId);
    if (namespace === undefined) continue;
    endpointBySourceRecord.set(
      JSON.stringify([namespace, endpoint.role, endpoint.analysisRecord.analysisRecordId]),
      endpoint,
    );
  }
  const correlationsByProducerId = new Map<
    string,
    SystemAnalysisDocument['correlations'][number][]
  >();
  for (const correlation of system?.correlations ?? []) {
    if (!systemCorrelationHasDeclaredRealmCandidate(correlation)) continue;
    correlationsByProducerId.set(correlation.producerEndpointId, [
      ...(correlationsByProducerId.get(correlation.producerEndpointId) ?? []),
      correlation,
    ]);
  }
  for (const correlations of correlationsByProducerId.values()) {
    correlations.sort((left, right) => left.id.localeCompare(right.id));
  }
  return {
    side,
    snapshot,
    system,
    analysesByNamespace,
    serviceNamespaceById,
    endpointById,
    endpointBySourceRecord,
    correlationsByProducerId,
  };
}

function deriveLocalImpacts(before: SideContext, after: SideContext): LocalImpactContext[] {
  const results: LocalImpactContext[] = [];
  for (const namespace of [...before.analysesByNamespace.keys()].sort(compareStrings)) {
    const beforeAnalysis = before.analysesByNamespace.get(namespace)!;
    const afterAnalysis = after.analysesByNamespace.get(namespace);
    if (afterAnalysis === undefined) continue;
    const impact = analyzePotentialImpact(beforeAnalysis, afterAnalysis);
    results.push({
      namespace,
      impact,
      fingerprint: hashContent(serializeImpactDocument(impact)),
    });
  }
  return results;
}

function seedId(parts: readonly (string | boolean | null)[]): string {
  return createStableId('system_impact_seed', parts);
}

function pathId(input: Omit<SystemDistributedImpactPath, 'id'>): string {
  return createStableId('system_impact_path', [
    input.side,
    input.seedId,
    ...input.hops.flatMap((hop) => [hop.correlationId, hop.consumerEndpointId]),
    ...input.effects.map(({ id }) => id).sort(compareStrings),
    input.truncation,
    input.truncatedAtProducerEndpointId,
  ]);
}

function sourceInteractionEvidence(
  context: SideContext,
  endpoint: SystemInteractionEndpointRecord,
): readonly string[] {
  const namespace = context.serviceNamespaceById.get(endpoint.serviceId);
  const analysis = namespace === undefined ? undefined : context.analysesByNamespace.get(namespace);
  if (analysis === undefined || !analysisHasInteractionFacts(analysis)) return [];
  return (
    analysis.interactions.find(({ id }) => id === endpoint.analysisRecord.analysisRecordId)
      ?.evidenceIds ?? []
  );
}

function endpointProducerIds(
  context: SideContext,
  namespace: string,
  analysis: AnalysisDocument,
  endpointId: string,
): {
  readonly producerIds: readonly string[];
  readonly assertionIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly diagnosticIds: readonly string[];
} {
  const endpoint = analysis.endpoints.find(({ id }) => id === endpointId);
  if (endpoint === undefined)
    return { producerIds: [], assertionIds: [], evidenceIds: [], diagnosticIds: [] };
  const result = buildEndpointTrace(analysis, {
    httpMethod: endpoint.httpMethod,
    path: endpoint.path,
  });
  if (result.status !== 'resolved')
    return { producerIds: [], assertionIds: [], evidenceIds: [], diagnosticIds: [] };
  const interactionIds = result.trace.steps
    .filter(
      ({ relation, toId, status }) =>
        relation === 'METHOD_INITIATES_INTERACTION' &&
        toId !== null &&
        (status === 'resolved' || status === 'ambiguous'),
    )
    .map(({ toId }) => toId!);
  const producerIds = sortedUnique(
    interactionIds.flatMap((analysisRecordId) => {
      const candidate = context.endpointBySourceRecord.get(
        JSON.stringify([namespace, 'producer', analysisRecordId]),
      );
      return candidate === undefined || !context.correlationsByProducerId.has(candidate.id)
        ? []
        : [candidate.id];
    }),
  );
  return {
    producerIds,
    assertionIds: sortedUnique(
      result.trace.steps.map(({ fromId, relation, toId, ruleId }) =>
        createStableId('assertion', [fromId, relation, toId, ruleId]),
      ),
    ),
    evidenceIds: sortedUnique(result.trace.steps.flatMap(({ evidenceIds }) => evidenceIds)),
    diagnosticIds: result.trace.diagnosticIds,
  };
}

function localImpactSeeds(
  context: SideContext,
  locals: readonly LocalImpactContext[],
): { readonly seed: SystemDistributedImpactSeed; readonly producerIds: readonly string[] }[] {
  const output: { seed: SystemDistributedImpactSeed; producerIds: readonly string[] }[] = [];
  for (const local of locals) {
    const analysis = context.analysesByNamespace.get(local.namespace);
    if (analysis === undefined) continue;
    for (const endpointImpact of local.impact.impactedEndpoints) {
      const endpointIds =
        context.side === 'before'
          ? endpointImpact.beforeEndpointIds
          : endpointImpact.afterEndpointIds;
      for (const endpointId of endpointIds) {
        const reached = endpointProducerIds(context, local.namespace, analysis, endpointId);
        if (reached.producerIds.length === 0) continue;
        const reasons = endpointImpact.reasons.filter((reason) =>
          reason.paths.some((path) => path.side === context.side && path.endpointId === endpointId),
        );
        const sourcePaths = new Set(
          reasons.flatMap(({ sourceChangePath }) =>
            sourceChangePath === null ? [] : [sourceChangePath],
          ),
        );
        const sourceChangeKinds = local.impact.sourceChanges
          .filter(({ path }) => sourcePaths.has(path))
          .map(({ change }) => change);
        const reasonAssertionIds = reasons.flatMap(({ paths }) =>
          paths
            .filter((path) => path.side === context.side && path.endpointId === endpointId)
            .flatMap(({ steps }) => steps.map(({ assertionId }) => assertionId)),
        );
        const reasonEvidenceIds = reasons.flatMap((reason) => [
          ...(context.side === 'before' ? reason.beforeEvidenceIds : reason.afterEvidenceIds),
          ...reason.paths
            .filter((path) => path.side === context.side && path.endpointId === endpointId)
            .flatMap(({ steps }) => steps.flatMap(({ evidenceIds }) => evidenceIds)),
        ]);
        const key = JSON.stringify([
          'impact_seed',
          context.side,
          local.namespace,
          'http_endpoint',
          endpointId,
        ]);
        const base = {
          key,
          side: context.side,
          kind: 'impacted_http_endpoint' as const,
          serviceNamespace: local.namespace,
          sourceAnalysisId: analysis.analysisRun.id,
          endpointId,
          producerEndpointKey: null,
          localImpactFingerprint: local.fingerprint,
          producerChangeKind: null,
          sourceChangeKinds: sortedUnique(sourceChangeKinds),
          reasonCodes: sortedUnique(reasons.map(({ reasonCode }) => reasonCode)),
          direct: endpointImpact.direct,
          assertionIds: sortedUnique([...reached.assertionIds, ...reasonAssertionIds]),
          evidenceIds: sortedUnique([...reached.evidenceIds, ...reasonEvidenceIds]),
        };
        output.push({
          seed: { ...base, id: seedId([context.side, key, local.fingerprint]) },
          producerIds: reached.producerIds,
        });
      }
    }
  }
  return output;
}

function changedProducerSeeds(
  comparison: SystemImpactDocumentV1,
  context: SideContext,
): { readonly seed: SystemDistributedImpactSeed; readonly producerIds: readonly string[] }[] {
  const output: { seed: SystemDistributedImpactSeed; producerIds: readonly string[] }[] = [];
  for (const change of comparison.producerChanges) {
    const snapshot = context.side === 'before' ? change.before : change.after;
    if (snapshot === null || !context.correlationsByProducerId.has(snapshot.endpointId)) continue;
    const analysis = context.analysesByNamespace.get(snapshot.serviceNamespace);
    const endpoint = context.endpointById.get(snapshot.endpointId);
    if (analysis === undefined || endpoint === undefined) continue;
    const key = JSON.stringify([
      'impact_seed',
      context.side,
      snapshot.serviceNamespace,
      'producer_change',
      change.key,
    ]);
    const evidenceIds = sourceInteractionEvidence(context, endpoint);
    output.push({
      seed: {
        id: seedId([context.side, key, change.changeKind]),
        key,
        side: context.side,
        kind: 'changed_producer',
        serviceNamespace: snapshot.serviceNamespace,
        sourceAnalysisId: analysis.analysisRun.id,
        endpointId: null,
        producerEndpointKey: snapshot.key,
        localImpactFingerprint: null,
        producerChangeKind: change.changeKind,
        sourceChangeKinds: [],
        reasonCodes: [],
        direct: null,
        assertionIds: [],
        evidenceIds: sortedUnique(evidenceIds),
      },
      producerIds: [snapshot.endpointId],
    });
  }
  return output;
}

function shortestTraceAssertions(
  trace: InteractionHandlerTraceView,
  targetMethodId: string,
): EndpointTraceStep[] {
  const outgoing = new Map<string, EndpointTraceStep[]>();
  for (const step of trace.steps) {
    if (
      step.toId === null ||
      (step.status !== 'resolved' && step.status !== 'ambiguous') ||
      ![
        'HANDLER_IMPLEMENTED_BY',
        'METHOD_CALLS_METHOD',
        'METHOD_INITIATES_INTERACTION',
        'INTERACTION_MATCHES_LOCAL_HANDLER',
      ].includes(step.relation)
    ) {
      continue;
    }
    outgoing.set(step.fromId, [...(outgoing.get(step.fromId) ?? []), step]);
  }
  for (const values of outgoing.values()) {
    values.sort((left, right) =>
      `${left.toId}:${left.ruleId}`.localeCompare(`${right.toId}:${right.ruleId}`),
    );
  }
  const queue: { id: string; path: EndpointTraceStep[]; visited: ReadonlySet<string> }[] = [
    { id: trace.handler.id, path: [], visited: new Set([trace.handler.id]) },
  ];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor]!;
    if (state.id === targetMethodId) return state.path;
    for (const step of outgoing.get(state.id) ?? []) {
      if (state.visited.has(step.toId!)) continue;
      queue.push({
        id: step.toId!,
        path: [...state.path, step],
        visited: new Set([...state.visited, step.toId!]),
      });
    }
  }
  return [];
}

function assertionForTerminal(
  trace: InteractionHandlerTraceView,
  methodId: string,
  predicate: 'METHOD_READS_TABLE' | 'METHOD_WRITES_TABLE' | 'METHOD_ACCESSES_RESOURCE',
  targetId: string,
): EndpointTraceStep | undefined {
  return trace.steps.find(
    (step) => step.fromId === methodId && step.relation === predicate && step.toId === targetId,
  );
}

function effectsForHandler(input: {
  readonly namespace: string;
  readonly analysis: AnalysisDocument;
  readonly trace: InteractionHandlerTraceView;
  readonly allowedBranchAssertionIds: ReadonlySet<string> | null;
}): SystemDistributedImpactEffect[] {
  const effects: SystemDistributedImpactEffect[] = [];
  const distributedInteractionIds = new Set(
    analysisHasInteractionFacts(input.analysis)
      ? input.analysis.interactions
          .filter(({ kind }) => kind === 'job_queue' || kind === 'microservice_message')
          .map(({ id }) => id)
      : [],
  );
  const provenLocalPath = (path: readonly EndpointTraceStep[]): boolean =>
    !path.some(
      (step) =>
        step.relation === 'INTERACTION_MATCHES_LOCAL_HANDLER' &&
        distributedInteractionIds.has(step.fromId),
    );
  const selectedBranchPath = (
    path: readonly EndpointTraceStep[],
    terminalAssertion: EndpointTraceStep | undefined,
  ): boolean => {
    if (input.allowedBranchAssertionIds === null) return true;
    const ids = [
      ...path.map(({ fromId, relation, toId, ruleId }) =>
        createStableId('assertion', [fromId, relation, toId, ruleId]),
      ),
      ...(terminalAssertion === undefined
        ? []
        : [
            createStableId('assertion', [
              terminalAssertion.fromId,
              terminalAssertion.relation,
              terminalAssertion.toId,
              terminalAssertion.ruleId,
            ]),
          ]),
    ];
    return ids.some((id) => input.allowedBranchAssertionIds!.has(id));
  };
  for (const terminal of input.trace.terminals) {
    const terminalAssertion = assertionForTerminal(
      input.trace,
      terminal.methodId,
      terminal.direction === 'READ' ? 'METHOD_READS_TABLE' : 'METHOD_WRITES_TABLE',
      terminal.tableId,
    );
    const path = shortestTraceAssertions(input.trace, terminal.methodId);
    if (path.length === 0 || !provenLocalPath(path) || !selectedBranchPath(path, terminalAssertion))
      continue;
    const key = JSON.stringify([
      'distributed_effect',
      input.namespace,
      'table',
      terminal.methodId,
      terminal.direction,
      terminal.tableId,
    ]);
    const base = {
      key,
      kind: 'table' as const,
      serviceNamespace: input.namespace,
      analysisRecordId: terminal.tableId,
      methodId: terminal.methodId,
      label: `${terminal.direction} table ${terminal.tableName}`,
      direction: terminal.direction,
      technology: null,
      operation: null,
      causalClass: 'distributed_conditional' as const,
      assertionIds: sortedUnique([
        ...path.map(({ fromId, relation, toId, ruleId }) =>
          createStableId('assertion', [fromId, relation, toId, ruleId]),
        ),
        ...(terminalAssertion === undefined
          ? []
          : [
              createStableId('assertion', [
                terminalAssertion.fromId,
                terminalAssertion.relation,
                terminalAssertion.toId,
                terminalAssertion.ruleId,
              ]),
            ]),
      ]),
      evidenceIds: sortedUnique([
        ...path.flatMap(({ evidenceIds }) => evidenceIds),
        ...(terminalAssertion?.evidenceIds ?? []),
      ]),
    };
    effects.push({
      ...base,
      id: createStableId('system_impact_effect', [key]),
    } as SystemDistributedImpactEffect);
  }
  if (analysisHasResourceAccessFacts(input.analysis)) {
    const resources = new Map(input.analysis.resourceAccesses.map((record) => [record.id, record]));
    for (const terminal of input.trace.resourceTerminals ?? []) {
      const record = resources.get(terminal.resourceAccessId);
      if (record === undefined) continue;
      const terminalAssertion = assertionForTerminal(
        input.trace,
        terminal.methodId,
        'METHOD_ACCESSES_RESOURCE',
        terminal.resourceAccessId,
      );
      const path = shortestTraceAssertions(input.trace, terminal.methodId);
      if (
        path.length === 0 ||
        !provenLocalPath(path) ||
        !selectedBranchPath(path, terminalAssertion)
      )
        continue;
      const key = JSON.stringify([
        'distributed_effect',
        input.namespace,
        'resource',
        terminal.methodId,
        terminal.resourceAccessId,
      ]);
      effects.push({
        id: createStableId('system_impact_effect', [key]),
        key,
        kind: 'resource',
        serviceNamespace: input.namespace,
        analysisRecordId: terminal.resourceAccessId,
        methodId: terminal.methodId,
        label: resourceAccessLabel(record),
        direction: null,
        technology: terminal.technology,
        operation: terminal.operation,
        causalClass: 'distributed_conditional',
        assertionIds: sortedUnique([
          ...path.map(({ fromId, relation, toId, ruleId }) =>
            createStableId('assertion', [fromId, relation, toId, ruleId]),
          ),
          ...(terminalAssertion === undefined
            ? []
            : [
                createStableId('assertion', [
                  terminalAssertion.fromId,
                  terminalAssertion.relation,
                  terminalAssertion.toId,
                  terminalAssertion.ruleId,
                ]),
              ]),
        ]),
        evidenceIds: sortedUnique([
          ...path.flatMap(({ evidenceIds }) => evidenceIds),
          ...(terminalAssertion?.evidenceIds ?? []),
          ...record.evidenceIds,
        ]),
      });
    }
  }
  return effects.sort((left, right) => left.id.localeCompare(right.id));
}

function outboundProducerIds(
  context: SideContext,
  namespace: string,
  trace: InteractionHandlerTraceView,
  allowedBranchAssertionIds: ReadonlySet<string> | null,
): {
  readonly producerEndpointId: string;
  readonly assertionIds: readonly string[];
  readonly evidenceIds: readonly string[];
}[] {
  const analysis = context.analysesByNamespace.get(namespace);
  if (analysis === undefined || !analysisHasInteractionFacts(analysis)) return [];
  const distributedInteractionIds = new Set(
    analysis.interactions
      .filter(({ kind }) => kind === 'job_queue' || kind === 'microservice_message')
      .map(({ id }) => id),
  );
  const links = new Map<
    string,
    { producerEndpointId: string; assertionIds: string[]; evidenceIds: string[] }
  >();
  for (const step of trace.steps) {
    if (
      step.relation !== 'METHOD_INITIATES_INTERACTION' ||
      step.toId === null ||
      (step.status !== 'resolved' && step.status !== 'ambiguous')
    ) {
      continue;
    }
    const path = shortestTraceAssertions(trace, step.fromId);
    if (
      path.length === 0 ||
      path.some(
        (candidate) =>
          candidate.relation === 'INTERACTION_MATCHES_LOCAL_HANDLER' &&
          distributedInteractionIds.has(candidate.fromId),
      )
    ) {
      continue;
    }
    const assertionIds = [
      ...path.map(({ fromId, relation, toId, ruleId }) =>
        createStableId('assertion', [fromId, relation, toId, ruleId]),
      ),
      createStableId('assertion', [step.fromId, step.relation, step.toId, step.ruleId]),
    ];
    if (allowedBranchAssertionIds !== null) {
      if (!assertionIds.some((id) => allowedBranchAssertionIds.has(id))) continue;
    }
    const endpoint = context.endpointBySourceRecord.get(
      JSON.stringify([namespace, 'producer', step.toId]),
    );
    if (endpoint === undefined || !context.correlationsByProducerId.has(endpoint.id)) continue;
    const prior = links.get(endpoint.id);
    links.set(endpoint.id, {
      producerEndpointId: endpoint.id,
      assertionIds: sortedUnique([...(prior?.assertionIds ?? []), ...assertionIds]),
      evidenceIds: sortedUnique([
        ...(prior?.evidenceIds ?? []),
        ...path.flatMap(({ evidenceIds }) => evidenceIds),
        ...step.evidenceIds,
      ]),
    });
  }
  return [...links.values()].sort((left, right) =>
    left.producerEndpointId.localeCompare(right.producerEndpointId),
  );
}

function appendPendingInitiation(
  hops: readonly SystemDistributedImpactHop[],
  assertionIds: readonly string[],
  evidenceIds: readonly string[],
): readonly SystemDistributedImpactHop[] {
  if (hops.length === 0 || (assertionIds.length === 0 && evidenceIds.length === 0)) return hops;
  return hops.map((hop, index) =>
    index !== hops.length - 1
      ? hop
      : {
          ...hop,
          assertionIds: sortedUnique([...hop.assertionIds, ...assertionIds]),
          evidenceIds: sortedUnique([...hop.evidenceIds, ...evidenceIds]),
        },
  );
}

function createPath(input: Omit<SystemDistributedImpactPath, 'id'>): SystemDistributedImpactPath {
  return { ...input, id: pathId(input) };
}

function propagateSide(input: {
  readonly comparison: SystemImpactDocumentV1;
  readonly context: SideContext;
  readonly locals: readonly LocalImpactContext[];
  readonly limits: SystemImpactDocumentV2['propagation']['limits'];
}): {
  readonly seeds: readonly SystemDistributedImpactSeed[];
  readonly paths: readonly SystemDistributedImpactPath[];
  readonly pathsOmitted: number;
  readonly effectsOmitted: number;
  readonly stateLimitReached: boolean;
  readonly traversalStates: number;
} {
  if (input.context.system === null) {
    return {
      seeds: [],
      paths: [],
      pathsOmitted: 0,
      effectsOmitted: 0,
      stateLimitReached: false,
      traversalStates: 0,
    };
  }
  const seedCandidates = [
    ...localImpactSeeds(input.context, input.locals),
    ...changedProducerSeeds(input.comparison, input.context),
  ].sort((left, right) => left.seed.id.localeCompare(right.seed.id));
  const seedsById = new Map<string, SystemDistributedImpactSeed>();
  const paths = new Map<string, SystemDistributedImpactPath>();
  const queue: TraversalState[] = [];
  for (const candidate of seedCandidates) {
    seedsById.set(candidate.seed.id, candidate.seed);
    for (const producerEndpointId of candidate.producerIds) {
      queue.push({
        seed: candidate.seed,
        producerEndpointId,
        hops: [],
        visitedProducerEndpointIds: new Set([producerEndpointId]),
        producerInitiationAssertionIds: [],
        producerInitiationEvidenceIds: [],
      });
    }
  }
  queue.sort((left, right) =>
    `${left.seed.id}:${left.producerEndpointId}`.localeCompare(
      `${right.seed.id}:${right.producerEndpointId}`,
    ),
  );

  let traversalStates = 0;
  let pathsOmitted = 0;
  let effectsOmitted = 0;
  let stateLimitReached = false;
  const addPath = (path: SystemDistributedImpactPath): void => {
    if (paths.has(path.id)) return;
    if (paths.size >= input.limits.maxPaths) {
      pathsOmitted += 1;
      return;
    }
    paths.set(path.id, path);
  };

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (traversalStates >= input.limits.maxTraversalStates) {
      stateLimitReached = true;
      pathsOmitted += queue.length - cursor;
      break;
    }
    traversalStates += 1;
    const state = queue[cursor]!;
    if (state.hops.length >= input.limits.maxHops) {
      addPath(
        createPath({
          side: input.context.side,
          seedId: state.seed.id,
          hops: appendPendingInitiation(
            state.hops,
            state.producerInitiationAssertionIds,
            state.producerInitiationEvidenceIds,
          ),
          effects: [],
          completeness: 'incomplete',
          truncation: 'hop_limit',
          truncatedAtProducerEndpointId: state.producerEndpointId,
          diagnosticIds: [],
        }),
      );
      continue;
    }
    const producer = input.context.endpointById.get(state.producerEndpointId);
    if (producer === undefined) continue;
    const producerNamespace = input.context.serviceNamespaceById.get(producer.serviceId);
    if (producerNamespace === undefined) continue;
    for (const correlation of input.context.correlationsByProducerId.get(producer.id) ?? []) {
      if (!systemCorrelationHasDeclaredRealmCandidate(correlation)) continue;
      for (const consumerId of [...correlation.consumerEndpointIds].sort(compareStrings)) {
        if (traversalStates >= input.limits.maxTraversalStates) {
          stateLimitReached = true;
          pathsOmitted += 1;
          break;
        }
        traversalStates += 1;
        const consumer = input.context.endpointById.get(consumerId);
        if (consumer === undefined) continue;
        const consumerNamespace = input.context.serviceNamespaceById.get(consumer.serviceId);
        const consumerAnalysis =
          consumerNamespace === undefined
            ? undefined
            : input.context.analysesByNamespace.get(consumerNamespace);
        if (consumerNamespace === undefined || consumerAnalysis === undefined) continue;
        const built = buildInteractionHandlerTrace(
          consumerAnalysis,
          consumer.analysisRecord.analysisRecordId,
        );
        if (built.status !== 'resolved') continue;
        const implementationSteps = built.trace.steps.filter(
          ({ relation }) => relation === 'HANDLER_IMPLEMENTED_BY',
        );
        let allowedBranchAssertionIds: ReadonlySet<string> | null = null;
        if (
          analysisHasJobQueueBranchFacts(consumerAnalysis) &&
          producer.contract.targetKind === 'job_queue'
        ) {
          const producerJob =
            producer.contract.job === null
              ? null
              : ({ resolution: 'exact', value: producer.contract.job } as const);
          const selection =
            producerJob === null
              ? null
              : selectJobQueueBranches({
                  analysis: consumerAnalysis,
                  handlerId: consumer.analysisRecord.analysisRecordId,
                  producerJob,
                });
          allowedBranchAssertionIds = selection?.sourceAssertionIds ?? null;
        }
        const hop: SystemDistributedImpactHop = {
          index: state.hops.length,
          correlationId: correlation.id,
          correlationState: 'declared_realm_candidate',
          producerEndpointId: producer.id,
          producerEndpointKey: systemEndpointImpactKey({
            serviceNamespace: producerNamespace,
            role: 'producer',
            analysisRecordId: producer.analysisRecord.analysisRecordId,
          }),
          producerServiceNamespace: producerNamespace,
          producerAnalysisRecordId: producer.analysisRecord.analysisRecordId,
          brokerRealmId: correlation.brokerRealmId,
          brokerRealmKey: systemBrokerRealmImpactKey(
            input.context.system.brokerRealms.find(({ id }) => id === correlation.brokerRealmId)!,
          ),
          consumerEndpointId: consumer.id,
          consumerEndpointKey: systemEndpointImpactKey({
            serviceNamespace: consumerNamespace,
            role: 'consumer',
            analysisRecordId: consumer.analysisRecord.analysisRecordId,
          }),
          consumerServiceNamespace: consumerNamespace,
          consumerAnalysisRecordId: consumer.analysisRecord.analysisRecordId,
          assertionIds: sortedUnique([
            ...state.producerInitiationAssertionIds,
            ...implementationSteps.map(({ fromId, relation, toId, ruleId }) =>
              createStableId('assertion', [fromId, relation, toId, ruleId]),
            ),
          ]),
          evidenceIds: sortedUnique([
            ...state.producerInitiationEvidenceIds,
            ...sourceInteractionEvidence(input.context, producer),
            ...implementationSteps.flatMap(({ evidenceIds }) => evidenceIds),
            ...(analysisHasInteractionFacts(consumerAnalysis)
              ? consumerAnalysis.interactionHandlers.find(
                  ({ id }) => id === consumer.analysisRecord.analysisRecordId,
                )?.handlerEvidenceId === undefined
                ? []
                : [
                    consumerAnalysis.interactionHandlers.find(
                      ({ id }) => id === consumer.analysisRecord.analysisRecordId,
                    )!.handlerEvidenceId,
                  ]
              : []),
          ]),
        };
        const allEffects = effectsForHandler({
          namespace: consumerNamespace,
          analysis: consumerAnalysis,
          trace: built.trace,
          allowedBranchAssertionIds,
        });
        const effects = allEffects.slice(0, input.limits.maxEffectsPerPath);
        effectsOmitted += allEffects.length - effects.length;
        const hops = [...state.hops, hop];
        const incomplete =
          built.trace.diagnosticIds.length > 0 ||
          built.trace.steps.some(({ status }) => status !== 'resolved') ||
          allEffects.length > effects.length;
        addPath(
          createPath({
            side: input.context.side,
            seedId: state.seed.id,
            hops,
            effects,
            completeness: incomplete ? 'incomplete' : 'complete',
            truncation: 'none',
            truncatedAtProducerEndpointId: null,
            diagnosticIds: sortedUnique(built.trace.diagnosticIds),
          }),
        );

        for (const nextProducer of outboundProducerIds(
          input.context,
          consumerNamespace,
          built.trace,
          allowedBranchAssertionIds,
        )) {
          const nextProducerId = nextProducer.producerEndpointId;
          if (state.visitedProducerEndpointIds.has(nextProducerId)) {
            addPath(
              createPath({
                side: input.context.side,
                seedId: state.seed.id,
                hops: appendPendingInitiation(
                  hops,
                  nextProducer.assertionIds,
                  nextProducer.evidenceIds,
                ),
                effects: [],
                completeness: 'incomplete',
                truncation: 'cycle',
                truncatedAtProducerEndpointId: nextProducerId,
                diagnosticIds: sortedUnique(built.trace.diagnosticIds),
              }),
            );
            continue;
          }
          queue.push({
            seed: state.seed,
            producerEndpointId: nextProducerId,
            hops,
            visitedProducerEndpointIds: new Set([
              ...state.visitedProducerEndpointIds,
              nextProducerId,
            ]),
            producerInitiationAssertionIds: nextProducer.assertionIds,
            producerInitiationEvidenceIds: nextProducer.evidenceIds,
          });
        }
      }
    }
  }

  const retainedSeedIds = new Set([...paths.values()].map(({ seedId }) => seedId));
  return {
    seeds: [...seedsById.values()]
      .filter(({ id }) => retainedSeedIds.has(id))
      .sort((left, right) => left.id.localeCompare(right.id)),
    paths: [...paths.values()].sort((left, right) => left.id.localeCompare(right.id)),
    pathsOmitted,
    effectsOmitted,
    stateLimitReached,
    traversalStates,
  };
}

function buildOverlay(
  context: SideContext,
  seeds: ReadonlyMap<string, SystemDistributedImpactSeed>,
  paths: readonly SystemDistributedImpactPath[],
): SystemImpactGraphOverlay | null {
  if (context.system === null) return null;
  const nodes = new Map<string, SystemImpactGraphOverlayNode>();
  const edges = new Map<string, SystemImpactGraphOverlayEdge>();
  const addNode = (
    input: Omit<SystemImpactGraphOverlayNode, 'pathIds' | 'effectIds'>,
    pathIdValue: string,
    effectId?: string,
  ): void => {
    const prior = nodes.get(input.nodeId);
    nodes.set(input.nodeId, {
      ...input,
      pathIds: sortedUnique([...(prior?.pathIds ?? []), pathIdValue]),
      effectIds: sortedUnique([
        ...(prior?.effectIds ?? []),
        ...(effectId === undefined ? [] : [effectId]),
      ]),
    });
  };
  const addEdge = (
    edgeId: string,
    source: string,
    target: string,
    kind: SystemImpactGraphEdgeKind,
    pathIdValue: string,
  ): void => {
    const prior = edges.get(edgeId);
    edges.set(edgeId, {
      edgeId,
      source,
      target,
      kind,
      pathIds: sortedUnique([...(prior?.pathIds ?? []), pathIdValue]),
      classification: 'distributed_conditional',
    });
  };
  const serviceByNamespace = new Map(
    context.system.services.map((service) => [service.namespace, service]),
  );
  const realmById = new Map(context.system.brokerRealms.map((realm) => [realm.id, realm]));
  for (const path of paths) {
    const seed = seeds.get(path.seedId);
    if (seed === undefined) continue;
    let priorConsumerId: string | null = null;
    let seedNodeId: string | null = null;
    if (seed.endpointId !== null) {
      seedNodeId = makeSystemReportNodeId([
        'http_endpoint',
        seed.serviceNamespace,
        seed.endpointId,
      ]);
      const analysis = context.analysesByNamespace.get(seed.serviceNamespace);
      const endpoint = analysis?.endpoints.find(({ id }) => id === seed.endpointId);
      addNode(
        {
          nodeId: seedNodeId,
          kind: 'http_endpoint',
          label:
            endpoint === undefined ? seed.endpointId : `${endpoint.httpMethod} ${endpoint.path}`,
          parentNodeId: serviceByNamespace.get(seed.serviceNamespace)?.id ?? null,
          serviceNamespace: seed.serviceNamespace,
          classification: 'distributed_conditional',
        },
        path.id,
      );
    }
    for (const hop of path.hops) {
      const producerService = serviceByNamespace.get(hop.producerServiceNamespace)!;
      const consumerService = serviceByNamespace.get(hop.consumerServiceNamespace)!;
      const realm = realmById.get(hop.brokerRealmId)!;
      const destinationId = makeSystemReportNodeId(['broker_destination', realm.id]);
      for (const [nodeId, kind, label, parentNodeId, namespace] of [
        [
          producerService.id,
          'service',
          producerService.displayName,
          null,
          producerService.namespace,
        ],
        [
          consumerService.id,
          'service',
          consumerService.displayName,
          null,
          consumerService.namespace,
        ],
        [realm.id, 'broker_realm', `${realm.environmentAlias} / ${realm.brokerAlias}`, null, null],
        [
          destinationId,
          'broker_destination',
          `${realm.transport} ${realm.destination.kind}: ${realm.destination.value}`,
          realm.id,
          null,
        ],
        [
          hop.producerEndpointId,
          'producer',
          `producer: ${endpointContractLabel(context.endpointById.get(hop.producerEndpointId)!)}`,
          producerService.id,
          hop.producerServiceNamespace,
        ],
        [
          hop.consumerEndpointId,
          'consumer',
          `consumer: ${endpointContractLabel(context.endpointById.get(hop.consumerEndpointId)!)}`,
          consumerService.id,
          hop.consumerServiceNamespace,
        ],
      ] as const) {
        addNode(
          {
            nodeId,
            kind: kind as SystemImpactGraphNodeKind,
            label,
            parentNodeId,
            serviceNamespace: namespace,
            classification: 'distributed_conditional',
          },
          path.id,
        );
      }
      if (hop.index === 0 && seedNodeId !== null) {
        addEdge(
          makeSystemReportEdgeId([
            'initiates',
            hop.correlationId,
            seedNodeId,
            hop.producerEndpointId,
          ]),
          seedNodeId,
          hop.producerEndpointId,
          'initiates',
          path.id,
        );
      } else if (priorConsumerId !== null) {
        addEdge(
          createStableId('system_impact_graph_edge', [
            context.side,
            'initiates',
            priorConsumerId,
            hop.producerEndpointId,
          ]),
          priorConsumerId,
          hop.producerEndpointId,
          'initiates',
          path.id,
        );
      }
      addEdge(
        makeSystemReportEdgeId(['route', hop.correlationId, hop.producerEndpointId, destinationId]),
        hop.producerEndpointId,
        destinationId,
        'conditional_route',
        path.id,
      );
      addEdge(
        makeSystemReportEdgeId([
          'candidate',
          hop.correlationId,
          destinationId,
          hop.consumerEndpointId,
        ]),
        destinationId,
        hop.consumerEndpointId,
        'conditional_candidate',
        path.id,
      );
      priorConsumerId = hop.consumerEndpointId;
    }
    const lastHop = path.hops.at(-1);
    if (lastHop === undefined) continue;
    const consumer = context.endpointById.get(lastHop.consumerEndpointId)!;
    for (const effect of path.effects) {
      const effectNodeId =
        effect.kind === 'table'
          ? makeSystemReportNodeId([
              'table_effect',
              consumer.analysisRecord.namespacedId,
              effect.methodId,
              effect.direction,
              effect.analysisRecordId,
              effect.causalClass,
            ])
          : makeSystemReportNodeId([
              'resource_effect',
              consumer.analysisRecord.namespacedId,
              effect.methodId,
              effect.analysisRecordId,
              effect.causalClass,
            ]);
      addNode(
        {
          nodeId: effectNodeId,
          kind: effect.kind === 'table' ? 'table_effect' : 'resource_effect',
          label: effect.label,
          parentNodeId: serviceByNamespace.get(effect.serviceNamespace)?.id ?? null,
          serviceNamespace: effect.serviceNamespace,
          classification: 'distributed_conditional',
        },
        path.id,
        effect.id,
      );
      addEdge(
        makeSystemReportEdgeId([
          'effect',
          lastHop.correlationId,
          lastHop.consumerEndpointId,
          effectNodeId,
        ]),
        lastHop.consumerEndpointId,
        effectNodeId,
        'conditional_effect',
        path.id,
      );
    }
  }
  return {
    side: context.side,
    systemAnalysisId: context.system.systemId,
    nodes: [...nodes.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    edges: [...edges.values()].sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
  };
}

export function propagateConditionalSystemImpact(
  input: PropagateConditionalSystemImpactInput,
): SystemImpactDocumentV2 {
  const validated = assertValidSystemImpactDocument(input.comparison);
  if (validated.schemaVersion !== '1.0.0' || validated.propagation.state !== 'not_computed') {
    throw new SystemImpactPropagationError([
      {
        path: 'comparison',
        message: 'P4.2 requires an unpropagated P4.1 SystemImpactDocument.',
      },
    ]);
  }
  const comparison = validated as SystemImpactDocumentV1;
  const limits = {
    maxHops: normalizeLimit(
      input.limits?.maxHops,
      DEFAULT_SYSTEM_IMPACT_PROPAGATION_LIMITS.maxHops,
      MAX_SYSTEM_IMPACT_PROPAGATION_LIMITS.maxHops,
      'Maximum propagation hops',
    ),
    maxPaths: normalizeLimit(
      input.limits?.maxPaths,
      DEFAULT_SYSTEM_IMPACT_PROPAGATION_LIMITS.maxPaths,
      MAX_SYSTEM_IMPACT_PROPAGATION_LIMITS.maxPaths,
      'Maximum propagation paths',
    ),
    maxEffectsPerPath: normalizeLimit(
      input.limits?.maxEffectsPerPath,
      DEFAULT_SYSTEM_IMPACT_PROPAGATION_LIMITS.maxEffectsPerPath,
      MAX_SYSTEM_IMPACT_PROPAGATION_LIMITS.maxEffectsPerPath,
      'Maximum effects per propagation path',
    ),
    maxTraversalStates: normalizeLimit(
      input.limits?.maxTraversalStates,
      DEFAULT_SYSTEM_IMPACT_PROPAGATION_LIMITS.maxTraversalStates,
      MAX_SYSTEM_IMPACT_PROPAGATION_LIMITS.maxTraversalStates,
      'Maximum propagation traversal states',
    ),
  };
  const issues: SystemImpactPropagationIssue[] = [];
  const before = prepareSide('before', comparison.before, input.before, issues);
  const after = prepareSide('after', comparison.after, input.after, issues);
  if (issues.length > 0) throw new SystemImpactPropagationError(issues);
  const locals = deriveLocalImpacts(before, after);
  const beforePropagation = propagateSide({ comparison, context: before, locals, limits });
  const afterPropagation = propagateSide({
    comparison,
    context: after,
    locals,
    limits: {
      ...limits,
      maxPaths: Math.max(0, limits.maxPaths - beforePropagation.paths.length),
      maxTraversalStates: Math.max(
        0,
        limits.maxTraversalStates - beforePropagation.traversalStates,
      ),
    },
  });
  const seeds = [...beforePropagation.seeds, ...afterPropagation.seeds].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const paths = [...beforePropagation.paths, ...afterPropagation.paths].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const seedMap = new Map(seeds.map((seed) => [seed.id, seed]));
  const graphOverlays = [
    buildOverlay(before, seedMap, beforePropagation.paths),
    buildOverlay(after, seedMap, afterPropagation.paths),
  ].filter((overlay): overlay is SystemImpactGraphOverlay => overlay !== null);
  const effects = new Map(
    paths.flatMap((path) => path.effects.map((effect) => [effect.id, effect] as const)),
  );
  const affectedServices = new Set(
    paths.flatMap((path) => [
      ...path.hops.map(({ consumerServiceNamespace }) => consumerServiceNamespace),
      ...path.effects.map(({ serviceNamespace }) => serviceNamespace),
    ]),
  );
  const sourceArtifacts = [before, after].flatMap((context) =>
    [...context.analysesByNamespace.entries()].map(([namespace, analysis]) => ({
      side: context.side,
      serviceNamespace: namespace,
      analysisId: analysis.analysisRun.id,
      schemaVersion: analysis.schemaVersion,
      resultState: analysis.resultState as 'completed' | 'completed_with_gaps',
      contentFingerprint: hashContent(serializeCanonicalAnalysis(analysis)),
    })),
  );
  const { impactId: _comparisonImpactId, ...comparisonWithoutId } = comparison;
  void _comparisonImpactId;
  const documentWithoutId: Omit<SystemImpactDocumentV2, 'impactId'> = {
    ...comparisonWithoutId,
    schemaVersion: SYSTEM_IMPACT_SCHEMA_V2_VERSION,
    propagation: {
      state: 'computed',
      classification: 'distributed_conditional',
      limits,
      summary: {
        seeds: seeds.length,
        paths: paths.length,
        effects: effects.size,
        affectedServices: affectedServices.size,
        cyclesTruncated: paths.filter(({ truncation }) => truncation === 'cycle').length,
        hopLimitTruncations: paths.filter(({ truncation }) => truncation === 'hop_limit').length,
        stateLimitReached:
          beforePropagation.stateLimitReached || afterPropagation.stateLimitReached,
        pathsOmitted: beforePropagation.pathsOmitted + afterPropagation.pathsOmitted,
        effectsOmitted: beforePropagation.effectsOmitted + afterPropagation.effectsOmitted,
      },
      sourceArtifacts,
      seeds,
      paths,
      graphOverlays,
    },
  };
  return assertValidSystemImpactDocument({
    ...documentWithoutId,
    impactId: makeSystemImpactId(documentWithoutId),
  }) as SystemImpactDocumentV2;
}
