import { describe, expect, it } from 'vitest';
import {
  changeImpactResponseSchema,
  compareAnalysesResponseSchema,
  createQueryKernel,
  endpointTraceQueryResponseSchema,
  listEndpointsResponseSchema,
  symbolDependentsResponseSchema,
} from '../../../src/query/index.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';
import { createImpactAnalysisSnapshot } from '../../helpers/impact-analysis.js';

describe('bounded evidence queries', () => {
  it('lists endpoints with deterministic cursor pagination and exact filters', () => {
    const analysis = createImpactAnalysisSnapshot('before', { includeCycle: false });
    const kernel = createQueryKernel({
      artifacts: [{ name: 'current', kind: 'analysis', document: analysis }],
      limits: { defaultResults: 1, maxResults: 2 },
    });

    const first = kernel.listEndpoints({
      artifactName: 'current',
      filters: { httpMethods: ['GET'], pathPrefix: '/' },
    });
    expect(listEndpointsResponseSchema.safeParse(first).success).toBe(true);
    expect(first.endpoints).toHaveLength(1);
    expect(first.metadata).toMatchObject({
      limits: { applied: 1, totalMatches: 2, returned: 1, omitted: 1 },
      page: { totalItems: 2, skipped: 0, remaining: 1 },
    });
    expect(first.metadata.page.nextCursor).toBe(first.endpoints[0]!.canonicalId);

    const second = kernel.listEndpoints({
      artifactName: 'current',
      filters: { httpMethods: ['GET'], pathPrefix: '/' },
      cursor: first.metadata.page.nextCursor!,
    });
    expect(second.endpoints).toHaveLength(1);
    expect(second.endpoints[0]!.canonicalId).not.toBe(first.endpoints[0]!.canonicalId);
    expect(second.metadata.page).toMatchObject({ skipped: 1, remaining: 0, nextCursor: null });
    expect(
      kernel.listEndpoints({ artifactName: 'current', filters: { hasDiagnostics: true } }),
    ).toMatchObject({ endpoints: expect.any(Array) });
  });

  it('builds a canonical endpoint trace after exact ID selection and bounds every collection', () => {
    const analysis = createImpactAnalysisSnapshot('before', { includeCycle: false });
    const endpoint = analysis.endpoints[0]!;
    const response = createQueryKernel({
      artifacts: [{ name: 'current', kind: 'analysis', document: analysis }],
      limits: { defaultResults: 1, maxResults: 1 },
    }).getEndpointTrace({
      artifactName: 'current',
      selector: { by: 'canonical_id', canonicalId: endpoint.id },
      limit: 50,
    });

    expect(endpointTraceQueryResponseSchema.safeParse(response).success).toBe(true);
    expect(response).toMatchObject({
      state: 'resolved',
      trace: { endpoint: { canonicalId: endpoint.id } },
    });
    expect(response.trace!.steps.returned).toBeLessThanOrEqual(1);
    expect(response.trace!.terminals.returned).toBeLessThanOrEqual(1);
    expect(response.trace!.diagnosticIds.returned).toBeLessThanOrEqual(1);
    expect(response.metadata.evidenceIds.length).toBeGreaterThan(0);
  });

  it('derives comparison and impact only from the explicitly named snapshots', () => {
    const comparisonBefore = createComparisonAnalysisSnapshot('before');
    const comparisonAfter = createComparisonAnalysisSnapshot('after');
    const impactBefore = createImpactAnalysisSnapshot('before', { includeCycle: false });
    const impactAfter = createImpactAnalysisSnapshot('after', {
      callers: ['first'],
      includeCycle: false,
    });
    const kernel = createQueryKernel({
      artifacts: [
        { name: 'comparison-before', kind: 'analysis', document: comparisonBefore },
        { name: 'comparison-after', kind: 'analysis', document: comparisonAfter },
        { name: 'impact-before', kind: 'analysis', document: impactBefore },
        { name: 'impact-after', kind: 'analysis', document: impactAfter },
      ],
      limits: { defaultResults: 2, maxResults: 2 },
    });

    const comparison = kernel.compareAnalyses({
      beforeArtifactName: 'comparison-before',
      afterArtifactName: 'comparison-after',
      families: ['endpoint', 'diagnostic'],
    });
    expect(compareAnalysesResponseSchema.safeParse(comparison).success).toBe(true);
    expect(comparison.metadata.resultArtifact).toMatchObject({ kind: 'comparison' });
    expect(
      comparison.changes.every(({ family }) => ['endpoint', 'diagnostic'].includes(family)),
    ).toBe(true);
    expect(comparison.changes.flatMap(({ canonicalIds }) => canonicalIds).length).toBeGreaterThan(
      0,
    );

    const impact = kernel.getChangeImpact({
      beforeArtifactName: 'impact-before',
      afterArtifactName: 'impact-after',
      families: ['impacted_endpoint'],
    });
    expect(changeImpactResponseSchema.safeParse(impact).success).toBe(true);
    expect(impact.metadata.resultArtifact).toMatchObject({ kind: 'impact' });
    expect(impact.impacts.every(({ family }) => family === 'impacted_endpoint')).toBe(true);
    expect(impact.summary.impactedEndpointSlots).toBeGreaterThan(0);
  });

  it('keeps current-snapshot reverse reachability distinct from before/after impact', () => {
    const analysis = createImpactAnalysisSnapshot('before', { includeCycle: true });
    const shared = analysis.methods.find(
      ({ qualifiedName }) => qualifiedName === 'SharedService.work',
    )!;
    const kernel = createQueryKernel({
      artifacts: [{ name: 'current', kind: 'analysis', document: analysis }],
      limits: { defaultResults: 25, maxResults: 25, maxTraversalDepth: 4, maxTraversalStates: 100 },
    });

    const response = kernel.getSymbolDependents({
      artifactName: 'current',
      selector: { by: 'canonical_id', canonicalId: shared.id },
      maxDepth: 4,
    });
    expect(symbolDependentsResponseSchema.safeParse(response).success).toBe(true);
    expect(response.state).toBe('resolved');
    expect(response.seedMethods).toMatchObject({ total: 1, omitted: 0, items: [shared.id] });
    expect(response.dependents.some(({ subjectKind }) => subjectKind === 'method')).toBe(true);
    expect(response.dependents.some(({ subjectKind }) => subjectKind === 'endpoint')).toBe(true);
    expect(
      response.dependents.every(({ steps }) =>
        steps.every(({ predicate }) =>
          ['METHOD_CALLS_METHOD', 'ENDPOINT_IMPLEMENTED_BY', 'HANDLER_IMPLEMENTED_BY'].includes(
            predicate,
          ),
        ),
      ),
    ).toBe(true);
    expect(response.traversal.truncated).toBe(false);
  });
});
