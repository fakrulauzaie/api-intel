import type { AssertionStatus } from '../model/assertions.js';
import type { ClassRole, HttpMethod } from '../model/entities.js';

export const QUERY_SCHEMA_VERSION = '1.0.0' as const;

export const QUERY_ARTIFACT_KINDS = [
  'analysis',
  'comparison',
  'impact',
  'policy',
  'system_analysis',
  'system_report',
] as const;
export type QueryArtifactKind = (typeof QUERY_ARTIFACT_KINDS)[number];

export const QUERY_ARTIFACT_RESULT_STATES = [
  'completed',
  'completed_with_gaps',
  'failed',
  'canceled',
  'not_declared',
] as const;
export type QueryArtifactResultState = (typeof QUERY_ARTIFACT_RESULT_STATES)[number];

export const QUERY_SELECTOR_STATES = ['not_found', 'resolved', 'ambiguous'] as const;
export type QuerySelectorState = (typeof QUERY_SELECTOR_STATES)[number];

export const QUERY_SYMBOL_KINDS = ['class', 'method'] as const;
export type QuerySymbolKind = (typeof QUERY_SYMBOL_KINDS)[number];

export interface QueryArtifactDescriptor {
  readonly name: string;
  readonly kind: QueryArtifactKind;
  /** Content-addressed identity of the complete canonical artifact. */
  readonly documentId: string;
  /** Native canonical identity when that document family defines one. */
  readonly canonicalDocumentId: string | null;
  readonly schemaVersion: string;
  readonly resultState: QueryArtifactResultState;
}

export interface QueryLimitSummary {
  readonly requested: number | null;
  readonly applied: number;
  readonly totalMatches: number;
  readonly returned: number;
  readonly omitted: number;
}

export interface QueryResponseMetadata {
  readonly querySchemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly artifact: QueryArtifactDescriptor;
  readonly limits: QueryLimitSummary;
  readonly diagnosticIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export type EndpointSelector =
  | {
      readonly by: 'canonical_id';
      readonly canonicalId: string;
    }
  | {
      readonly by: 'route';
      readonly httpMethod: HttpMethod;
      readonly path: string;
    };

export interface EndpointResolutionRequest {
  readonly artifactName: string;
  readonly selector: EndpointSelector;
  readonly limit?: number | undefined;
}

export interface EndpointHandlerReference {
  readonly assertionId: string;
  readonly methodId: string | null;
  readonly status: AssertionStatus;
  readonly evidenceIds: readonly string[];
}

export interface EndpointQueryMatch {
  readonly canonicalId: string;
  readonly httpMethod: HttpMethod;
  readonly path: string;
  readonly handlers: readonly EndpointHandlerReference[];
  readonly diagnosticIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface EndpointResolutionResponse {
  readonly schemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly state: QuerySelectorState;
  readonly selector: EndpointSelector;
  readonly metadata: QueryResponseMetadata;
  readonly matches: readonly EndpointQueryMatch[];
}

export interface QuerySourcePosition {
  readonly line: number;
  readonly column: number;
}

export type SymbolSelector =
  | {
      readonly by: 'canonical_id';
      readonly canonicalId: string;
    }
  | {
      readonly by: 'declaration';
      readonly sourcePath: string;
      readonly qualifiedName: string;
      readonly kind?: QuerySymbolKind | undefined;
      readonly location?: QuerySourcePosition | undefined;
    };

export interface SymbolResolutionRequest {
  readonly artifactName: string;
  readonly selector: SymbolSelector;
  readonly limit?: number | undefined;
}

export interface QuerySourceRange extends QuerySourcePosition {
  readonly endLine: number;
  readonly endColumn: number;
}

interface SymbolQueryMatchBase {
  readonly canonicalId: string;
  readonly sourceFileId: string;
  readonly sourcePath: string;
  readonly qualifiedName: string;
  readonly displayName: string;
  readonly declarationEvidenceId: string;
  readonly declaration: QuerySourceRange;
  readonly diagnosticIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface ClassSymbolQueryMatch extends SymbolQueryMatchBase {
  readonly kind: 'class';
  readonly roles: readonly ClassRole[];
}

export interface MethodSymbolQueryMatch extends SymbolQueryMatchBase {
  readonly kind: 'method';
  readonly classId: string;
  readonly signature: string;
}

export type SymbolQueryMatch = ClassSymbolQueryMatch | MethodSymbolQueryMatch;

export interface SymbolResolutionResponse {
  readonly schemaVersion: typeof QUERY_SCHEMA_VERSION;
  readonly state: QuerySelectorState;
  readonly selector: SymbolSelector;
  readonly metadata: QueryResponseMetadata;
  readonly matches: readonly SymbolQueryMatch[];
}

export interface QueryKernelLimits {
  readonly defaultResults: number;
  readonly maxResults: number;
  readonly maxTraversalDepth: number;
  readonly maxTraversalStates: number;
}

export const QUERY_INPUT_ERROR_CODES = [
  'INVALID_ARTIFACT_NAME',
  'DUPLICATE_ARTIFACT_NAME',
  'ARTIFACT_NOT_FOUND',
  'ARTIFACT_KIND_MISMATCH',
  'INVALID_LIMITS',
  'INVALID_QUERY',
] as const;
export type QueryInputErrorCode = (typeof QUERY_INPUT_ERROR_CODES)[number];

export class QueryInputError extends Error {
  constructor(
    readonly code: QueryInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QueryInputError';
  }
}
