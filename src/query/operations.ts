import type { DiffDocument } from '../comparison/model.js';
import type { ImpactDocument } from '../impact/model.js';
import {
  analysisHasInteractionFacts,
  type AnalysisDocument,
  type EndpointTraceView,
} from '../model/analysis.js';
import type { AssertionRecord, AssertionStatus } from '../model/assertions.js';
import type { PolicyResult, PolicyResultsDocument, PolicySummary } from '../policy/model.js';
import type { SystemAnalysisDocument } from '../system-analysis/model.js';
import { systemInteractionContractKey } from '../system-analysis/model.js';
import type {
  BoundedQueryCollection,
  DistributedCandidate,
  DistributedCandidatesRequest,
  EndpointTraceProjection,
  PolicyResultsFilters,
  QueryImpactFamily,
  QueryImpactItem,
  QueryOperationMetadata,
  QueryPageSummary,
  QueryPolicyResult,
  QuerySemanticChange,
  SymbolDependentPath,
} from './operations-model.js';
import type {
  QueryArtifactDescriptor,
  QueryKernelLimits,
  QueryLimitSummary,
  SymbolQueryMatch,
} from './model.js';
import { QUERY_SCHEMA_VERSION } from './model.js';

const CANONICAL_ID_PATTERN = /^[a-z][a-z0-9_]*:[0-9a-f]{32}$/u;

export function compareQueryStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function uniqueQueryStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareQueryStrings);
}

