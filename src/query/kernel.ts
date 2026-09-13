import type { AnalysisDocument } from '../model/analysis.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { compareAnalysisDocuments } from '../comparison/compare.js';
import { analyzePotentialImpact } from '../impact/analyze.js';
import { buildEndpointTrace } from '../tracing/endpoint-trace.js';
import { systemInteractionContractKey } from '../system-analysis/model.js';
import type { QueryArtifactInput } from './artifacts.js';
import { describeQueryArtifact } from './artifacts.js';
import type {
  ClassSymbolQueryMatch,
  EndpointQueryMatch,
  EndpointResolutionRequest,
  EndpointResolutionResponse,
  MethodSymbolQueryMatch,
  QueryArtifactDescriptor,
  QueryKernelLimits,
  QueryLimitSummary,
  QuerySelectorState,
  QuerySourcePosition,
  QuerySourceRange,
  SymbolQueryMatch,
  SymbolResolutionRequest,
  SymbolResolutionResponse,
} from './model.js';
import { QUERY_SCHEMA_VERSION, QueryInputError } from './model.js';
import type {
  ChangeImpactRequest,
  ChangeImpactResponse,
  CompareAnalysesRequest,
  CompareAnalysesResponse,
  DistributedCandidatesRequest,
  DistributedCandidatesResponse,
  EndpointTraceQueryRequest,
  EndpointTraceQueryResponse,
  ListEndpointsRequest,
  ListEndpointsResponse,
  PolicyResultsRequest,
  PolicyResultsResponse,
  SymbolDependentsRequest,
  SymbolDependentsResponse,
} from './operations-model.js';
import {
  boundedQueryCollection,
  filterPolicyResults,
  findSymbolDependentPaths,
  paginateQueryItems,
  projectDiffChanges,
  projectDistributedCandidates,
  projectEndpointTrace,
  projectImpactItems,
  queryImpactFamilies,
  queryOperationMetadata,
  summarizePolicyResults,
  uniqueQueryStrings,
} from './operations.js';
import {
  changeImpactRequestSchema,
  changeImpactResponseSchema,
  compareAnalysesRequestSchema,
  compareAnalysesResponseSchema,
  distributedCandidatesRequestSchema,
  distributedCandidatesResponseSchema,
  endpointTraceQueryRequestSchema,
  endpointTraceQueryResponseSchema,
  listEndpointsRequestSchema,
  listEndpointsResponseSchema,
  policyResultsRequestSchema,
  policyResultsResponseSchema,
  symbolDependentsRequestSchema,
  symbolDependentsResponseSchema,
} from './operations-schemas.js';
import {
  ABSOLUTE_QUERY_RESULT_LIMIT,
  endpointResolutionRequestSchema,
  endpointResolutionResponseSchema,
  queryArtifactNameSchema,
  symbolResolutionRequestSchema,
  symbolResolutionResponseSchema,
} from './schemas.js';

export const DEFAULT_QUERY_KERNEL_LIMITS: QueryKernelLimits = {
  defaultResults: 25,
  maxResults: 100,
  maxTraversalDepth: 5,
  maxTraversalStates: 1_000,
};

interface IndexedAnalysis {
  readonly endpoints: readonly EndpointQueryMatch[];
  readonly symbols: readonly SymbolQueryMatch[];
  readonly endpointsById: ReadonlyMap<string, readonly EndpointQueryMatch[]>;
  readonly endpointsByRoute: ReadonlyMap<string, readonly EndpointQueryMatch[]>;
  readonly symbolsById: ReadonlyMap<string, readonly SymbolQueryMatch[]>;
  readonly symbolsByDeclaration: ReadonlyMap<string, readonly SymbolQueryMatch[]>;
}

interface RegisteredArtifact {
  readonly input: QueryArtifactInput;
  readonly descriptor: QueryArtifactDescriptor;
  readonly analysisIndex: IndexedAnalysis | null;
}

