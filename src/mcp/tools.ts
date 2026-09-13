import { fromJsonSchema } from '@modelcontextprotocol/server';
import type {
  CallToolResult,
  JsonSchemaType,
  McpServer,
  ServerContext,
  ToolAnnotations,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { canonicalStringify } from '../model/ordering.js';
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
  symbolResolutionRequestSchema,
  symbolResolutionResponseSchema,
} from '../query/index.js';
import type {
  ChangeImpactResponse,
  CompareAnalysesResponse,
  DistributedCandidatesResponse,
  EndpointTraceQueryResponse,
  ListEndpointsResponse,
  PolicyResultsResponse,
  SymbolDependentsResponse,
  SymbolResolutionResponse,
} from '../query/index.js';
import type { McpArtifactRegistry } from './model.js';
import {
  DEFAULT_MCP_TOOL_RESPONSE_MAX_BYTES,
  MCP_TOOL_SUMMARY_MAX_CHARACTERS,
  McpStartupError,
} from './model.js';
import type { ArtifactMcpServerOptions } from './server.js';

export const MCP_TOOL_NAMES = [
  'list_endpoints',
  'get_endpoint_trace',
  'resolve_symbol',
  'get_symbol_dependents',
  'compare_analyses',
  'get_change_impact',
  'find_distributed_candidates',
  'get_policy_results',
] as const;

const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function mcpSchema<T extends z.ZodType>(schema: T) {
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
  }) as unknown as JsonSchemaType;
  return fromJsonSchema<z.infer<T>>(jsonSchema);
}

function result(output: object, summary: string, maximumBytes: number): CallToolResult {
  if (summary.length > MCP_TOOL_SUMMARY_MAX_CHARACTERS) {
    throw new Error('MCP tool summary exceeds its fixed character limit.');
  }
  const response: CallToolResult = {
    content: [{ type: 'text', text: summary }],
    structuredContent: output as Record<string, unknown>,
  };
  if (Buffer.byteLength(canonicalStringify(response), 'utf8') > maximumBytes) {
    throw new Error(
      `MCP tool response exceeds the ${maximumBytes}-byte limit. Narrow the query with filters, cursors, or a lower limit.`,
    );
  }
  return response;
}

async function executeTool<T extends object>(input: {
  readonly context: ServerContext;
  readonly operation: () => T;
  readonly summarize: (output: T) => string;
  readonly maximumBytes: number;
}): Promise<CallToolResult> {
  // Give an already queued protocol cancellation a chance to abort before the
  // synchronous query kernel begins. Kernel operations remain deliberately local.
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (input.context.mcpReq.signal.aborted) throw new Error('MCP tool request was canceled.');
  const output = input.operation();
  if (input.context.mcpReq.signal.aborted) throw new Error('MCP tool request was canceled.');
  return result(output, input.summarize(output), input.maximumBytes);
}

function listEndpointsSummary(output: ListEndpointsResponse): string {
  return `Endpoints: ${output.endpoints.length} returned of ${output.metadata.page.totalItems}; ${output.metadata.limits.omitted} omitted.`;
}

function endpointTraceSummary(output: EndpointTraceQueryResponse): string {
  if (output.trace === null) {
    return `Endpoint trace: ${output.state}; ${output.matches.length} bounded selector match(es).`;
  }
  return `Endpoint trace: resolved; ${output.trace.steps.returned} step(s), ${output.trace.terminals.returned} database terminal(s), ${output.trace.resourceTerminals.returned} resource terminal(s); completeness ${output.trace.causalSummary?.completeness.state ?? 'not_declared'}.`;
}

function symbolSummary(output: SymbolResolutionResponse): string {
  return `Symbol resolution: ${output.state}; ${output.matches.length} returned of ${output.metadata.limits.totalMatches}.`;
}

function dependentsSummary(output: SymbolDependentsResponse): string {
  return `Current-snapshot dependents: selector ${output.state}; ${output.dependents.length} dependency path(s), ${output.metadata.limits.omitted} omitted; traversal${output.traversal.truncated ? '' : ' not'} truncated.`;
}

function comparisonSummary(output: CompareAnalysesResponse): string {
  const summary = output.summary;
  return `Analysis comparison: ${output.changes.length} change(s) returned; endpoints +${summary.endpointsAdded}/-${summary.endpointsRemoved}/~${summary.endpointsModified}, diagnostics +${summary.diagnosticsNew}/-${summary.diagnosticsResolved}/~${summary.diagnosticsChanged}.`;
}

function impactSummary(output: ChangeImpactResponse): string {
  const summary = output.summary;
  return `Potential change impact: ${summary.directlyChangedEndpointSlots} direct and ${summary.transitivelyImpactedEndpointSlots} transitive endpoint slot(s); ${summary.unreachableSourceChanges} unreachable source change(s); ${output.impacts.length} item(s) returned.`;
}

