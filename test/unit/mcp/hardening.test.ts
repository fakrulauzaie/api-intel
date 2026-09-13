import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisDocument } from '../../../src/model/analysis.js';
import { redactSecrets } from '../../../src/evidence/redact.js';
import { createStableId } from '../../../src/model/ids.js';
import { canonicalStringify } from '../../../src/model/ordering.js';
import {
  DEFAULT_MCP_ARTIFACT_MAX_BYTES,
  DEFAULT_MCP_ARTIFACT_MAX_COUNT,
  DEFAULT_MCP_RESOURCE_MAX_BYTES,
  DEFAULT_MCP_TOOL_RESPONSE_MAX_BYTES,
  MCP_RUNTIME_METADATA,
  MCP_TOOL_SUMMARY_MAX_CHARACTERS,
  type McpArtifactRegistry,
  type McpArtifactRoles,
} from '../../../src/mcp/model.js';
import { loadMcpArtifactRegistry } from '../../../src/mcp/registry.js';
import { createMcpResourceIndex } from '../../../src/mcp/resources.js';
import { createArtifactMcpServer } from '../../../src/mcp/server.js';
import { evaluatePolicies, normalizePolicyConfiguration } from '../../../src/policy/index.js';
import { createQueryKernel, type QueryArtifactInput } from '../../../src/query/index.js';
import {
  stitchSystemAnalyses,
  type SystemAnalysisDocument,
} from '../../../src/system-analysis/index.js';
import { createMinimalAnalysisDocumentV8 } from '../../helpers/minimal-analysis.js';
import { createMcpProtocolSession } from '../../helpers/mcp-protocol.js';

interface HardeningManifest {
  readonly schemaVersion: string;
  readonly serverVersion: string;
  readonly limits: {
    readonly artifactCount: number;
    readonly artifactBytes: number;
    readonly resourceBytes: number;
    readonly toolResponseBytes: number;
    readonly toolSummaryCharacters: number;
  };
  readonly protocolCases: readonly string[];
  readonly mustPreserve: readonly string[];
  readonly mustNotExpose: readonly string[];
}

const servers: ReturnType<typeof createArtifactMcpServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function analysis(includeAmbiguousRoute = true): AnalysisDocument {
  const base = createMinimalAnalysisDocumentV8();
  return {
    ...base,
    endpoints: includeAmbiguousRoute
      ? [
          ...base.endpoints,
          {
            ...base.endpoints[0]!,
            id: createStableId('endpoint', ['mcp-hardening-duplicate-route']),
          },
        ]
      : base.endpoints,
    evidence: base.evidence.map((record, index) =>
      index === 0
        ? { ...record, snippet: redactSecrets('const token = "mcp-secret-value";') }
        : record,
    ),
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
    systemName: 'mcp-hardening',
    services: [{ namespace: 'health-service', artifactLabel: 'analysis.json', analysis: document }],
  });
}

function registry(
  input: {
    readonly maxResourceBytes?: number;
    readonly includeAmbiguousRoute?: boolean;
  } = {},
): {
  readonly registry: McpArtifactRegistry;
  readonly analysis: AnalysisDocument;
} {
  const current = analysis(input.includeAmbiguousRoute ?? true);
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
      resourceIndex: createMcpResourceIndex({
        artifacts,
        roles,
        ...(input.maxResourceBytes === undefined
          ? {}
          : { maxResourceBytes: input.maxResourceBytes }),
      }),
      runtime: MCP_RUNTIME_METADATA,
    }),
  };
}

function toolCases(current: AnalysisDocument) {
  return [
    { name: 'list_endpoints', arguments: { artifactName: 'current' } },
    {
      name: 'get_endpoint_trace',
      arguments: {
        artifactName: 'current',
        selector: { by: 'canonical_id', canonicalId: current.endpoints[0]!.id },
      },
    },
    {
      name: 'resolve_symbol',
      arguments: {
        artifactName: 'current',
        selector: { by: 'canonical_id', canonicalId: current.methods[0]!.id },
      },
    },
    {
      name: 'get_symbol_dependents',
      arguments: {
        artifactName: 'current',
        selector: { by: 'canonical_id', canonicalId: current.methods[0]!.id },
      },
    },
    {
      name: 'compare_analyses',
      arguments: { beforeArtifactName: 'baseline', afterArtifactName: 'after' },
    },
    {
      name: 'get_change_impact',
      arguments: { beforeArtifactName: 'baseline', afterArtifactName: 'after' },
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
    },
    { name: 'get_policy_results', arguments: { artifactName: 'architecture' } },
  ] as const;
}