type RegisteredAnalysisArtifact = RegisteredArtifact & {
  readonly input: Extract<QueryArtifactInput, { readonly kind: 'analysis' }>;
  readonly analysisIndex: IndexedAnalysis;
};

export interface QueryKernel {
  readonly limits: QueryKernelLimits;
  readonly artifacts: readonly QueryArtifactDescriptor[];
  resolveEndpoint(request: EndpointResolutionRequest): EndpointResolutionResponse;
  resolveSymbol(request: SymbolResolutionRequest): SymbolResolutionResponse;
  listEndpoints(request: ListEndpointsRequest): ListEndpointsResponse;
  getEndpointTrace(request: EndpointTraceQueryRequest): EndpointTraceQueryResponse;
  compareAnalyses(request: CompareAnalysesRequest): CompareAnalysesResponse;
  getChangeImpact(request: ChangeImpactRequest): ChangeImpactResponse;
  getSymbolDependents(request: SymbolDependentsRequest): SymbolDependentsResponse;
  findDistributedCandidates(request: DistributedCandidatesRequest): DistributedCandidatesResponse;
  getPolicyResults(request: PolicyResultsRequest): PolicyResultsResponse;
}

export interface CreateQueryKernelInput {
  readonly artifacts: readonly QueryArtifactInput[];
  readonly limits?: Partial<QueryKernelLimits> | undefined;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}

function routeKey(httpMethod: string, path: string): string {
  return `${httpMethod}\u0000${path}`;
}

function declarationKey(sourcePath: string, qualifiedName: string): string {
  return `${sourcePath}\u0000${qualifiedName}`;
}

function groupByKey<T extends { readonly canonicalId: string }>(
  records: readonly T[],
  keyFor: (record: T) => string,
): ReadonlyMap<string, readonly T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const key = keyFor(record);
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }
  for (const [key, values] of grouped) {
    grouped.set(
      key,
      [...values].sort((left, right) => compareStrings(left.canonicalId, right.canonicalId)),
    );
  }
  return grouped;
}

function diagnosticsBySubject(
  diagnostics: readonly DiagnosticRecord[],
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.subjectId === undefined) continue;
    grouped.set(diagnostic.subjectId, [
      ...(grouped.get(diagnostic.subjectId) ?? []),
      diagnostic.id,
    ]);
  }
  for (const [subjectId, ids] of grouped) grouped.set(subjectId, [...ids].sort(compareStrings));
  return grouped;
}

function handlerAssertionsByEndpoint(
  assertions: readonly AssertionRecord[],
): ReadonlyMap<string, readonly AssertionRecord[]> {
  const grouped = new Map<string, AssertionRecord[]>();
  for (const assertion of assertions) {
    if (assertion.predicate !== 'ENDPOINT_IMPLEMENTED_BY') continue;
    grouped.set(assertion.subjectId, [...(grouped.get(assertion.subjectId) ?? []), assertion]);
  }
  for (const [endpointId, records] of grouped) {
    grouped.set(
      endpointId,
      [...records].sort((left, right) => compareStrings(left.id, right.id)),
    );
  }
  return grouped;
}

function evidenceRange(evidence: EvidenceRecord): QuerySourceRange {
  return {
    line: evidence.startLine,
    column: evidence.startColumn,
    endLine: evidence.endLine,
    endColumn: evidence.endColumn,
  };
}

