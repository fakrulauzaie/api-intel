import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMcpArtifactRegistry } from '../../../src/mcp/registry.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import { evaluatePolicies, normalizePolicyConfiguration } from '../../../src/policy/index.js';
import { serializePolicyResults } from '../../../src/policy/ordering.js';
import {
  serializeCanonicalSystemAnalysis,
  stitchSystemAnalyses,
} from '../../../src/system-analysis/index.js';
import { createMinimalAnalysisDocumentV8 } from '../../helpers/minimal-analysis.js';
import { createTemporaryDirectory, type TemporaryDirectory } from '../../helpers/temp-directory.js';

const temporaryDirectories: TemporaryDirectory[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => directory.cleanup()));
});

async function fixtureArtifacts(): Promise<{
  readonly analysisPath: string;
  readonly systemPath: string;
  readonly policyPath: string;
}> {
  const directory = await createTemporaryDirectory();
  temporaryDirectories.push(directory);
  const base = createMinimalAnalysisDocumentV8();
  const analysis = {
    ...base,
    interactionAnalysis: {
      ...base.interactionAnalysis,
      supportedKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      enabledKinds: ['outbound_http', 'in_process_event', 'job_queue', 'microservice_message'],
      state: 'complete',
    },
  } as const;
  const system = stitchSystemAnalyses({
    systemName: 'mcp-fixture',
    services: [
      {
        namespace: 'health-service',
        artifactLabel: 'analysis.json',
        analysis,
      },
    ],
  });
  const analysisPath = join(directory.path, 'analysis.json');
  const systemPath = join(directory.path, 'system-analysis.json');
  const policyPath = join(directory.path, 'policy-results.json');
  const policy = evaluatePolicies({
    analysis,
    configuration: normalizePolicyConfiguration({
      version: 1,
      rules: { 'no-repository-access-in-controller': 'error' },
    }),
  });
  await Promise.all([
    writeFile(analysisPath, serializeCanonicalAnalysis(analysis), 'utf8'),
    writeFile(systemPath, serializeCanonicalSystemAnalysis(system), 'utf8'),
    writeFile(policyPath, serializePolicyResults(policy), 'utf8'),
  ]);
  return { analysisPath, systemPath, policyPath };
}

describe('MCP immutable artifact registry', () => {
  it('loads each canonical path once and binds explicit roles to the query kernel', async () => {
    const { analysisPath, systemPath, policyPath } = await fixtureArtifacts();
    let reads = 0;
    const registry = await loadMcpArtifactRegistry({
      artifacts: [
        { role: 'analysis', name: 'health', path: analysisPath },
        { role: 'system', name: 'platform', path: systemPath },
        { role: 'policy', name: 'architecture', path: policyPath },
        { role: 'before', name: 'baseline', path: join(analysisPath, '..', 'analysis.json') },
        { role: 'after', name: 'current', path: analysisPath },
      ],
      dependencies: {
        readTextFile: async (path) => {
          reads += 1;
          return readFile(path, 'utf8');
        },
      },
    });

    expect(reads).toBe(3);
    expect(registry.artifacts.map(({ name }) => name)).toEqual([
      'architecture',
      'baseline',
      'current',
      'health',
      'platform',
    ]);
    expect(registry.roles).toEqual({
      analysisArtifactNames: ['health'],
      systemArtifactNames: ['platform'],
      policyArtifactNames: ['architecture'],
      beforeArtifactName: 'baseline',
      afterArtifactName: 'current',
    });
    expect(registry.queryKernel.listEndpoints({ artifactName: 'health' })).toMatchObject({
      endpoints: [{ httpMethod: 'GET', path: '/health' }],
    });
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.queryKernel)).toBe(true);
    expect(Object.isFrozen(registry.artifacts)).toBe(true);
    expect(Object.isFrozen(registry.roles)).toBe(true);
    expect(Object.isFrozen(registry.roles.analysisArtifactNames)).toBe(true);
    expect(Object.isFrozen(registry.roles.policyArtifactNames)).toBe(true);
    expect(Object.isFrozen(registry.resourceIndex)).toBe(true);
    expect(Object.isFrozen(registry.runtime)).toBe(true);
  });

  it('rejects an empty or over-limit registry before loading any path', async () => {
    await expect(loadMcpArtifactRegistry({ artifacts: [] })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENTS',
    });
    await expect(
      loadMcpArtifactRegistry({
        artifacts: [
          { role: 'analysis', name: 'one', path: 'one.json' },
          { role: 'analysis', name: 'two', path: 'two.json' },
        ],
        maxArtifactCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
  });

  it('checks the startup size limit before reading artifact content', async () => {
    let reads = 0;
    await expect(
      loadMcpArtifactRegistry({
        artifacts: [{ role: 'analysis', name: 'current', path: 'oversized.json' }],
        maxArtifactBytes: 16,
        dependencies: {
          canonicalizePath: async (path) => path,
          fileSize: async () => 17,
          readTextFile: async () => {
            reads += 1;
            return '{}';
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' });
    expect(reads).toBe(0);
  });

  it('rejects invalid JSON, invalid schemas, and non-completed analyses before serving', async () => {
    const cases = [
      { text: '{', code: 'ARTIFACT_JSON_INVALID' },
      { text: '{}', code: 'ARTIFACT_SCHEMA_INVALID' },
      {
        text: JSON.stringify({ ...createMinimalAnalysisDocumentV8(), resultState: 'failed' }),
        code: 'ANALYSIS_NOT_COMPLETED',
      },
    ] as const;
    for (const entry of cases) {
      await expect(
        loadMcpArtifactRegistry({
          artifacts: [{ role: 'analysis', name: 'current', path: 'artifact.json' }],
          dependencies: {
            canonicalizePath: async (path) => path,
            fileSize: async () => Buffer.byteLength(entry.text),
            readTextFile: async () => entry.text,
          },
        }),
      ).rejects.toMatchObject({ code: entry.code });
    }
  });
});
