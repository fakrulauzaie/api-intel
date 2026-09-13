import { describe, expect, it } from 'vitest';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { validateDiffDocument } from '../../../src/comparison/validate.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { validateImpactDocument } from '../../../src/impact/validate.js';
import { validateAnalysisDocument } from '../../../src/evidence/validate.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { normalizePolicyConfiguration } from '../../../src/policy/rule-config.js';
import { validatePolicyResultsDocument } from '../../../src/policy/validate.js';
import { createQueryKernel, queryArtifactDescriptorSchema } from '../../../src/query/index.js';
import { stitchSystemAnalyses } from '../../../src/system-analysis/stitch.js';
import { validateSystemAnalysisDocument } from '../../../src/system-analysis/validate.js';
import { buildSystemReportDocument } from '../../../src/system-report/project.js';
import { validateSystemReportDocument } from '../../../src/system-report/validate.js';
import { createMinimalAnalysisDocumentV8 } from '../../helpers/minimal-analysis.js';

describe('query artifact registry', () => {
  it('content-addresses every validated document family without conflating native IDs', () => {
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
    expect(validateAnalysisDocument(analysis).success).toBe(true);

    const comparison = compareAnalysisDocuments(analysis, analysis);
    const impact = analyzePotentialImpact(analysis, analysis);
    const policy = evaluatePolicies({
      analysis,
      configuration: normalizePolicyConfiguration({
        version: 1,
        rules: { 'require-complete-write-trace': 'warn' },
      }),
    });
    const service = {
      namespace: 'fixture-api',
      displayName: 'Fixture API',
      artifactLabel: 'analysis.json',
      analysis,
    } as const;
    const system = stitchSystemAnalyses({
      systemName: 'query-fixture',
      services: [service],
    });
    const report = buildSystemReportDocument({ system, services: [service] });

    expect(validateDiffDocument(comparison).success).toBe(true);
    expect(validateImpactDocument(impact).success).toBe(true);
    expect(validatePolicyResultsDocument(policy).success).toBe(true);
    expect(validateSystemAnalysisDocument(system).success).toBe(true);
    expect(validateSystemReportDocument(report).success).toBe(true);

    const artifacts = [
      { name: 'system-report', kind: 'system_report', document: report },
      { name: 'impact', kind: 'impact', document: impact },
      { name: 'analysis', kind: 'analysis', document: analysis },
      { name: 'policy', kind: 'policy', document: policy },
      { name: 'comparison', kind: 'comparison', document: comparison },
      { name: 'system', kind: 'system_analysis', document: system },
    ] as const;
    const first = createQueryKernel({ artifacts });
    const second = createQueryKernel({ artifacts: [...artifacts].reverse() });

    expect(first.artifacts).toEqual(second.artifacts);
    expect(Object.isFrozen(first.artifacts)).toBe(true);
    expect(Object.isFrozen(first.artifacts[0])).toBe(true);
    expect(Object.isFrozen(first.limits)).toBe(true);
    expect(first.artifacts.map(({ name }) => name)).toEqual([
      'analysis',
      'comparison',
      'impact',
      'policy',
      'system',
      'system-report',
    ]);
    for (const descriptor of first.artifacts) {
      expect(queryArtifactDescriptorSchema.safeParse(descriptor).success).toBe(true);
      expect(descriptor.documentId).toMatch(/^query_document:[0-9a-f]{64}$/u);
    }
    expect(first.artifacts.find(({ name }) => name === 'analysis')).toMatchObject({
      canonicalDocumentId: analysis.analysisRun.id,
      resultState: 'completed',
      schemaVersion: '8.0.0',
    });
    expect(first.artifacts.find(({ name }) => name === 'comparison')).toMatchObject({
      canonicalDocumentId: null,
      resultState: 'completed',
      schemaVersion: '5.0.0',
    });
    expect(first.artifacts.find(({ name }) => name === 'system')).toMatchObject({
      canonicalDocumentId: system.systemId,
      resultState: 'completed',
    });
    expect(first.artifacts.find(({ name }) => name === 'system-report')).toMatchObject({
      canonicalDocumentId: report.reportId,
      resultState: 'not_declared',
    });
  });

  it('rejects invalid names, duplicates, and invalid configurable hard limits', () => {
    const analysis = createMinimalAnalysisDocumentV8();
    expect(() =>
      createQueryKernel({
        artifacts: [{ name: '../analysis', kind: 'analysis', document: analysis }],
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARTIFACT_NAME' }));
    expect(() =>
      createQueryKernel({
        artifacts: [
          { name: 'current', kind: 'analysis', document: analysis },
          { name: 'current', kind: 'analysis', document: analysis },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_ARTIFACT_NAME' }));
    expect(() =>
      createQueryKernel({
        artifacts: [{ name: 'current', kind: 'analysis', document: analysis }],
        limits: { defaultResults: 11, maxResults: 10 },
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_LIMITS' }));
  });
});