function distributedSummary(output: DistributedCandidatesResponse): string {
  return `Distributed delivery candidates: ${output.selectionState}; ${output.candidates.length} returned for the exact structural contract. Candidates are static and conditional, not proof of delivery or execution.`;
}

function policySummary(output: PolicyResultsResponse): string {
  const summary = output.filteredSummary;
  return `Policy results: ${output.selectionState}; ${summary.passed} pass, ${summary.failed} fail, ${summary.unknown} unknown, ${summary.notApplicable} not applicable; ${summary.blocking} blocking.`;
}

export function registerMcpTools(
  server: McpServer,
  registry: McpArtifactRegistry,
  options: ArtifactMcpServerOptions = {},
): void {
  const kernel = registry.queryKernel;
  const maximumBytes = options.maxToolResponseBytes ?? DEFAULT_MCP_TOOL_RESPONSE_MAX_BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new McpStartupError(
      'INVALID_ARGUMENTS',
      'MCP tool response byte limit must be a positive integer.',
    );
  }

  server.registerTool(
    'list_endpoints',
    {
      title: 'List API endpoints',
      description: 'List a bounded page of canonical endpoints from one analysis artifact.',
      inputSchema: mcpSchema(listEndpointsRequestSchema),
      outputSchema: mcpSchema(listEndpointsResponseSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (request, context) =>
      executeTool({
        context,
        operation: () => kernel.listEndpoints(request),
        summarize: listEndpointsSummary,
        maximumBytes,
      }),
  );

  server.registerTool(
    'get_endpoint_trace',
    {
      title: 'Get endpoint trace',
      description:
        'Resolve one endpoint and return its bounded guards, call steps, database terminals, resource terminals, and causal completeness.',
      inputSchema: mcpSchema(endpointTraceQueryRequestSchema),
      outputSchema: mcpSchema(endpointTraceQueryResponseSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (request, context) =>
      executeTool({
        context,
        operation: () => kernel.getEndpointTrace(request),
        summarize: endpointTraceSummary,
        maximumBytes,
      }),
  );

  server.registerTool(
    'resolve_symbol',
    {
      title: 'Resolve symbol',
      description:
        'Resolve a class or method by canonical ID or exact source declaration without fuzzy name guessing.',
      inputSchema: mcpSchema(symbolResolutionRequestSchema),
      outputSchema: mcpSchema(symbolResolutionResponseSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (request, context) =>
      executeTool({
        context,
        operation: () => kernel.resolveSymbol(request),
        summarize: symbolSummary,
        maximumBytes,
      }),
  );

  server.registerTool(
    'get_symbol_dependents',
    {
      title: 'Get current-snapshot symbol dependents',
      description:
        'Return bounded reverse dependency paths in one analysis snapshot. This is not change blast-radius analysis.',
      inputSchema: mcpSchema(symbolDependentsRequestSchema),
      outputSchema: mcpSchema(symbolDependentsResponseSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (request, context) =>
      executeTool({
        context,
        operation: () => kernel.getSymbolDependents(request),
        summarize: dependentsSummary,
        maximumBytes,
      }),
  );

  server.registerTool(
    'compare_analyses',
    {
      title: 'Compare analysis artifacts',
      description:
        'Return a bounded semantic before/after comparison from two named analysis artifacts.',
      inputSchema: mcpSchema(compareAnalysesRequestSchema),
      outputSchema: mcpSchema(compareAnalysesResponseSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (request, context) =>
      executeTool({
        context,
        operation: () => kernel.compareAnalyses(request),
        summarize: comparisonSummary,
        maximumBytes,
      }),
  );

  server.registerTool(
    'get_change_impact',
    {
      title: 'Get potential change impact',
      description:
        'Compute bounded evidence-backed direct and transitive impact from a named before/after analysis pair.',
      inputSchema: mcpSchema(changeImpactRequestSchema),
      outputSchema: mcpSchema(changeImpactResponseSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (request, context) =>
      executeTool({
        context,
        operation: () => kernel.getChangeImpact(request),
        summarize: impactSummary,
        maximumBytes,
      }),
  );

  server.registerTool(
    'find_distributed_candidates',
    {
      title: 'Find distributed delivery candidates',
      description:
        'Find bounded static producer/consumer candidates by the complete canonical queue or microservice contract identity.',
      inputSchema: mcpSchema(distributedCandidatesRequestSchema),
      outputSchema: mcpSchema(distributedCandidatesResponseSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (request, context) =>
      executeTool({
        context,
        operation: () => kernel.findDistributedCandidates(request),
        summarize: distributedSummary,
        maximumBytes,
      }),
  );

  server.registerTool(
    'get_policy_results',
    {
      title: 'Get architecture policy results',
      description: 'Filter and page a named, validated policy-results artifact.',
      inputSchema: mcpSchema(policyResultsRequestSchema),
      outputSchema: mcpSchema(policyResultsResponseSchema),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (request, context) =>
      executeTool({
        context,
        operation: () => kernel.getPolicyResults(request),
        summarize: policySummary,
        maximumBytes,
      }),
  );
}