function buildAnalysisIndex(analysis: AnalysisDocument): IndexedAnalysis {
  const evidenceById = new Map(analysis.evidence.map((record) => [record.id, record]));
  const sourceById = new Map(analysis.sourceFiles.map((record) => [record.id, record]));
  const classById = new Map(analysis.classes.map((record) => [record.id, record]));
  const directDiagnostics = diagnosticsBySubject(analysis.diagnostics);
  const handlerAssertions = handlerAssertionsByEndpoint(analysis.assertions);

  const endpoints: EndpointQueryMatch[] = analysis.endpoints.map((endpoint) => {
    const handlers = (handlerAssertions.get(endpoint.id) ?? []).map((assertion) => ({
      assertionId: assertion.id,
      methodId: assertion.objectId,
      status: assertion.status,
      evidenceIds: uniqueSorted(assertion.evidenceIds),
    }));
    return {
      canonicalId: endpoint.id,
      httpMethod: endpoint.httpMethod,
      path: endpoint.path,
      handlers,
      diagnosticIds: directDiagnostics.get(endpoint.id) ?? [],
      evidenceIds: uniqueSorted(handlers.flatMap(({ evidenceIds }) => evidenceIds)),
    };
  });

  const classes: ClassSymbolQueryMatch[] = analysis.classes.map((record) => {
    const source = sourceById.get(record.sourceFileId);
    const declaration = evidenceById.get(record.declarationEvidenceId);
    if (source === undefined || declaration === undefined) {
      throw new QueryInputError(
        'INVALID_QUERY',
        `Validated analysis is missing declaration data for ${record.id}.`,
      );
    }
    return {
      kind: 'class',
      canonicalId: record.id,
      sourceFileId: source.id,
      sourcePath: source.path,
      qualifiedName: record.qualifiedName,
      displayName: record.displayName,
      roles: [...record.roles].sort(compareStrings),
      declarationEvidenceId: declaration.id,
      declaration: evidenceRange(declaration),
      diagnosticIds: directDiagnostics.get(record.id) ?? [],
      evidenceIds: [declaration.id],
    };
  });

  const methods: MethodSymbolQueryMatch[] = analysis.methods.map((record) => {
    const owner = classById.get(record.classId);
    const source = owner === undefined ? undefined : sourceById.get(owner.sourceFileId);
    const declaration = evidenceById.get(record.declarationEvidenceId);
    if (owner === undefined || source === undefined || declaration === undefined) {
      throw new QueryInputError(
        'INVALID_QUERY',
        `Validated analysis is missing declaration data for ${record.id}.`,
      );
    }
    return {
      kind: 'method',
      canonicalId: record.id,
      classId: owner.id,
      sourceFileId: source.id,
      sourcePath: source.path,
      qualifiedName: record.qualifiedName,
      displayName: record.displayName,
      signature: record.signature,
      declarationEvidenceId: declaration.id,
      declaration: evidenceRange(declaration),
      diagnosticIds: directDiagnostics.get(record.id) ?? [],
      evidenceIds: [declaration.id],
    };
  });
  const symbols: SymbolQueryMatch[] = [...classes, ...methods];

  return {
    endpoints: [...endpoints].sort((left, right) =>
      compareStrings(left.canonicalId, right.canonicalId),
    ),
    symbols: [...symbols].sort((left, right) =>
      compareStrings(left.canonicalId, right.canonicalId),
    ),
    endpointsById: groupByKey(endpoints, ({ canonicalId }) => canonicalId),
    endpointsByRoute: groupByKey(endpoints, ({ httpMethod, path }) => routeKey(httpMethod, path)),
    symbolsById: groupByKey(symbols, ({ canonicalId }) => canonicalId),
    symbolsByDeclaration: groupByKey(symbols, ({ sourcePath, qualifiedName }) =>
      declarationKey(sourcePath, qualifiedName),
    ),
  };
}

