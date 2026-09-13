import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import type { AnalysisDocumentV8 } from '../../../src/model/analysis.js';
import {
  makeAssertionId,
  makeDiagnosticId,
  makeEndpointId,
  makeEvidenceId,
  makeMethodId,
} from '../../../src/model/ids.js';
import {
  createQueryKernel,
  endpointResolutionResponseSchema,
  symbolResolutionResponseSchema,
  type EndpointResolutionRequest,
  type QueryInputError,
  type SymbolResolutionRequest,
} from '../../../src/query/index.js';
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

interface ExpectedCase {
  readonly caseId: string;
  readonly selectorKind: string;
  readonly expectedState: string;
  readonly expectedPaths?: readonly string[];
  readonly expectedNames?: readonly string[];
}

interface SelectorManifest {
  readonly schemaVersion: string;
  readonly endpointCases: readonly ExpectedCase[];
  readonly symbolCases: readonly ExpectedCase[];
  readonly invalidSelectors: readonly {
    readonly caseId: string;
    readonly sourcePath: string;
    readonly expectedError: string;
  }[];
  readonly mustNotPerform: readonly string[];
}

function createAmbiguousAnalysis(): AnalysisDocumentV8 {
  const base = createMinimalAnalysisDocumentV8();
  const source = base.sourceFiles[0]!;
  const originalMethod = base.methods[0]!;
  const originalEndpoint = base.endpoints[0]!;
  const repositoryRevision = base.analysisRun.repositoryRevision;
  const overloadRange = { startLine: 10, startColumn: 3, endLine: 11, endColumn: 4 };
  const overloadEvidenceId = makeEvidenceId({
    fileId: source.id,
    range: overloadRange,
    role: 'declaration',
    contentHash: source.contentHash,
  });
  const overloadMethodId = makeMethodId({
    path: source.path,
    qualifiedClassName: 'HealthController',
    methodName: 'check',
    signature: 'check(verbose: boolean): string',
    repositoryRevision,
  });
  const overloadEndpointId = makeEndpointId({
    httpMethod: 'GET',
    path: '/health',
    handlerMethodId: overloadMethodId,
    repositoryRevision,
  });
  const handlerAssertionId = makeAssertionId({
    subjectId: overloadEndpointId,
    predicate: 'ENDPOINT_IMPLEMENTED_BY',
    objectId: overloadMethodId,
    ruleId: 'nest.route.standard.v1',
  });
  const routeEvidenceId = base.assertions[0]!.evidenceIds[0]!;
  const diagnosticId = makeDiagnosticId({
    code: 'NEST_ROUTE_DYNAMIC',
    subjectId: originalEndpoint.id,
    evidenceIds: [routeEvidenceId],
  });

  const analysis: AnalysisDocumentV8 = {
    ...base,
    methods: [
      {
        ...originalMethod,
        id: overloadMethodId,
        signature: 'check(verbose: boolean): string',
        declarationEvidenceId: overloadEvidenceId,
      },
      ...base.methods,
    ],
    endpoints: [{ id: overloadEndpointId, httpMethod: 'GET', path: '/health' }, ...base.endpoints],
    assertions: [
      {
        id: handlerAssertionId,
        subjectId: overloadEndpointId,
        predicate: 'ENDPOINT_IMPLEMENTED_BY',
        objectId: overloadMethodId,
        status: 'resolved',
        ruleId: 'nest.route.standard.v1',
        evidenceIds: [routeEvidenceId, overloadEvidenceId],
      },
      ...base.assertions,
    ],
    evidence: [
      {
        id: overloadEvidenceId,
        fileId: source.id,
        ...overloadRange,
        role: 'declaration',
        snippet: 'check(verbose: boolean): string',
        contentHash: source.contentHash,
      },
      ...base.evidence,
    ],
    diagnostics: [
      {
        id: diagnosticId,
        code: 'NEST_ROUTE_DYNAMIC',
        severity: 'warning',
        message: 'Frozen selector diagnostic.',
        subjectId: originalEndpoint.id,
        evidenceIds: [routeEvidenceId],
      },
    ],
  };
  const validation = validateAnalysisDocument(analysis);
  if (!validation.success) {
    throw new Error(`Invalid query fixture: ${JSON.stringify(validation.issues)}`);
  }
  return analysis;
}

