import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { QueryArtifactDescriptor, QueryKernel } from '../query/index.js';
import { QUERY_SCHEMA_VERSION } from '../query/index.js';
import { TOOL_NAME, TOOL_VERSION } from '../version.js';

export const MCP_SERVER_NAME = 'api-intel-artifact-server' as const;
export const MCP_SERVER_VERSION = '1.2.0' as const;
export const MCP_SDK_NAME = '@modelcontextprotocol/server' as const;
export const MCP_SDK_VERSION = '2.0.0' as const;
export const DEFAULT_MCP_ARTIFACT_MAX_BYTES = 64 * 1_024 * 1_024;
export const DEFAULT_MCP_ARTIFACT_MAX_COUNT = 64;
export const DEFAULT_MCP_RESOURCE_MAX_BYTES = 256 * 1_024;
export const DEFAULT_MCP_TOOL_RESPONSE_MAX_BYTES = 512 * 1_024;
export const MCP_TOOL_SUMMARY_MAX_CHARACTERS = 512;
export const MCP_RESOURCE_SCHEMA_VERSION = '1.0.0' as const;

export const MCP_RUNTIME_METADATA = Object.freeze({
  server: Object.freeze({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }),
  engine: Object.freeze({ name: TOOL_NAME, version: TOOL_VERSION }),
  querySchemaVersion: QUERY_SCHEMA_VERSION,
  sdk: Object.freeze({ name: MCP_SDK_NAME, version: MCP_SDK_VERSION }),
});

export const MCP_ARTIFACT_ROLES = ['analysis', 'system', 'policy', 'before', 'after'] as const;
export type McpArtifactRole = (typeof MCP_ARTIFACT_ROLES)[number];

export interface McpArtifactSpec {
  readonly role: McpArtifactRole;
  readonly name: string;
  readonly path: string;
}

export interface McpServeArguments {
  readonly mode: 'serve';
  readonly artifacts: readonly McpArtifactSpec[];
}

export type McpArguments =
  | McpServeArguments
  | { readonly mode: 'help' }
  | { readonly mode: 'version' };

export interface McpArtifactRoles {
  readonly analysisArtifactNames: readonly string[];
  readonly systemArtifactNames: readonly string[];
  readonly policyArtifactNames: readonly string[];
  readonly beforeArtifactName: string | null;
  readonly afterArtifactName: string | null;
}

export interface McpResourceProjection {
  readonly uri: string;
  readonly mimeType: 'application/json';
  readonly text: string;
}

export interface McpResourceIndex {
  readonly summaryUri: 'api-intel://registry/artifacts';
  readonly artifactNames: readonly string[];
  artifactSummary(): McpResourceProjection;
  evidence(artifactName: string, evidenceId: string): McpResourceProjection | null;
  record(artifactName: string, recordId: string): McpResourceProjection | null;
}

export interface McpArtifactRegistry {
  readonly queryKernel: QueryKernel;
  readonly artifacts: readonly QueryArtifactDescriptor[];
  readonly roles: McpArtifactRoles;
  readonly resourceIndex: McpResourceIndex;
  readonly runtime: typeof MCP_RUNTIME_METADATA;
}

export interface McpProcessIo {
  readonly writeOut: (message: string) => void;
  readonly writeError: (message: string) => void;
  readonly signal?: AbortSignal | undefined;
}

export interface McpEntryResult {
  readonly exitCode: number;
  readonly serverStarted: boolean;
  readonly handle: StdioServerHandle | null;
}

export const MCP_EXIT_CODE = Object.freeze({ success: 0, internalError: 1, usageError: 2 });

export const MCP_STARTUP_ERROR_CODES = [
  'INVALID_ARGUMENTS',
  'ARTIFACT_STAT_FAILED',
  'ARTIFACT_TOO_LARGE',
  'ARTIFACT_READ_FAILED',
  'ARTIFACT_JSON_INVALID',
  'ARTIFACT_SCHEMA_INVALID',
  'ANALYSIS_NOT_COMPLETED',
] as const;
export type McpStartupErrorCode = (typeof MCP_STARTUP_ERROR_CODES)[number];

export class McpStartupError extends Error {
  constructor(
    readonly code: McpStartupErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'McpStartupError';
  }
}