describe('Phase P1.3 MCP hardening and Gate MK0', () => {
  it('freezes the hardening limits and capability boundary', async () => {
    const manifest = JSON.parse(
      await readFile(resolve('test/fixtures/mcp/p1-3-hardening.expected.json'), 'utf8'),
    ) as HardeningManifest;
    expect(manifest).toMatchObject({
      schemaVersion: '1.0.0',
      serverVersion: MCP_RUNTIME_METADATA.server.version,
      limits: {
        artifactCount: DEFAULT_MCP_ARTIFACT_MAX_COUNT,
        artifactBytes: DEFAULT_MCP_ARTIFACT_MAX_BYTES,
        resourceBytes: DEFAULT_MCP_RESOURCE_MAX_BYTES,
        toolResponseBytes: DEFAULT_MCP_TOOL_RESPONSE_MAX_BYTES,
        toolSummaryCharacters: MCP_TOOL_SUMMARY_MAX_CHARACTERS,
      },
    });
    expect(manifest.protocolCases).toEqual([...manifest.protocolCases].sort());
    expect(manifest.mustNotExpose).toEqual([...manifest.mustNotExpose].sort());

    const { registry: artifactRegistry } = registry();
    const server = createArtifactMcpServer(artifactRegistry);
    servers.push(server);
    expect(server.server.getCapabilities()).toEqual({
      tools: { listChanged: true },
      resources: { listChanged: true },
      completions: {},
    });
    expect(() => createArtifactMcpServer(artifactRegistry, { maxToolResponseBytes: 0 })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENTS' }),
    );
  });

  it('rejects frozen malformed and oversized startup artifacts before serving', async () => {
    for (const [fixture, code] of [
      ['malformed-analysis.json.txt', 'ARTIFACT_JSON_INVALID'],
      ['wrong-family-analysis.json.txt', 'ARTIFACT_SCHEMA_INVALID'],
    ] as const) {
      await expect(
        loadMcpArtifactRegistry({
          artifacts: [
            {
              role: 'analysis',
              name: 'adversarial',
              path: resolve('test/fixtures/mcp', fixture),
            },
          ],
        }),
      ).rejects.toMatchObject({ code });
    }

    let reads = 0;
    await expect(
      loadMcpArtifactRegistry({
        artifacts: [{ role: 'analysis', name: 'oversized', path: 'oversized.json' }],
        maxArtifactBytes: 32,
        dependencies: {
          canonicalizePath: async (path) => resolve(path),
          fileSize: async () => 33,
          readTextFile: async () => {
            reads += 1;
            return '{}';
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' });
    expect(reads).toBe(0);
  });

  it('preserves ambiguity and rejects path-shaped or oversized protocol inputs', async () => {
    const { registry: artifactRegistry } = registry();
    const server = createArtifactMcpServer(artifactRegistry);
    servers.push(server);
    const session = await createMcpProtocolSession(server, 'api-intel-p1-3-adversarial');

    const ambiguous = await session.request('tools/call', {
      name: 'get_endpoint_trace',
      arguments: {
        artifactName: 'current',
        selector: { by: 'route', httpMethod: 'GET', path: '/health' },
      },
    });
    expect(ambiguous.structuredContent).toMatchObject({
      state: 'ambiguous',
      trace: null,
      metadata: { limits: { totalMatches: 2 } },
    });

    for (const argumentsValue of [
      { artifactName: 'current', path: '../../outside.json' },
      { artifactName: 'platform' },
      {
        artifactName: 'current',
        selector: {
          by: 'declaration',
          sourcePath: '../../outside.ts',
          qualifiedName: 'Outside.run',
        },
      },
      { artifactName: 'current', limit: 1_001 },
    ]) {
      const invalid = await session.request('tools/call', {
        name: argumentsValue.selector === undefined ? 'list_endpoints' : 'resolve_symbol',
        arguments: argumentsValue,
      });
      expect(invalid).toMatchObject({ isError: true });
      expect(JSON.stringify(invalid).length).toBeLessThan(4_096);
    }

    await expect(
      session.request('resources/read', {
        uri: 'api-intel://artifact/..%2Foutside/record/record%3Amissing',
      }),
    ).rejects.toThrow('Invalid resource selector.');
    await expect(
      session.request('resources/read', {
        uri: `api-intel://artifact/current/record/${'x'.repeat(769)}`,
      }),
    ).rejects.toThrow('Invalid resource selector.');
    await session.close();
  });

  it('turns oversized tool and resource projections into bounded protocol errors', async () => {
    const { registry: artifactRegistry } = registry();
    const toolServer = createArtifactMcpServer(artifactRegistry, { maxToolResponseBytes: 64 });
    servers.push(toolServer);
    const toolSession = await createMcpProtocolSession(toolServer, 'api-intel-p1-3-output');
    const toolResponse = await toolSession.request('tools/call', {
      name: 'list_endpoints',
      arguments: { artifactName: 'current' },
    });
    expect(toolResponse).toMatchObject({ isError: true });
    expect(toolResponse.structuredContent).toBeUndefined();
    expect(toolResponse.content).toEqual([
      {
        type: 'text',
        text: 'MCP tool response exceeds the 64-byte limit. Narrow the query with filters, cursors, or a lower limit.',
      },
    ]);
    await toolSession.close();

    const { registry: resourceRegistry } = registry({ maxResourceBytes: 64 });
    const resourceServer = createArtifactMcpServer(resourceRegistry);
    servers.push(resourceServer);
    const resourceSession = await createMcpProtocolSession(
      resourceServer,
      'api-intel-p1-3-resource-output',
    );
    await expect(
      resourceSession.request('resources/read', { uri: resourceRegistry.resourceIndex.summaryUri }),
    ).rejects.toThrow('MCP resource projection exceeds the 64-byte limit');
    await resourceSession.close();
  });

  it('honors protocol cancellation before synchronous kernel execution', async () => {
    const { registry: originalRegistry } = registry();
    const listEndpoints = vi.fn(originalRegistry.queryKernel.listEndpoints);
    const queryKernel = Object.freeze({ ...originalRegistry.queryKernel, listEndpoints });
    const canceledRegistry = Object.freeze({ ...originalRegistry, queryKernel });
    const server = createArtifactMcpServer(canceledRegistry);
    servers.push(server);
    const session = await createMcpProtocolSession(server, 'api-intel-p1-3-cancellation');

    const pending = await session.startRequest('tools/call', {
      name: 'list_endpoints',
      arguments: { artifactName: 'current' },
    });
    void pending.response.catch(() => undefined);
    await session.notify('notifications/cancelled', {
      requestId: pending.id,
      reason: 'Gate MK0 cancellation fixture',
    });
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));

    expect(listEndpoints).not.toHaveBeenCalled();
    expect(session.hasResponse(pending.id)).toBe(false);
    await session.close();
  });

  it('returns byte-stable structured results and retains analyzer redaction', async () => {
    const { registry: artifactRegistry, analysis: current } = registry({
      includeAmbiguousRoute: false,
    });
    const server = createArtifactMcpServer(artifactRegistry);
    servers.push(server);
    const session = await createMcpProtocolSession(server, 'api-intel-p1-3-determinism');

    for (const entry of toolCases(current)) {
      const first = await session.request('tools/call', {
        name: entry.name,
        arguments: entry.arguments,
      });
      const second = await session.request('tools/call', {
        name: entry.name,
        arguments: entry.arguments,
      });
      expect(first.isError, `${entry.name}: ${canonicalStringify(first.content)}`).not.toBe(true);
      expect(canonicalStringify(second.structuredContent), entry.name).toBe(
        canonicalStringify(first.structuredContent),
      );
      expect(Buffer.byteLength(canonicalStringify(first), 'utf8')).toBeLessThanOrEqual(
        DEFAULT_MCP_TOOL_RESPONSE_MAX_BYTES,
      );
    }

    const evidence = artifactRegistry.resourceIndex.evidence('current', current.evidence[0]!.id)!;
    expect(artifactRegistry.resourceIndex.artifactSummary().text).toBe(
      artifactRegistry.resourceIndex.artifactSummary().text,
    );
    expect(artifactRegistry.resourceIndex.evidence('current', current.evidence[0]!.id)!.text).toBe(
      evidence.text,
    );
    expect(artifactRegistry.resourceIndex.record('current', current.endpoints[0]!.id)!.text).toBe(
      artifactRegistry.resourceIndex.record('current', current.endpoints[0]!.id)!.text,
    );
    expect(evidence.text).toContain('[REDACTED]');
    expect(evidence.text).not.toContain('mcp-secret-value');
    expect(artifactRegistry.resourceIndex.artifactSummary().text).not.toContain('.json');
    await session.close();
  });

  it('keeps the runtime free of scan, shell, network, mutation, and sampling surfaces', async () => {
    const files = (await readdir(resolve('src/mcp'))).filter((name) => name.endsWith('.ts'));
    const source = (
      await Promise.all(files.map((name) => readFile(resolve('src/mcp', name), 'utf8')))
    ).join('\n');
    expect(source).not.toContain('scanRepository');
    expect(source).not.toMatch(/node:(?:child_process|net|http|https)/u);
    expect(source).not.toMatch(/\b(?:fetch|eval|Function)\s*\(/u);
    expect(source).not.toMatch(/\b(?:writeFile|appendFile|mkdir|rm|unlink)\b/u);
    expect(source).not.toMatch(/registerPrompt|createMessage|sampling\/createMessage/u);
    expect(source).not.toContain('console.log');
  });
});