function normalizedLimits(input: CreateQueryKernelInput['limits']): QueryKernelLimits {
  const defaultResults = input?.defaultResults ?? DEFAULT_QUERY_KERNEL_LIMITS.defaultResults;
  const maxResults = input?.maxResults ?? DEFAULT_QUERY_KERNEL_LIMITS.maxResults;
  const maxTraversalDepth =
    input?.maxTraversalDepth ?? DEFAULT_QUERY_KERNEL_LIMITS.maxTraversalDepth;
  const maxTraversalStates =
    input?.maxTraversalStates ?? DEFAULT_QUERY_KERNEL_LIMITS.maxTraversalStates;
  if (
    !Number.isInteger(defaultResults) ||
    !Number.isInteger(maxResults) ||
    defaultResults < 1 ||
    maxResults < 1 ||
    defaultResults > maxResults ||
    maxResults > ABSOLUTE_QUERY_RESULT_LIMIT ||
    !Number.isInteger(maxTraversalDepth) ||
    maxTraversalDepth < 1 ||
    maxTraversalDepth > 10 ||
    !Number.isInteger(maxTraversalStates) ||
    maxTraversalStates < 1 ||
    maxTraversalStates > 10_000
  ) {
    throw new QueryInputError(
      'INVALID_LIMITS',
      `Query limits require 1 <= defaultResults <= maxResults <= ${ABSOLUTE_QUERY_RESULT_LIMIT}, 1 <= maxTraversalDepth <= 10, and 1 <= maxTraversalStates <= 10000.`,
    );
  }
  return { defaultResults, maxResults, maxTraversalDepth, maxTraversalStates };
}

function selectorState(totalMatches: number): QuerySelectorState {
  if (totalMatches === 0) return 'not_found';
  return totalMatches === 1 ? 'resolved' : 'ambiguous';
}

function limitMatches<T>(
  matches: readonly T[],
  requested: number | undefined,
  limits: QueryKernelLimits,
): { readonly matches: readonly T[]; readonly summary: QueryLimitSummary } {
  const applied = Math.min(requested ?? limits.defaultResults, limits.maxResults);
  const returned = matches.slice(0, applied);
  return {
    matches: returned,
    summary: {
      requested: requested ?? null,
      applied,
      totalMatches: matches.length,
      returned: returned.length,
      omitted: matches.length - returned.length,
    },
  };
}

function positionInRange(position: QuerySourcePosition, range: QuerySourceRange): boolean {
  const afterStart =
    position.line > range.line || (position.line === range.line && position.column >= range.column);
  const beforeEnd =
    position.line < range.endLine ||
    (position.line === range.endLine && position.column < range.endColumn);
  return afterStart && beforeEnd;
}

function queryMetadata(
  artifact: QueryArtifactDescriptor,
  limits: QueryLimitSummary,
  matches: readonly {
    readonly diagnosticIds: readonly string[];
    readonly evidenceIds: readonly string[];
  }[],
) {
  return {
    querySchemaVersion: QUERY_SCHEMA_VERSION,
    artifact,
    limits,
    diagnosticIds: uniqueSorted(matches.flatMap(({ diagnosticIds }) => diagnosticIds)),
    evidenceIds: uniqueSorted(matches.flatMap(({ evidenceIds }) => evidenceIds)),
  };
}

function parseRequest<T>(
  parser: {
    safeParse(input: unknown): { success: true; data: T } | { success: false; error: Error };
  },
  request: unknown,
): T {
  const parsed = parser.safeParse(request);
  if (!parsed.success) {
    throw new QueryInputError('INVALID_QUERY', parsed.error.message);
  }
  return parsed.data;
}

