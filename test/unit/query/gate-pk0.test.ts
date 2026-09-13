import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStableId } from '../../../src/model/ids.js';
import { createQueryKernel, type QueryInputError } from '../../../src/query/index.js';
import {
  createMinimalAnalysisDocument,
  createMinimalAnalysisDocumentV2,
  createMinimalAnalysisDocumentV3,
  createMinimalAnalysisDocumentV4,
  createMinimalAnalysisDocumentV5,
  createMinimalAnalysisDocumentV6,
  createMinimalAnalysisDocumentV7,
  createMinimalAnalysisDocumentV8,
} from '../../helpers/minimal-analysis.js';
import { createImpactAnalysisSnapshot } from '../../helpers/impact-analysis.js';

interface GateManifest {
  readonly schemaVersion: string;
  readonly operations: readonly string[];
  readonly reverseDependencyPredicates: readonly string[];
  readonly mustPreserve: readonly string[];
  readonly mustNotPerform: readonly string[];
}

function errorCode(error: unknown): string | undefined {
  return (error as Partial<QueryInputError>).code;
}

describe('Gate PK0', () => {
  it('keeps list, trace, and reverse queries compatible across analysis v1-v8', async () => {
    const manifest = JSON.parse(
      await readFile(
        resolve('test/fixtures/query-kernel/bounded-operations.expected.json'),
        'utf8',
      ),
    ) as GateManifest;
    expect(manifest.schemaVersion).toBe('1.0.0');
    expect(manifest.operations).toEqual([...manifest.operations].sort());
    const versions = [
      createMinimalAnalysisDocument(),
      createMinimalAnalysisDocumentV2(),
      createMinimalAnalysisDocumentV3(),
      createMinimalAnalysisDocumentV4(),
      createMinimalAnalysisDocumentV5(),
      createMinimalAnalysisDocumentV6(),
      createMinimalAnalysisDocumentV7(),
      createMinimalAnalysisDocumentV8(),
    ];

    for (const analysis of versions) {
      const endpoint = analysis.endpoints[0]!;
      const method = analysis.methods[0]!;
      const kernel = createQueryKernel({
        artifacts: [{ name: 'analysis', kind: 'analysis', document: analysis }],
      });
      expect(kernel.listEndpoints({ artifactName: 'analysis' })).toMatchObject({
        endpoints: [{ canonicalId: endpoint.id }],
      });
      expect(
        kernel.getEndpointTrace({
          artifactName: 'analysis',
          selector: { by: 'canonical_id', canonicalId: endpoint.id },
        }),
      ).toMatchObject({ state: 'resolved', trace: { endpoint: { canonicalId: endpoint.id } } });
      expect(
        kernel.getSymbolDependents({
          artifactName: 'analysis',
          selector: { by: 'canonical_id', canonicalId: method.id },
        }),
      ).toMatchObject({ state: 'resolved', seedMethods: { items: [method.id], omitted: 0 } });
    }
  });

  it('never selects an arbitrary endpoint and clamps result and traversal work', () => {
    const base = createMinimalAnalysisDocumentV8();
    const duplicate = {
      ...base,
      endpoints: [
        ...base.endpoints,
        {
          ...base.endpoints[0]!,
          id: createStableId('endpoint', ['query-duplicate-route']),
        },
      ],
    };
    const ambiguous = createQueryKernel({
      artifacts: [{ name: 'analysis', kind: 'analysis', document: duplicate }],
      limits: { defaultResults: 1, maxResults: 1 },
    }).getEndpointTrace({
      artifactName: 'analysis',
      selector: { by: 'route', httpMethod: 'GET', path: '/health' },
    });
    expect(ambiguous).toMatchObject({
      state: 'ambiguous',
      trace: null,
      metadata: { limits: { totalMatches: 2, returned: 1, omitted: 1 } },
    });

    const dependencyAnalysis = createImpactAnalysisSnapshot('before', { includeCycle: true });
    const shared = dependencyAnalysis.methods.find(
      ({ qualifiedName }) => qualifiedName === 'SharedService.work',
    )!;
    const bounded = createQueryKernel({
      artifacts: [{ name: 'current', kind: 'analysis', document: dependencyAnalysis }],
      limits: {
        defaultResults: 1,
        maxResults: 1,
        maxTraversalDepth: 2,
        maxTraversalStates: 1,
      },
    }).getSymbolDependents({
      artifactName: 'current',
      selector: { by: 'canonical_id', canonicalId: shared.id },
      maxDepth: 10,
      maxStates: 10_000,
    });
    expect(bounded.traversal).toMatchObject({ maxDepth: 2, maxStates: 1, truncated: true });
    expect(bounded.dependents.length).toBeLessThanOrEqual(1);
    expect(bounded.metadata.limits.applied).toBe(1);
  });

  it('rejects invalid bounds and keeps the query module free of target I/O or execution', async () => {
    const analysis = createMinimalAnalysisDocumentV8();
    try {
      createQueryKernel({
        artifacts: [{ name: 'analysis', kind: 'analysis', document: analysis }],
        limits: { maxTraversalStates: 10_001 },
      });
      throw new Error('Expected invalid traversal limits to fail.');
    } catch (error) {
      expect(errorCode(error)).toBe('INVALID_LIMITS');
    }

    const queryFiles = (await readdir(resolve('src/query'))).filter((name) => name.endsWith('.ts'));
    const implementation = (
      await Promise.all(queryFiles.map((name) => readFile(resolve('src/query', name), 'utf8')))
    ).join('\n');
    expect(implementation).not.toMatch(/node:(?:fs|child_process|net|http|https)/u);
    expect(implementation).not.toMatch(/\b(?:fetch|eval|Function)\s*\(/u);
    expect(implementation).not.toContain('scanRepository');
    expect(implementation).not.toMatch(/\b(?:writeFile|appendFile|mkdir|rm|unlink)\b/u);
  });
});
