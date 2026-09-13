import type { DiffSummary } from '../comparison/model.js';
import type { ImpactSummary } from '../impact/model.js';
import type {
  EndpointTraceGuard,
  EndpointTraceStep,
  EndpointTraceTerminal,
  ResourceAccessTraceTerminal,
} from '../model/analysis.js';
import type { AssertionStatus } from '../model/assertions.js';
import type { HttpMethod } from '../model/entities.js';
import type {
  PolicyOutcome,
  PolicyResult,
  PolicyRuleId,
  PolicySeverity,
  PolicySummary,
} from '../policy/model.js';
import type {
  SystemCorrelatableInteractionKind,
  SystemCorrelationState,
  SystemInteractionContractTarget,
  SystemInteractionEndpointRecord,
} from '../system-analysis/model.js';
import type {
  EndpointQueryMatch,
  EndpointSelector,
  QueryArtifactDescriptor,
  QueryLimitSummary,
  QuerySelectorState,
  SymbolQueryMatch,
  SymbolSelector,
} from './model.js';
import type { QUERY_SCHEMA_VERSION } from './model.js';

export interface QueryPageSummary {
  readonly cursor: string | null;
  readonly nextCursor: string | null;
  readonly totalItems: number;
  readonly skipped: number;
  readonly remaining: number;
}