function errorCode(error: unknown): string | undefined {
  return (error as Partial<QueryInputError>).code;
}

describe('query selectors', () => {
  it('freezes exact endpoint and symbol resolution, ambiguity, ordering, and limits', async () => {
    const manifest = JSON.parse(
      await readFile(resolve('test/fixtures/query-kernel/selectors.expected.json'), 'utf8'),
    ) as SelectorManifest;
    expect(manifest.schemaVersion).toBe('1.0.0');
    const analysis = createAmbiguousAnalysis();
    const originalMethod = analysis.methods.find(
      ({ signature }) => signature === 'check(): string',
    )!;
    const originalEndpoint = analysis.endpoints.find(({ id }) =>
      analysis.assertions.some(
        ({ subjectId, objectId }) => subjectId === id && objectId === originalMethod.id,
      ),
    )!;
    const kernel = createQueryKernel({
      artifacts: [{ name: 'current', kind: 'analysis', document: analysis }],
      limits: { defaultResults: 25, maxResults: 25 },
    });

    const endpointRequests: Readonly<Record<string, EndpointResolutionRequest>> = {
      'endpoint-by-id': {
        artifactName: 'current',
        selector: { by: 'canonical_id', canonicalId: originalEndpoint.id },
      },
      'endpoint-route-ambiguous': {
        artifactName: 'current',
        selector: { by: 'route', httpMethod: 'GET', path: '/health' },
      },
      'endpoint-not-found': {
        artifactName: 'current',
        selector: { by: 'route', httpMethod: 'POST', path: '/missing' },
      },
    };
    for (const expected of manifest.endpointCases) {
      const response = kernel.resolveEndpoint(endpointRequests[expected.caseId]!);
      expect(endpointResolutionResponseSchema.safeParse(response).success).toBe(true);
      expect(response.state).toBe(expected.expectedState);
      expect(response.matches.map(({ path }) => path)).toEqual(expected.expectedPaths);
      expect(response.matches.map(({ canonicalId }) => canonicalId)).toEqual(
        [...response.matches.map(({ canonicalId }) => canonicalId)].sort(),
      );
    }
    const endpointById = kernel.resolveEndpoint(endpointRequests['endpoint-by-id']!);
    expect(endpointById.metadata.diagnosticIds).toEqual(analysis.diagnostics.map(({ id }) => id));
    expect(endpointById.metadata.evidenceIds.length).toBeGreaterThan(0);
    expect(endpointById.matches[0]?.handlers[0]).toMatchObject({
      methodId: originalMethod.id,
      status: 'resolved',
    });
    expect(
      endpointResolutionResponseSchema.safeParse({ ...endpointById, state: 'not_found' }).success,
    ).toBe(false);
    expect(
      endpointResolutionResponseSchema.safeParse({
        ...endpointById,
        metadata: {
          ...endpointById.metadata,
          limits: { ...endpointById.metadata.limits, omitted: 1 },
        },
      }).success,
    ).toBe(false);
    expect(kernel.resolveEndpoint(endpointRequests['endpoint-by-id']!)).toEqual(endpointById);

    const symbolRequests: Readonly<Record<string, SymbolResolutionRequest>> = {
      'method-by-id': {
        artifactName: 'current',
        selector: { by: 'canonical_id', canonicalId: originalMethod.id },
      },
      'overload-ambiguous': {
        artifactName: 'current',
        selector: {
          by: 'declaration',
          sourcePath: 'src/health.controller.ts',
          qualifiedName: 'HealthController.check',
          kind: 'method',
        },
      },
      'location-disambiguated': {
        artifactName: 'current',
        selector: {
          by: 'declaration',
          sourcePath: 'src/health.controller.ts',
          qualifiedName: 'HealthController.check',
          kind: 'method',
          location: { line: 10, column: 3 },
        },
      },
      'symbol-not-found': {
        artifactName: 'current',
        selector: {
          by: 'declaration',
          sourcePath: 'src/missing.ts',
          qualifiedName: 'Missing.run',
        },
      },
    };
    for (const expected of manifest.symbolCases) {
      const response = kernel.resolveSymbol(symbolRequests[expected.caseId]!);
      expect(symbolResolutionResponseSchema.safeParse(response).success).toBe(true);
      expect(response.state).toBe(expected.expectedState);
      expect(response.matches.map(({ qualifiedName }) => qualifiedName)).toEqual(
        expected.expectedNames,
      );
      expect(response.matches.map(({ canonicalId }) => canonicalId)).toEqual(
        [...response.matches.map(({ canonicalId }) => canonicalId)].sort(),
      );
    }

    const bounded = createQueryKernel({
      artifacts: [{ name: 'current', kind: 'analysis', document: analysis }],
      limits: { defaultResults: 1, maxResults: 1 },
    }).resolveEndpoint({
      artifactName: 'current',
      selector: { by: 'route', httpMethod: 'GET', path: '/health' },
      limit: 10,
    });
    expect(bounded).toMatchObject({
      state: 'ambiguous',
      metadata: {
        limits: { requested: 10, applied: 1, totalMatches: 2, returned: 1, omitted: 1 },
      },
    });
  });

  it('rejects unsafe or incomplete selectors and non-analysis artifacts', async () => {
    const manifest = JSON.parse(
      await readFile(resolve('test/fixtures/query-kernel/selectors.expected.json'), 'utf8'),
    ) as SelectorManifest;
    const analysis = createAmbiguousAnalysis();
    const comparison = (
      await import('../../../src/comparison/compare.js')
    ).compareAnalysisDocuments(analysis, analysis);
    const kernel = createQueryKernel({
      artifacts: [
        { name: 'current', kind: 'analysis', document: analysis },
        { name: 'comparison', kind: 'comparison', document: comparison },
      ],
    });

    for (const invalid of manifest.invalidSelectors) {
      try {
        kernel.resolveSymbol({
          artifactName: 'current',
          selector: {
            by: 'declaration',
            sourcePath: invalid.sourcePath,
            qualifiedName: 'HealthController.check',
          },
        });
        throw new Error(`Expected ${invalid.caseId} to fail.`);
      } catch (error) {
        expect(errorCode(error)).toBe(invalid.expectedError);
      }
    }
    expect(() =>
      kernel.resolveEndpoint({
        artifactName: 'missing',
        selector: { by: 'route', httpMethod: 'GET', path: '/health' },
      }),
    ).toThrow(expect.objectContaining({ code: 'ARTIFACT_NOT_FOUND' }));
    expect(() =>
      kernel.resolveEndpoint({
        artifactName: 'comparison',
        selector: { by: 'route', httpMethod: 'GET', path: '/health' },
      }),
    ).toThrow(expect.objectContaining({ code: 'ARTIFACT_KIND_MISMATCH' }));
  });

  it('keeps identical selectors available across frozen analysis v1-v8', () => {
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
      expect(validateAnalysisDocument(analysis).success).toBe(true);
      const response = createQueryKernel({
        artifacts: [{ name: 'analysis', kind: 'analysis', document: analysis }],
      }).resolveEndpoint({
        artifactName: 'analysis',
        selector: { by: 'route', httpMethod: 'GET', path: '/health' },
      });
      expect(response).toMatchObject({
        state: 'resolved',
        metadata: { artifact: { schemaVersion: analysis.schemaVersion } },
        matches: [{ path: '/health' }],
      });
    }
  });

  it('has no target I/O or execution dependency in the query implementation', async () => {
    const sources = await Promise.all(
      ['artifacts.ts', 'kernel.ts', 'model.ts', 'schemas.ts'].map((name) =>
        readFile(resolve('src/query', name), 'utf8'),
      ),
    );
    const implementation = sources.join('\n');
    expect(implementation).not.toMatch(/node:(?:fs|child_process|net|http|https)/u);
    expect(implementation).not.toMatch(/\b(?:fetch|eval|Function)\s*\(/u);
    expect(implementation).not.toContain('scanRepository');
  });
});
