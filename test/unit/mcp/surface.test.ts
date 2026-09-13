import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnalysisDocument } from '../../../src/model/analysis.js';
import { evaluatePolicies, normalizePolicyConfiguration } from '../../../src/policy/index.js';
import {
  changeImpactResponseSchema,
  compareAnalysesResponseSchema,
  createQueryKernel,
  distributedCandidatesResponseSchema,
  endpointTraceQueryResponseSchema,
  listEndpointsResponseSchema,
  policyResultsResponseSchema,
  symbolDependentsResponseSchema,
  symbolResolutionResponseSchema,
  type QueryArtifactInput,
} from '../../../src/query/index.js';
import {
  stitchSystemAnalyses,
  type SystemAnalysisDocument,
} from '../../../src/system-analysis/index.js';
import type { McpArtifactRegistry, McpArtifactRoles } from '../../../src/mcp/model.js';
import { MCP_ARTIFACT_ROLES, MCP_RUNTIME_METADATA } from '../../../src/mcp/model.js';
import { createMcpResourceIndex } from '../../../src/mcp/resources.js';
import { MCP_RESOURCE_TEMPLATES } from '../../../src/mcp/resource-server.js';
import { createArtifactMcpServer } from '../../../src/mcp/server.js';
import { MCP_TOOL_NAMES } from '../../../src/mcp/tools.js';
import { createMinimalAnalysisDocumentV8 } from '../../helpers/minimal-analysis.js';
import { createMcpProtocolSession } from '../../helpers/mcp-protocol.js';

interface SurfaceManifest {
  readonly schemaVersion: string;
  readonly server: { readonly name: string; readonly version: string };
  readonly startupInputs: readonly string[];
  readonly tools: readonly string[];
  readonly resources: readonly string[];
  readonly resourceTemplates: readonly string[];
  readonly semanticBoundaries: readonly string[];
  readonly nonGoals: readonly string[];
}

const servers: ReturnType<typeof createArtifactMcpServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function analysis(): AnalysisDocument {
  const base = createMinimalAnalysisDocumentV8();
  return {
    ...base,
    interactionAnalysis: {
      ...base.interactionAnalysis,
      supportedKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      enabledKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      state: 'complete',
    },
  };
}

function system(document: AnalysisDocument): SystemAnalysisDocument {
  return stitchSystemAnalyses({
    systemName: 'mcp-surface',
    services: [{ namespace: 'health-service', artifactLabel: 'analysis.json', analysis: document }],
  });
}

function registry(): {
  readonly registry: McpArtifactRegistry;
  readonly analysis: AnalysisDocument;
} {
  const current = analysis();
  const policy = evaluatePolicies({
    analysis: current,
    configuration: normalizePolicyConfiguration({
      version: 1,
      rules: { 'no-repository-access-in-controller': 'error' },
    }),
  });
  const artifacts: readonly QueryArtifactInput[] = [
    { name: 'current', kind: 'analysis', document: current },
    { name: 'baseline', kind: 'analysis', document: current },
    { name: 'after', kind: 'analysis', document: current },
    { name: 'platform', kind: 'system_analysis', document: system(current) },
    { name: 'architecture', kind: 'policy', document: policy },
  ];
  const roles: McpArtifactRoles = Object.freeze({
    analysisArtifactNames: Object.freeze(['current']),
    systemArtifactNames: Object.freeze(['platform']),
    policyArtifactNames: Object.freeze(['architecture']),
    beforeArtifactName: 'baseline',
    afterArtifactName: 'after',
  });
  const queryKernel = Object.freeze(createQueryKernel({ artifacts }));
  return {
    analysis: current,
    registry: Object.freeze({
      queryKernel,
      artifacts: queryKernel.artifacts,
      roles,
      resourceIndex: createMcpResourceIndex({ artifacts, roles }),
      runtime: MCP_RUNTIME_METADATA,
    }),
  };
}