export interface QueryOperationMetadata {
  readonly querySchemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly artifacts: readonly QueryArtifactDescriptor[];
  readonly resultArtifact: QueryArtifactDescriptor | null;
  readonly limits: QueryLimitSummary;
  readonly page: QueryPageSummary;
  readonly diagnosticIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface BoundedQueryCollection<T> {
  readonly total: number;
  readonly returned: number;
  readonly omitted: number;
  readonly items: readonly T[];
}

export interface EndpointListFilters {
  readonly httpMethods?: readonly HttpMethod[] | undefined;
  readonly pathPrefix?: string | undefined;
  readonly hasDiagnostics?: boolean | undefined;
}

export interface ListEndpointsRequest {
  readonly artifactName: string;
  readonly filters?: EndpointListFilters | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ListEndpointsResponse {
  readonly schemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly filters: EndpointListFilters;
  readonly metadata: QueryOperationMetadata;
  readonly endpoints: readonly EndpointQueryMatch[];
}

export interface EndpointTraceQueryRequest {
  readonly artifactName: string;
  readonly selector: EndpointSelector;
  readonly limit?: number | undefined;
}

export interface EndpointTraceProjection {
  readonly endpoint: EndpointQueryMatch;
  readonly directGuardState: string;
  readonly globalGuardState: string;
  readonly effectiveGuardState: string;
  readonly guards: BoundedQueryCollection<EndpointTraceGuard>;
  readonly steps: BoundedQueryCollection<EndpointTraceStep>;
  readonly terminals: BoundedQueryCollection<EndpointTraceTerminal>;
  readonly resourceTerminals: BoundedQueryCollection<ResourceAccessTraceTerminal>;
  readonly diagnosticIds: BoundedQueryCollection<string>;
  readonly causalSummary: {
    readonly completeness: { readonly state: string; readonly diagnosticCodes: readonly string[] };
    readonly outboundInteractionIds: BoundedQueryCollection<string>;
    readonly localInteractionIds: BoundedQueryCollection<string>;
    readonly distributedInteractionIds: BoundedQueryCollection<string>;
    readonly jobQueueBranchIds: BoundedQueryCollection<string>;
  } | null;
}

export interface EndpointTraceQueryResponse {
  readonly schemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly state: QuerySelectorState | 'analysis_failure';
  readonly selector: EndpointSelector;
  readonly metadata: QueryOperationMetadata;
  readonly matches: readonly EndpointQueryMatch[];
  readonly trace: EndpointTraceProjection | null;
}

export const QUERY_DIFF_FAMILIES = [
  'endpoint',
  'assertion_status',
  'diagnostic',
  'interaction',
  'interaction_handler',
  'job_queue_dispatch',
  'job_queue_branch',
  'job_queue_branch_effect',
  'ambiguity',
] as const;
export type QueryDiffFamily = (typeof QUERY_DIFF_FAMILIES)[number];

export interface CompareAnalysesRequest {
  readonly beforeArtifactName: string;
  readonly afterArtifactName: string;
  readonly families?: readonly QueryDiffFamily[] | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface QuerySemanticChange {
  readonly key: string;
  readonly family: QueryDiffFamily;
  readonly change: string;
  readonly label: string;
  readonly reasonCodes: readonly string[];
  readonly canonicalIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface CompareAnalysesResponse {
  readonly schemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly beforeArtifact: QueryArtifactDescriptor;
  readonly afterArtifact: QueryArtifactDescriptor;
  readonly summary: DiffSummary;
  readonly metadata: QueryOperationMetadata;
  readonly changes: readonly QuerySemanticChange[];
}

export const QUERY_IMPACT_FAMILIES = [
  'source_change',
  'impacted_endpoint',
  'unreachable_source_change',
] as const;
export type QueryImpactFamily = (typeof QUERY_IMPACT_FAMILIES)[number];

export interface ChangeImpactRequest {
  readonly beforeArtifactName: string;
  readonly afterArtifactName: string;
  readonly families?: readonly QueryImpactFamily[] | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface QueryImpactItem {
  readonly key: string;
  readonly family: QueryImpactFamily;
  readonly change: string;
  readonly label: string;
  readonly direct: boolean | null;
  readonly pathCount: number;
  readonly reasonCodes: readonly string[];
  readonly categories: readonly string[];
  readonly canonicalIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface ChangeImpactResponse {
  readonly schemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly beforeArtifact: QueryArtifactDescriptor;
  readonly afterArtifact: QueryArtifactDescriptor;
  readonly summary: ImpactSummary;
  readonly metadata: QueryOperationMetadata;
  readonly impacts: readonly QueryImpactItem[];
}

export interface SymbolDependentsRequest {
  readonly artifactName: string;
  readonly selector: SymbolSelector;
  readonly maxDepth?: number | undefined;
  readonly maxStates?: number | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface SymbolDependentPathStep {
  readonly assertionId: string;
  readonly fromId: string;
  readonly predicate: string;
  readonly toId: string;
  readonly status: AssertionStatus;
  readonly evidenceIds: readonly string[];
}

export interface SymbolDependentPath {
  readonly key: string;
  readonly subjectKind: 'method' | 'endpoint' | 'interaction_handler';
  readonly subjectId: string;
  readonly displayName: string;
  readonly depth: number;
  readonly certainty: Extract<AssertionStatus, 'resolved' | 'ambiguous'>;
  readonly steps: readonly SymbolDependentPathStep[];
  readonly diagnosticIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface SymbolDependentsResponse {
  readonly schemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly state: QuerySelectorState;
  readonly selector: SymbolSelector;
  readonly metadata: QueryOperationMetadata;
  readonly selectorLimits: QueryLimitSummary;
  readonly matches: readonly SymbolQueryMatch[];
  readonly seedMethods: BoundedQueryCollection<string>;
  readonly traversal: {
    readonly maxDepth: number;
    readonly maxStates: number;
    readonly visitedStates: number;
    readonly truncated: boolean;
  };
  readonly dependents: readonly SymbolDependentPath[];
}

export interface DistributedCandidatesRequest {
  readonly artifactName: string;
  readonly kind: SystemCorrelatableInteractionKind;
  readonly target: SystemInteractionContractTarget;
  readonly states?: readonly SystemCorrelationState[] | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface DistributedCandidate {
  readonly key: string;
  readonly correlationId: string;
  readonly state: SystemCorrelationState;
  readonly contractKey: string;
  readonly brokerRealmId: string | null;
  readonly producer: SystemInteractionEndpointRecord | null;
  readonly consumers: readonly SystemInteractionEndpointRecord[];
  readonly unmatchedReason: string | null;
  readonly ambiguityReason: string | null;
  readonly diagnosticIds: readonly string[];
  readonly canonicalIds: readonly string[];
}

export interface DistributedCandidatesResponse {
  readonly schemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly selectionState: QuerySelectorState;
  readonly kind: SystemCorrelatableInteractionKind;
  readonly target: SystemInteractionContractTarget;
  readonly contractKey: string;
  readonly metadata: QueryOperationMetadata;
  readonly candidates: readonly DistributedCandidate[];
}

export interface PolicyResultsFilters {
  readonly ruleIds?: readonly PolicyRuleId[] | undefined;
  readonly outcomes?: readonly PolicyOutcome[] | undefined;
  readonly severities?: readonly PolicySeverity[] | undefined;
  readonly blocking?: boolean | undefined;
}

export interface PolicyResultsRequest {
  readonly artifactName: string;
  readonly filters?: PolicyResultsFilters | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface QueryPolicyResult extends PolicyResult {
  readonly key: string;
}

export interface PolicyResultsResponse {
  readonly schemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly selectionState: QuerySelectorState;
  readonly filters: PolicyResultsFilters;
  readonly sourceSummary: PolicySummary;
  readonly filteredSummary: PolicySummary;
  readonly metadata: QueryOperationMetadata;
  readonly results: readonly QueryPolicyResult[];
}