export function createQueryKernel(input: CreateQueryKernelInput): QueryKernel {
  const limits = Object.freeze(normalizedLimits(input.limits));
  const byName = new Map<string, RegisteredArtifact>();
  for (const artifact of input.artifacts) {
    if (!queryArtifactNameSchema.safeParse(artifact.name).success) {
      throw new QueryInputError('INVALID_ARTIFACT_NAME', `Invalid artifact name ${artifact.name}.`);
    }
    if (byName.has(artifact.name)) {
      throw new QueryInputError(
        'DUPLICATE_ARTIFACT_NAME',
        `Artifact name ${artifact.name} is registered more than once.`,
      );
    }
    const descriptor = Object.freeze(describeQueryArtifact(artifact));
    byName.set(artifact.name, {
      input: artifact,
      descriptor,
      analysisIndex: artifact.kind === 'analysis' ? buildAnalysisIndex(artifact.document) : null,
    });
  }

  const artifacts = Object.freeze(
    [...byName.values()]
      .map(({ descriptor }) => descriptor)
      .sort((left, right) => compareStrings(left.name, right.name)),
  );

  const artifactOfKind = <Kind extends QueryArtifactInput['kind']>(
    name: string,
    kind: Kind,
  ): RegisteredArtifact & {
    readonly input: Extract<QueryArtifactInput, { readonly kind: Kind }>;
  } => {
    const artifact = byName.get(name);
    if (artifact === undefined) {
      throw new QueryInputError('ARTIFACT_NOT_FOUND', `Artifact ${name} is not registered.`);
    }
    if (artifact.input.kind !== kind) {
      throw new QueryInputError(
        'ARTIFACT_KIND_MISMATCH',
        `Artifact ${name} has kind ${artifact.input.kind}; a ${kind} artifact is required.`,
      );
    }
    return artifact as RegisteredArtifact & {
      readonly input: Extract<QueryArtifactInput, { readonly kind: Kind }>;
    };
  };

  const analysisArtifact = (name: string): RegisteredAnalysisArtifact => {
    const artifact = artifactOfKind(name, 'analysis');
    if (artifact.analysisIndex === null) {
      throw new QueryInputError('INVALID_QUERY', `Analysis index for ${name} is unavailable.`);
    }
    return artifact as RegisteredAnalysisArtifact;
  };

  const endpointMatches = (
    artifact: RegisteredAnalysisArtifact,
    selector: EndpointResolutionRequest['selector'],
  ): readonly EndpointQueryMatch[] =>
    selector.by === 'canonical_id'
      ? (artifact.analysisIndex.endpointsById.get(selector.canonicalId) ?? [])
      : (artifact.analysisIndex.endpointsByRoute.get(
          routeKey(selector.httpMethod, selector.path),
        ) ?? []);

  const symbolMatches = (
    artifact: RegisteredAnalysisArtifact,
    selector: SymbolResolutionRequest['selector'],
  ): readonly SymbolQueryMatch[] => {
    if (selector.by === 'canonical_id') {
      return artifact.analysisIndex.symbolsById.get(selector.canonicalId) ?? [];
    }
    const candidates =
      artifact.analysisIndex.symbolsByDeclaration.get(
        declarationKey(selector.sourcePath, selector.qualifiedName),
      ) ?? [];
    return candidates.filter(
      (match) =>
        (selector.kind === undefined || match.kind === selector.kind) &&
        (selector.location === undefined || positionInRange(selector.location, match.declaration)),
    );
  };

  const unpagedSummary = (summary: QueryLimitSummary) => ({
    limits: summary,
    page: {
      cursor: null,
      nextCursor: null,
      totalItems: summary.totalMatches,
      skipped: 0,
      remaining: summary.omitted,
    },
  });

  const pairArtifacts = (beforeName: string, afterName: string) => {
    const before = analysisArtifact(beforeName);
    const after = analysisArtifact(afterName);
    if (
      !['completed', 'completed_with_gaps'].includes(before.input.document.resultState) ||
      !['completed', 'completed_with_gaps'].includes(after.input.document.resultState)
    ) {
      throw new QueryInputError(
        'INVALID_QUERY',
        'Comparison and impact queries require completed or completed-with-gaps analyses.',
      );
    }
    return { before, after };
  };

  return {
    limits,
    artifacts,
    resolveEndpoint(rawRequest) {
      const request = parseRequest(endpointResolutionRequestSchema, rawRequest);
      const artifact = analysisArtifact(request.artifactName);
      const allMatches = endpointMatches(artifact, request.selector);
      const limited = limitMatches(allMatches, request.limit, limits);
      return endpointResolutionResponseSchema.parse({
        schemaVersion: QUERY_SCHEMA_VERSION,
        state: selectorState(allMatches.length),
        selector: request.selector,
        metadata: queryMetadata(artifact.descriptor, limited.summary, limited.matches),
        matches: limited.matches,
      });
    },
    resolveSymbol(rawRequest) {
      const request = parseRequest(symbolResolutionRequestSchema, rawRequest);
      const artifact = analysisArtifact(request.artifactName);
      const allMatches = symbolMatches(artifact, request.selector);
      const limited = limitMatches(allMatches, request.limit, limits);
      return symbolResolutionResponseSchema.parse({
        schemaVersion: QUERY_SCHEMA_VERSION,
        state: selectorState(allMatches.length),
        selector: request.selector,
        metadata: queryMetadata(artifact.descriptor, limited.summary, limited.matches),
        matches: limited.matches,
      });
    },
    listEndpoints(rawRequest) {
      const request = parseRequest(listEndpointsRequestSchema, rawRequest);
      const artifact = analysisArtifact(request.artifactName);
      const filters = {
        ...(request.filters?.httpMethods === undefined
          ? {}
          : { httpMethods: [...request.filters.httpMethods].sort(compareStrings) }),
        ...(request.filters?.pathPrefix === undefined
          ? {}
          : { pathPrefix: request.filters.pathPrefix }),
        ...(request.filters?.hasDiagnostics === undefined
          ? {}
          : { hasDiagnostics: request.filters.hasDiagnostics }),
      };
      const filtered = artifact.analysisIndex.endpoints.filter(
        (endpoint) =>
          (filters.httpMethods === undefined ||
            filters.httpMethods.includes(endpoint.httpMethod)) &&
          (filters.pathPrefix === undefined || endpoint.path.startsWith(filters.pathPrefix)) &&
          (filters.hasDiagnostics === undefined ||
            endpoint.diagnosticIds.length > 0 === filters.hasDiagnostics),
      );
      const page = paginateQueryItems({
        items: filtered,
        keyFor: ({ canonicalId }) => canonicalId,
        cursor: request.cursor,
        requested: request.limit,
        limits,
      });
      return listEndpointsResponseSchema.parse({
        schemaVersion: QUERY_SCHEMA_VERSION,
        filters,
        metadata: queryOperationMetadata({
          artifacts: [artifact.descriptor],
          page,
          references: page.items,
        }),
        endpoints: page.items,
      }) as ListEndpointsResponse;
    },
    getEndpointTrace(rawRequest) {
      const request = parseRequest(endpointTraceQueryRequestSchema, rawRequest);
      const artifact = analysisArtifact(request.artifactName);
      const allMatches = endpointMatches(artifact, request.selector);
      const limited = limitMatches(allMatches, request.limit, limits);
      const nestedLimit = Math.min(request.limit ?? limits.defaultResults, limits.maxResults);
      const canonicalEndpointId =
        request.selector.by === 'canonical_id' ? request.selector.canonicalId : null;
      const selectedAnalysis =
        canonicalEndpointId !== null
          ? ({
              ...artifact.input.document,
              endpoints: artifact.input.document.endpoints.filter(
                ({ id }) => id === canonicalEndpointId,
              ),
            } as AnalysisDocument)
          : artifact.input.document;
      const routeSelector =
        request.selector.by === 'route'
          ? request.selector
          : allMatches.length === 1
            ? {
                httpMethod: allMatches[0]!.httpMethod,
                path: allMatches[0]!.path,
              }
            : { httpMethod: 'GET' as const, path: '/__query_not_found__' };
      const built = buildEndpointTrace(selectedAnalysis, routeSelector);
      let state: EndpointTraceQueryResponse['state'];
      let trace: EndpointTraceQueryResponse['trace'] = null;
      if (built.status === 'analysis_failure') {
        state = 'analysis_failure';
      } else {
        state = selectorState(allMatches.length);
        if (state === 'resolved' && built.status === 'resolved') {
          trace = projectEndpointTrace({
            trace: built.trace,
            endpoint: allMatches[0]!,
            limit: nestedLimit,
          });
        }
      }
      const traceReferences =
        trace === null
          ? limited.matches
          : [
              trace.endpoint,
              {
                diagnosticIds: trace.diagnosticIds.items,
                evidenceIds: uniqueQueryStrings([
                  ...trace.guards.items.flatMap(({ evidenceIds }) => evidenceIds),
                  ...trace.steps.items.flatMap(({ evidenceIds }) => evidenceIds),
                ]),
              },
            ];
      return endpointTraceQueryResponseSchema.parse({
        schemaVersion: QUERY_SCHEMA_VERSION,
        state,
        selector: request.selector,
        metadata: queryOperationMetadata({
          artifacts: [artifact.descriptor],
          page: unpagedSummary(limited.summary),
          references: traceReferences,
        }),
        matches: limited.matches,
        trace,
      }) as EndpointTraceQueryResponse;
    },
    compareAnalyses(rawRequest) {
      const request = parseRequest(compareAnalysesRequestSchema, rawRequest);
      const { before, after } = pairArtifacts(
        request.beforeArtifactName,
        request.afterArtifactName,
      );
      const comparison = compareAnalysisDocuments(before.input.document, after.input.document);
      const allChanges = projectDiffChanges(comparison).filter(
        ({ family }) => request.families === undefined || request.families.includes(family),
      );
      const page = paginateQueryItems({
        items: allChanges,
        keyFor: ({ key }) => key,
        cursor: request.cursor,
        requested: request.limit,
        limits,
      });
      const resultArtifact = describeQueryArtifact({
        name: 'derived-comparison',
        kind: 'comparison',
        document: comparison,
      });
      return compareAnalysesResponseSchema.parse({
        schemaVersion: QUERY_SCHEMA_VERSION,
        beforeArtifact: before.descriptor,
        afterArtifact: after.descriptor,
        summary: comparison.summary,
        metadata: queryOperationMetadata({
          artifacts: [before.descriptor, after.descriptor],
          resultArtifact,
          page,
          references: page.items.map((item) => ({
            diagnosticIds: item.canonicalIds.filter((id) => id.startsWith('diagnostic:')),
            evidenceIds: item.evidenceIds,
          })),
        }),
        changes: page.items,
      }) as unknown as CompareAnalysesResponse;
    },
    getChangeImpact(rawRequest) {
      const request = parseRequest(changeImpactRequestSchema, rawRequest);
      const { before, after } = pairArtifacts(
        request.beforeArtifactName,
        request.afterArtifactName,
      );
      const impact = analyzePotentialImpact(before.input.document, after.input.document);
      const allImpacts = queryImpactFamilies(projectImpactItems(impact), request.families);
      const page = paginateQueryItems({
        items: allImpacts,
        keyFor: ({ key }) => key,
        cursor: request.cursor,
        requested: request.limit,
        limits,
      });
      const resultArtifact = describeQueryArtifact({
        name: 'derived-impact',
        kind: 'impact',
        document: impact,
      });
      return changeImpactResponseSchema.parse({
        schemaVersion: QUERY_SCHEMA_VERSION,
        beforeArtifact: before.descriptor,
        afterArtifact: after.descriptor,
        summary: impact.summary,
        metadata: queryOperationMetadata({
          artifacts: [before.descriptor, after.descriptor],
          resultArtifact,
          page,
          references: page.items.map((item) => ({
            diagnosticIds: item.canonicalIds.filter((id) => id.startsWith('diagnostic:')),
            evidenceIds: item.evidenceIds,
          })),
        }),
        impacts: page.items,
      }) as unknown as ChangeImpactResponse;
    },
    getSymbolDependents(rawRequest) {
      const request = parseRequest(symbolDependentsRequestSchema, rawRequest);
      const artifact = analysisArtifact(request.artifactName);
      const allMatches = symbolMatches(artifact, request.selector);
      const selectorMatches = limitMatches(allMatches, request.limit, limits);
      const limitedMatches = selectorMatches.matches;
      const nestedLimit = Math.min(request.limit ?? limits.defaultResults, limits.maxResults);
      const maxDepth = Math.min(
        request.maxDepth ?? limits.maxTraversalDepth,
        limits.maxTraversalDepth,
      );
      const maxStates = Math.min(
        request.maxStates ?? limits.maxTraversalStates,
        limits.maxTraversalStates,
      );
      const traversal =
        allMatches.length === 1
          ? findSymbolDependentPaths({
              analysis: artifact.input.document,
              root: allMatches[0]!,
              maxDepth,
              maxStates,
            })
          : { seedMethodIds: [], paths: [], visitedStates: 0, truncated: false };
      const page = paginateQueryItems({
        items: traversal.paths,
        keyFor: ({ key }) => key,
        cursor: request.cursor,
        requested: request.limit,
        limits,
      });
      return symbolDependentsResponseSchema.parse({
        schemaVersion: QUERY_SCHEMA_VERSION,
        state: selectorState(allMatches.length),
        selector: request.selector,
        metadata: queryOperationMetadata({
          artifacts: [artifact.descriptor],
          page,
          references: [
            ...limitedMatches,
            ...page.items.map(({ diagnosticIds, evidenceIds }) => ({ diagnosticIds, evidenceIds })),
          ],
        }),
        selectorLimits: selectorMatches.summary,
        matches: limitedMatches,
        seedMethods: boundedQueryCollection(traversal.seedMethodIds, nestedLimit),
        traversal: {
          maxDepth,
          maxStates,
          visitedStates: traversal.visitedStates,
          truncated: traversal.truncated,
        },
        dependents: page.items,
      }) as SymbolDependentsResponse;
    },
    findDistributedCandidates(rawRequest) {
      const request = parseRequest(distributedCandidatesRequestSchema, rawRequest);
      const artifact = artifactOfKind(request.artifactName, 'system_analysis');
      const allCandidates = projectDistributedCandidates({
        system: artifact.input.document,
        request,
      });
      const page = paginateQueryItems({
        items: allCandidates,
        keyFor: ({ key }) => key,
        cursor: request.cursor,
        requested: request.limit,
        limits,
      });
      return distributedCandidatesResponseSchema.parse({
        schemaVersion: QUERY_SCHEMA_VERSION,
        selectionState: selectorState(allCandidates.length),
        kind: request.kind,
        target: request.target,
        contractKey: systemInteractionContractKey(request.target),
        metadata: queryOperationMetadata({
          artifacts: [artifact.descriptor],
          page,
          references: page.items.map(({ diagnosticIds }) => ({ diagnosticIds, evidenceIds: [] })),
        }),
        candidates: page.items,
      }) as DistributedCandidatesResponse;
    },
    getPolicyResults(rawRequest) {
      const request = parseRequest(policyResultsRequestSchema, rawRequest);
      const artifact = artifactOfKind(request.artifactName, 'policy');
      const filters = request.filters ?? {};
      const allResults = filterPolicyResults(artifact.input.document, filters);
      const page = paginateQueryItems({
        items: allResults,
        keyFor: ({ key }) => key,
        cursor: request.cursor,
        requested: request.limit,
        limits,
      });
      return policyResultsResponseSchema.parse({
        schemaVersion: QUERY_SCHEMA_VERSION,
        selectionState: selectorState(allResults.length),
        filters,
        sourceSummary: artifact.input.document.summary,
        filteredSummary: summarizePolicyResults(allResults),
        metadata: queryOperationMetadata({
          artifacts: [artifact.descriptor],
          page,
          references: page.items.map(({ evidenceIds }) => ({ diagnosticIds: [], evidenceIds })),
        }),
        results: page.items,
      }) as PolicyResultsResponse;
    },
  };
}
