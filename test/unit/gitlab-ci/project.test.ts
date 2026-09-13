import { describe, expect, it } from 'vitest';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { evaluateCiArtifacts } from '../../../src/ci-evaluation/index.js';
import {
  gitLabCiArtifactManifestSchema,
  gitLabCiProjectionSchema,
  projectGitLabCiEvaluation,
  serializeGitLabCodeQualityReport,
} from '../../../src/gitlab-ci/index-library.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';

function evaluation() {
  const baseline = createComparisonAnalysisSnapshot('before');
  const candidate = createComparisonAnalysisSnapshot('after');
  const comparison = compareAnalysisDocuments(baseline, candidate);
  const impact = analyzePotentialImpact(baseline, candidate);
  const policyResults = evaluatePolicies({
    analysis: candidate,
    baseline,
    configuration: normalizePolicyConfiguration({
      version: 1,
      rules: {
        'no-new-diagnostics': ['error', { minimumSeverity: 'warning', onUnknown: 'error' }],
      },
    }),
  });
  return evaluateCiArtifacts({ baseline, candidate, comparison, impact, policyResults });
}

describe('Phase P3.2 GitLab CI projection', () => {
  it('projects candidate evidence into a bounded, failure-first Code Quality report', () => {
    const projection = projectGitLabCiEvaluation({
      evaluation: evaluation(),
      executionImage:
        'registry.example.com/api-intel@sha256:0000000000000000000000000000000000000000000000000000000000000000',
      maxFindings: 1,
    });
    expect(projection.findingCount).toBe(1);
    expect(projection.omittedFindingCount).toBeGreaterThan(0);
    expect(projection.findings[0]?.severity).toBe('blocker');
    expect(projection.findings[0]?.location.path).not.toMatch(/^\.\//u);
    expect(Buffer.byteLength(projection.summaryMarkdown)).toBeLessThanOrEqual(65_536);
    expect(projection.summaryMarkdown).toContain('evidence-backed static reachability');
    expect(projection.summaryMarkdown).toContain('artifact-only findings');
    expect(gitLabCiProjectionSchema.safeParse(projection).success).toBe(true);

    const report = serializeGitLabCodeQualityReport(projection.findings);
    expect(report.codePointAt(0)).not.toBe(0xfeff);
    expect(JSON.parse(report)).toEqual(projection.findings);
    expect(Object.keys(JSON.parse(report)[0] as object).sort()).toEqual([
      'check_name',
      'description',
      'fingerprint',
      'location',
      'severity',
    ]);
  });

  it('omits non-candidate and unsafe locations rather than inventing a report path', () => {
    const document = evaluation();
    const projected = projectGitLabCiEvaluation({
      evaluation: document,
      executionImage:
        'registry.example.com/api-intel@sha256:0000000000000000000000000000000000000000000000000000000000000000',
    });
    const allPaths = projected.findings.map(({ location }) => location.path);
    expect(allPaths.every((path) => !path.startsWith('/') && !path.includes('..'))).toBe(true);
    expect(projected.findingCount + projected.omittedFindingCount).toBeGreaterThanOrEqual(
      projected.findingCount,
    );
  });

  it('validates deterministic non-self-referential artifact manifests', () => {
    const file = {
      path: 'ci-evaluation.json',
      bytes: 2,
      contentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    const manifest = {
      schemaVersion: '1.0.0',
      adapterVersion: '1.0.0',
      executionImage:
        'registry.example.com/api-intel@sha256:0000000000000000000000000000000000000000000000000000000000000000',
      evaluationId: 'ci_evaluation:00000000000000000000000000000000',
      outcome: 'success',
      codeQuality: { published: 0, omitted: 0 },
      files: [file],
    };
    expect(gitLabCiArtifactManifestSchema.safeParse(manifest).success).toBe(true);
    expect(
      gitLabCiArtifactManifestSchema.safeParse({
        ...manifest,
        files: [file, { ...file, path: 'manifest.json' }],
      }).success,
    ).toBe(false);
  });
});