export interface QueryReferences {
  readonly diagnosticIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface QueryPage<T> {
  readonly items: readonly T[];
  readonly limits: QueryLimitSummary;
  readonly page: QueryPageSummary;
}

export function paginateQueryItems<T>(input: {
  readonly items: readonly T[];
  readonly keyFor: (item: T) => string;
  readonly cursor: string | undefined;
  readonly requested: number | undefined;
  readonly limits: QueryKernelLimits;
}): QueryPage<T> {
  const ordered = [...input.items].sort((left, right) =>
    compareQueryStrings(input.keyFor(left), input.keyFor(right)),
  );
  const skipped =
    input.cursor === undefined
      ? 0
      : ordered.findIndex((item) => compareQueryStrings(input.keyFor(item), input.cursor!) > 0);
  const start = skipped === -1 ? ordered.length : skipped;
  const applied = Math.min(input.requested ?? input.limits.defaultResults, input.limits.maxResults);
  const available = ordered.slice(start);
  const items = available.slice(0, applied);
  const remaining = available.length - items.length;
  return {
    items,
    limits: {
      requested: input.requested ?? null,
      applied,
      totalMatches: available.length,
      returned: items.length,
      omitted: remaining,
    },
    page: {
      cursor: input.cursor ?? null,
      nextCursor: remaining > 0 && items.length > 0 ? input.keyFor(items.at(-1)!) : null,
      totalItems: ordered.length,
      skipped: start,
      remaining,
    },
  };
}

export function queryOperationMetadata(input: {
  readonly artifacts: readonly QueryArtifactDescriptor[];
  readonly resultArtifact?: QueryArtifactDescriptor | undefined;
  readonly page: Pick<QueryPage<unknown>, 'limits' | 'page'>;
  readonly references: readonly QueryReferences[];
}): QueryOperationMetadata {
  return {
    querySchemaVersion: QUERY_SCHEMA_VERSION,
    artifacts: [...input.artifacts].sort((left, right) =>
      compareQueryStrings(left.name, right.name),
    ),
    resultArtifact: input.resultArtifact ?? null,
    limits: input.page.limits,
    page: input.page.page,
    diagnosticIds: uniqueQueryStrings(
      input.references.flatMap(({ diagnosticIds }) => diagnosticIds),
    ),
    evidenceIds: uniqueQueryStrings(input.references.flatMap(({ evidenceIds }) => evidenceIds)),
  };
}

export function boundedQueryCollection<T>(
  values: readonly T[],
  limit: number,
): BoundedQueryCollection<T> {
  const items = values.slice(0, limit);
  return {
    total: values.length,
    returned: items.length,
    omitted: values.length - items.length,
    items,
  };
}

function collectReferences(value: unknown): {
  canonicalIds: readonly string[];
  evidenceIds: readonly string[];
} {
  const canonicalIds: string[] = [];
  const evidenceIds: string[] = [];
  const visit = (current: unknown, propertyName: string | null): void => {
    if (typeof current === 'string') {
      if (CANONICAL_ID_PATTERN.test(current)) canonicalIds.push(current);
      if (propertyName === 'evidenceIds') evidenceIds.push(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child, propertyName);
      return;
    }
    if (current === null || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) visit(child, key);
  };
  visit(value, null);
  return {
    canonicalIds: uniqueQueryStrings(canonicalIds),
    evidenceIds: uniqueQueryStrings(evidenceIds),
  };
}

function recordWithSemanticKey(record: unknown): { readonly key: { readonly encoded: string } } {
  return record as { readonly key: { readonly encoded: string } };
}

function endpointChangeLabel(record: DiffDocument['endpointChanges'][number]): string {
  const endpoint = record.after ?? record.before;
  return endpoint === null
    ? record.routeSlotKey.encoded
    : `${endpoint.httpMethod} ${endpoint.path}`;
}

export function projectDiffChanges(document: DiffDocument): readonly QuerySemanticChange[] {
  const standard = <T extends { readonly key: { readonly encoded: string } }>(
    family: QuerySemanticChange['family'],
    records: readonly T[],
    labelFor: (record: T) => string,
  ): QuerySemanticChange[] =>
    records.map((record) => {
      const value = record as T & {
        readonly change?: string;
        readonly reasons?: readonly string[];
      };
      const refs = collectReferences(record);
      return {
        key: `${family}:${record.key.encoded}`,
        family,
        change: value.change ?? 'changed',
        label: labelFor(record),
        reasonCodes: uniqueQueryStrings(value.reasons ?? []),
        canonicalIds: refs.canonicalIds,
        evidenceIds: refs.evidenceIds,
      };
    });

  const endpointChanges = document.endpointChanges.map((record) => {
    const refs = collectReferences(record);
    return {
      key: `endpoint:${record.routeSlotKey.encoded}`,
      family: 'endpoint' as const,
      change: record.change,
      label: endpointChangeLabel(record),
      reasonCodes: uniqueQueryStrings(record.reasons),
      canonicalIds: refs.canonicalIds,
      evidenceIds: refs.evidenceIds,
    };
  });
  const assertionChanges = document.assertionStatusChanges.map((record) => {
    const refs = collectReferences(record);
    return {
      key: `assertion_status:${record.key.encoded}`,
      family: 'assertion_status' as const,
      change: `${record.before.status}_to_${record.after.status}`,
      label: record.before.predicate,
      reasonCodes: ['assertion_status_changed'],
      canonicalIds: refs.canonicalIds,
      evidenceIds: refs.evidenceIds,
    };
  });
  const diagnosticChanges = standard('diagnostic', document.diagnosticChanges, (record) => {
    const diagnostic = record.after ?? record.before;
    return diagnostic?.code ?? record.key.encoded;
  });
  const interactionChanges = standard(
    'interaction',
    document.interactionChanges ?? [],
    (record) => recordWithSemanticKey(record).key.encoded,
  );
  const handlerChanges = standard(
    'interaction_handler',
    document.interactionHandlerChanges ?? [],
    (record) => recordWithSemanticKey(record).key.encoded,
  );
  const dispatchChanges = standard(
    'job_queue_dispatch',
    document.jobQueueDispatchChanges ?? [],
    (record) => recordWithSemanticKey(record).key.encoded,
  );
  const branchChanges = standard(
    'job_queue_branch',
    document.jobQueueBranchChanges ?? [],
    (record) => recordWithSemanticKey(record).key.encoded,
  );
  const branchEffectChanges = standard(
    'job_queue_branch_effect',
    document.jobQueueBranchEffectChanges ?? [],
    (record) => recordWithSemanticKey(record).key.encoded,
  );
  const ambiguities = document.ambiguities.map((record) => {
    const refs = collectReferences(record);
    return {
      key: `ambiguity:${record.key.encoded}:${record.kind}:${record.side}`,
      family: 'ambiguity' as const,
      change: 'ambiguous',
      label: `${record.recordKind} ${record.key.encoded}`,
      reasonCodes: [`${record.kind}:${record.side}`],
      canonicalIds: refs.canonicalIds,
      evidenceIds: refs.evidenceIds,
    };
  });
  return [
    ...endpointChanges,
    ...assertionChanges,
    ...diagnosticChanges,
    ...interactionChanges,
    ...handlerChanges,
    ...dispatchChanges,
    ...branchChanges,
    ...branchEffectChanges,
    ...ambiguities,
  ].sort((left, right) => compareQueryStrings(left.key, right.key));
}

export function projectImpactItems(document: ImpactDocument): readonly QueryImpactItem[] {
  const sourceChanges = document.sourceChanges.map((record) => {
    const refs = collectReferences(record);
    return {
      key: `source_change:${record.path}`,
      family: 'source_change' as const,
      change: record.change,
      label: record.path,
      direct: null,
      pathCount: 0,
      reasonCodes: [] as readonly string[],
      categories: [] as readonly string[],
      canonicalIds: refs.canonicalIds,
      evidenceIds: refs.evidenceIds,
    };
  });
  const impacted = document.impactedEndpoints.map((record) => {
    const refs = collectReferences(record);
    return {
      key: `impacted_endpoint:${record.routeSlotKey.encoded}`,
      family: 'impacted_endpoint' as const,
      change: record.direct ? 'direct' : 'transitive',
      label: `${record.httpMethod} ${record.path}`,
      direct: record.direct,
      pathCount: record.reasons.reduce((total, reason) => total + reason.paths.length, 0),
      reasonCodes: uniqueQueryStrings(record.reasons.map(({ reasonCode }) => reasonCode)),
      categories: uniqueQueryStrings(record.reasons.map(({ category }) => category)),
      canonicalIds: refs.canonicalIds,
      evidenceIds: refs.evidenceIds,
    };
  });
  const unreachable = document.unreachableSourceChanges.map((record) => {
    const refs = collectReferences(record);
    return {
      key: `unreachable_source_change:${record.path}`,
      family: 'unreachable_source_change' as const,
      change: record.change,
      label: record.path,
      direct: null,
      pathCount: 0,
      reasonCodes: uniqueQueryStrings(record.reasonCodes),
      categories: [] as readonly string[],
      canonicalIds: refs.canonicalIds,
      evidenceIds: refs.evidenceIds,
    };
  });
  return [...sourceChanges, ...impacted, ...unreachable].sort((left, right) =>
    compareQueryStrings(left.key, right.key),
  );
}

export function projectEndpointTrace(input: {
  readonly trace: EndpointTraceView;
  readonly endpoint: EndpointTraceProjection['endpoint'];
  readonly limit: number;
}): EndpointTraceProjection {
  const causal = input.trace.causalSummary;
  return {
    endpoint: input.endpoint,
    directGuardState: input.trace.directGuardState,
    globalGuardState: input.trace.globalGuardState,
    effectiveGuardState: input.trace.effectiveGuardState,
    guards: boundedQueryCollection(input.trace.guards, input.limit),
    steps: boundedQueryCollection(input.trace.steps, input.limit),
    terminals: boundedQueryCollection(input.trace.terminals, input.limit),
    resourceTerminals: boundedQueryCollection(input.trace.resourceTerminals ?? [], input.limit),
    diagnosticIds: boundedQueryCollection(input.trace.diagnosticIds, input.limit),
    causalSummary:
      causal === undefined
        ? null
        : {
            completeness: causal.completeness,
            outboundInteractionIds: boundedQueryCollection(
              uniqueQueryStrings(causal.outboundInteractionIds),
              input.limit,
            ),
            localInteractionIds: boundedQueryCollection(
              uniqueQueryStrings(causal.localInteractionIds),
              input.limit,
            ),
            distributedInteractionIds: boundedQueryCollection(
              uniqueQueryStrings(causal.distributedInteractionIds ?? []),
              input.limit,
            ),
            jobQueueBranchIds: boundedQueryCollection(
              uniqueQueryStrings(causal.jobQueueBranchIds ?? []),
              input.limit,
            ),
          },
  };
}

const REVERSE_DEPENDENCY_PREDICATES = new Set([
  'METHOD_CALLS_METHOD',
  'ENDPOINT_IMPLEMENTED_BY',
  'HANDLER_IMPLEMENTED_BY',
]);

interface ReverseTraversalState {
  readonly currentId: string;
  readonly steps: readonly SymbolDependentPath['steps'][number][];
  readonly seenIds: ReadonlySet<string>;
}

function assertionIsReverseDependency(assertion: AssertionRecord): assertion is AssertionRecord & {
  readonly objectId: string;
  readonly status: Extract<AssertionStatus, 'resolved' | 'ambiguous'>;
} {
  return (
    assertion.objectId !== null &&
    REVERSE_DEPENDENCY_PREDICATES.has(assertion.predicate) &&
    (assertion.status === 'resolved' || assertion.status === 'ambiguous')
  );
}

export function findSymbolDependentPaths(input: {
  readonly analysis: AnalysisDocument;
  readonly root: SymbolQueryMatch;
  readonly maxDepth: number;
  readonly maxStates: number;
}): {
  readonly seedMethodIds: readonly string[];
  readonly paths: readonly SymbolDependentPath[];
  readonly visitedStates: number;
  readonly truncated: boolean;
} {
  const seedMethodIds = uniqueQueryStrings(
    input.root.kind === 'method'
      ? [input.root.canonicalId]
      : input.analysis.methods
          .filter(({ classId }) => classId === input.root.canonicalId)
          .map(({ id }) => id),
  );
  const reverse = new Map<string, AssertionRecord[]>();
  for (const assertion of input.analysis.assertions) {
    if (!assertionIsReverseDependency(assertion)) continue;
    reverse.set(assertion.objectId, [...(reverse.get(assertion.objectId) ?? []), assertion]);
  }
  for (const [id, assertions] of reverse) {
    reverse.set(
      id,
      assertions.sort((left, right) => compareQueryStrings(left.id, right.id)),
    );
  }
  const methodNames = new Map(
    input.analysis.methods.map((record) => [record.id, record.qualifiedName]),
  );
  const endpointNames = new Map(
    input.analysis.endpoints.map((record) => [record.id, `${record.httpMethod} ${record.path}`]),
  );
  const handlerNames = new Map(
    analysisHasInteractionFacts(input.analysis)
      ? input.analysis.interactionHandlers.map((record) => [
          record.id,
          `${record.kind} ${record.id}`,
        ])
      : [],
  );
  const diagnosticIdsBySubject = new Map<string, string[]>();
  for (const diagnostic of input.analysis.diagnostics) {
    if (diagnostic.subjectId === undefined) continue;
    diagnosticIdsBySubject.set(diagnostic.subjectId, [
      ...(diagnosticIdsBySubject.get(diagnostic.subjectId) ?? []),
      diagnostic.id,
    ]);
  }
  const queue: ReverseTraversalState[] = seedMethodIds
    .slice(0, input.maxStates)
    .map((methodId) => ({
      currentId: methodId,
      steps: [],
      seenIds: new Set([methodId]),
    }));
  const paths: SymbolDependentPath[] = [];
  const pathKeys = new Set<string>();
  let visitedStates = queue.length;
  let truncated = seedMethodIds.length > queue.length;
  traversal: while (queue.length > 0) {
    const state = queue.shift()!;
    if (state.steps.length >= input.maxDepth) continue;
    for (const assertion of reverse.get(state.currentId) ?? []) {
      if (state.seenIds.has(assertion.subjectId)) continue;
      if (visitedStates >= input.maxStates) {
        truncated = true;
        break traversal;
      }
      visitedStates += 1;
      const step: SymbolDependentPath['steps'][number] = {
        assertionId: assertion.id,
        fromId: assertion.subjectId,
        predicate: assertion.predicate as SymbolDependentPath['steps'][number]['predicate'],
        toId: assertion.objectId as string,
        status: assertion.status as Extract<AssertionStatus, 'resolved' | 'ambiguous'>,
        evidenceIds: uniqueQueryStrings(assertion.evidenceIds),
      };
      const steps = [step, ...state.steps];
      const key = `${assertion.subjectId}:${steps.map(({ assertionId }) => assertionId).join('/')}`;
      if (pathKeys.has(key)) continue;
      pathKeys.add(key);
      const methodName = methodNames.get(assertion.subjectId);
      const endpointName = endpointNames.get(assertion.subjectId);
      const handlerName = handlerNames.get(assertion.subjectId);
      const subjectKind =
        methodName !== undefined
          ? ('method' as const)
          : endpointName !== undefined
            ? ('endpoint' as const)
            : handlerName !== undefined
              ? ('interaction_handler' as const)
              : null;
      if (subjectKind !== null) {
        paths.push({
          key,
          subjectKind,
          subjectId: assertion.subjectId,
          displayName: methodName ?? endpointName ?? handlerName!,
          depth: steps.length,
          certainty: steps.some(({ status }) => status === 'ambiguous') ? 'ambiguous' : 'resolved',
          steps,
          diagnosticIds: uniqueQueryStrings(diagnosticIdsBySubject.get(assertion.subjectId) ?? []),
          evidenceIds: uniqueQueryStrings(steps.flatMap(({ evidenceIds }) => evidenceIds)),
        });
      }
      if (methodName !== undefined) {
        queue.push({
          currentId: assertion.subjectId,
          steps,
          seenIds: new Set([...state.seenIds, assertion.subjectId]),
        });
      }
    }
  }
  return {
    seedMethodIds,
    paths: paths.sort((left, right) => compareQueryStrings(left.key, right.key)),
    visitedStates,
    truncated,
  };
}

export function projectDistributedCandidates(input: {
  readonly system: SystemAnalysisDocument;
  readonly request: DistributedCandidatesRequest;
}): readonly DistributedCandidate[] {
  const contractKey = systemInteractionContractKey(input.request.target);
  const endpointById = new Map(
    input.system.interactionEndpoints.map((record) => [record.id, record]),
  );
  return input.system.correlations
    .filter(
      (correlation) =>
        correlation.kind === input.request.kind &&
        correlation.contractKey === contractKey &&
        (input.request.states === undefined || input.request.states.includes(correlation.state)),
    )
    .map((correlation) => {
      const producer =
        correlation.producerEndpointId === null
          ? null
          : (endpointById.get(correlation.producerEndpointId) ?? null);
      const consumers = correlation.consumerEndpointIds.flatMap((id) => {
        const endpoint = endpointById.get(id);
        return endpoint === undefined ? [] : [endpoint];
      });
      return {
        key: correlation.id,
        correlationId: correlation.id,
        state: correlation.state,
        contractKey: correlation.contractKey,
        brokerRealmId: correlation.brokerRealmId,
        producer,
        consumers,
        unmatchedReason: correlation.unmatchedReason,
        ambiguityReason: correlation.ambiguityReason,
        diagnosticIds: uniqueQueryStrings(correlation.diagnosticIds),
        canonicalIds: uniqueQueryStrings([
          correlation.id,
          ...(correlation.brokerRealmId === null ? [] : [correlation.brokerRealmId]),
          ...(producer === null
            ? []
            : [
                producer.id,
                producer.serviceId,
                producer.analysisRecord.analysisRecordId,
                producer.analysisRecord.namespacedId,
              ]),
          ...consumers.flatMap((consumer) => [
            consumer.id,
            consumer.serviceId,
            consumer.analysisRecord.analysisRecordId,
            consumer.analysisRecord.namespacedId,
          ]),
        ]),
      };
    })
    .sort((left, right) => compareQueryStrings(left.key, right.key));
}

export function policyResultKey(result: PolicyResult): string {
  return `${result.ruleId}:${result.subject.semanticKey.encoded}`;
}

export function filterPolicyResults(
  document: PolicyResultsDocument,
  filters: PolicyResultsFilters,
): readonly QueryPolicyResult[] {
  return document.results
    .filter(
      (result) =>
        (filters.ruleIds === undefined || filters.ruleIds.includes(result.ruleId)) &&
        (filters.outcomes === undefined || filters.outcomes.includes(result.outcome)) &&
        (filters.severities === undefined || filters.severities.includes(result.severity)) &&
        (filters.blocking === undefined || filters.blocking === result.blocking),
    )
    .map((result) => ({ ...result, key: policyResultKey(result) }))
    .sort((left, right) => compareQueryStrings(left.key, right.key));
}

export function summarizePolicyResults(results: readonly PolicyResult[]): PolicySummary {
  const actionable = results.filter(({ outcome }) => outcome === 'fail' || outcome === 'unknown');
  return {
    passed: results.filter(({ outcome }) => outcome === 'pass').length,
    failed: results.filter(({ outcome }) => outcome === 'fail').length,
    unknown: results.filter(({ outcome }) => outcome === 'unknown').length,
    notApplicable: results.filter(({ outcome }) => outcome === 'not_applicable').length,
    warnings: actionable.filter(({ severity }) => severity === 'warn').length,
    errors: actionable.filter(({ severity }) => severity === 'error').length,
    blocking: results.filter(({ blocking }) => blocking).length,
  };
}

export function queryImpactFamilies(
  items: readonly QueryImpactItem[],
  families: readonly QueryImpactFamily[] | undefined,
): readonly QueryImpactItem[] {
  return families === undefined ? items : items.filter(({ family }) => families.includes(family));
}