describe('Phase P1.2 MCP tools and resources', () => {
  it('matches the frozen surface and advertises only bounded read capabilities', async () => {
    const expected = JSON.parse(
      await readFile(resolve('test/fixtures/mcp/p1-2-surface.expected.json'), 'utf8'),
    ) as SurfaceManifest;
    expect(expected.server).toEqual({
      name: MCP_RUNTIME_METADATA.server.name,
      version: '1.1.0',
    });
    expect(expected.startupInputs).toEqual([...MCP_ARTIFACT_ROLES].sort());
    expect(expected.tools).toEqual([...MCP_TOOL_NAMES].sort());
    expect(expected.resourceTemplates).toEqual([...MCP_RESOURCE_TEMPLATES].sort());

    const { registry: artifactRegistry } = registry();
    const server = createArtifactMcpServer(artifactRegistry);
    servers.push(server);
    const session = await createMcpProtocolSession(server, 'api-intel-p1-2-test');
    const tools = (await session.request('tools/list', {})).tools as readonly {
      readonly name: string;
      readonly annotations: Record<string, unknown>;
    }[];
    const resources = (await session.request('resources/list', {})).resources as readonly {
      readonly uri: string;
    }[];
    const templates = (await session.request('resources/templates/list', {}))
      .resourceTemplates as readonly { readonly uriTemplate: string }[];

    expect(tools.map(({ name }) => name).sort()).toEqual(expected.tools);
    expect(
      tools.every(
        ({ annotations }) =>
          annotations.readOnlyHint === true &&
          annotations.destructiveHint === false &&
          annotations.idempotentHint === true &&
          annotations.openWorldHint === false,
      ),
    ).toBe(true);
    expect(resources.map(({ uri }) => uri)).toEqual(expected.resources);
    expect(templates.map(({ uriTemplate }) => uriTemplate).sort()).toEqual(
      expected.resourceTemplates,
    );
    await session.close();
  });

  it('delegates all eight tools to the P0 query kernel with structured and concise text', async () => {
    const { registry: artifactRegistry, analysis: current } = registry();
    const endpoint = current.endpoints[0]!;
    const method = current.methods[0]!;
    const server = createArtifactMcpServer(artifactRegistry);
    servers.push(server);
    const session = await createMcpProtocolSession(server, 'api-intel-p1-2-test');
    const cases = [
      {
        name: 'list_endpoints',
        arguments: { artifactName: 'current' },
        schema: listEndpointsResponseSchema,
      },
      {
        name: 'get_endpoint_trace',
        arguments: {
          artifactName: 'current',
          selector: { by: 'canonical_id', canonicalId: endpoint.id },
        },
        schema: endpointTraceQueryResponseSchema,
      },
      {
        name: 'resolve_symbol',
        arguments: {
          artifactName: 'current',
          selector: { by: 'canonical_id', canonicalId: method.id },
        },
        schema: symbolResolutionResponseSchema,
      },
      {
        name: 'get_symbol_dependents',
        arguments: {
          artifactName: 'current',
          selector: { by: 'canonical_id', canonicalId: method.id },
        },
        schema: symbolDependentsResponseSchema,
      },
      {
        name: 'compare_analyses',
        arguments: { beforeArtifactName: 'baseline', afterArtifactName: 'after' },
        schema: compareAnalysesResponseSchema,
      },
      {
        name: 'get_change_impact',
        arguments: { beforeArtifactName: 'baseline', afterArtifactName: 'after' },
        schema: changeImpactResponseSchema,
      },
      {
        name: 'find_distributed_candidates',
        arguments: {
          artifactName: 'platform',
          kind: 'job_queue',
          target: {
            targetKind: 'job_queue',
            technology: 'bullmq',
            queue: 'reports',
            job: 'generate',
          },
        },
        schema: distributedCandidatesResponseSchema,
      },
      {
        name: 'get_policy_results',
        arguments: { artifactName: 'architecture' },
        schema: policyResultsResponseSchema,
      },
    ] as const;

    for (const entry of cases) {
      const response = await session.request('tools/call', {
        name: entry.name,
        arguments: entry.arguments,
      });
      expect(entry.schema.safeParse(response.structuredContent).success, entry.name).toBe(true);
      const content = response.content as readonly {
        readonly type: string;
        readonly text: string;
      }[];
      expect(content).toHaveLength(1);
      expect(content[0]).toMatchObject({ type: 'text' });
      expect(content[0]!.text.length).toBeLessThan(512);
    }
    await session.close();
  });

  it('serves only a registry summary and exact selected evidence or records', async () => {
    const { registry: artifactRegistry, analysis: current } = registry();
    const summary = artifactRegistry.resourceIndex.artifactSummary();
    const evidence = artifactRegistry.resourceIndex.evidence('current', current.evidence[0]!.id);
    const record = artifactRegistry.resourceIndex.record('current', current.endpoints[0]!.id);

    expect(JSON.parse(summary.text)).toMatchObject({
      schemaVersion: '1.0.0',
      artifacts: expect.arrayContaining([expect.objectContaining({ name: 'current' })]),
    });
    expect(JSON.parse(evidence!.text)).toMatchObject({
      artifact: { name: 'current' },
      collection: 'evidence',
      evidence: { id: current.evidence[0]!.id },
    });
    expect(JSON.parse(record!.text)).toMatchObject({
      artifact: { name: 'current' },
      collection: 'endpoints',
      record: { id: current.endpoints[0]!.id },
    });
    expect(artifactRegistry.resourceIndex.evidence('current', 'evidence:missing')).toBeNull();
    expect(artifactRegistry.resourceIndex.record('current', 'endpoint:missing')).toBeNull();
    expect(summary.text).not.toContain('export class HealthController');

    const server = createArtifactMcpServer(artifactRegistry);
    servers.push(server);
    const session = await createMcpProtocolSession(server, 'api-intel-p1-2-test');
    const evidenceUri = `api-intel://artifact/current/evidence/${encodeURIComponent(current.evidence[0]!.id)}`;
    const recordUri = `api-intel://artifact/current/record/${encodeURIComponent(current.endpoints[0]!.id)}`;
    for (const uri of [summary.uri, evidenceUri, recordUri]) {
      const response = await session.request('resources/read', { uri });
      const projected = response.contents as readonly { readonly text: string }[];
      expect(projected).toHaveLength(1);
      expect(() => JSON.parse(projected[0]!.text) as unknown).not.toThrow();
    }
    await session.close();
  });
});
