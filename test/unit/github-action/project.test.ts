import { describe, expect, it } from 'vitest';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { evaluateCiArtifacts } from '../../../src/ci-evaluation/index.js';
import {
  githubActionArtifactManifestSchema,
  githubCiProjectionSchema,
  projectGitHubCiEvaluation,
  renderGitHubWorkflowCommand,
  sanitizeGitHubRepositoryPath,
  sanitizeGitHubText,
} from '../../../src/github-action/index-library.js';
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

describe('Phase P3.1 GitHub CI projection', () => {
  it('projects a validated evaluation into a bounded, failure-first summary', () => {
    const projection = projectGitHubCiEvaluation({ evaluation: evaluation(), maxAnnotations: 1 });
    expect(projection.annotationCount).toBe(1);
    expect(projection.omittedAnnotationCount).toBeGreaterThan(0);
    expect(projection.annotations[0]?.level).toBe('error');
    expect(Buffer.byteLength(projection.summaryMarkdown)).toBeLessThanOrEqual(65_536);
    expect(projection.summaryMarkdown).toContain('Potential impact is evidence-backed static');
    expect(projection.summaryMarkdown).toContain('downloadable artifacts');
    expect(githubCiProjectionSchema.safeParse(projection).success).toBe(true);
  });

  it('normalizes untrusted display text and enforces byte limits at code-point boundaries', () => {
    const sanitized = sanitizeGitHubText('first\n::error:: forged\u0000  second', 24);
    expect(sanitized).toBe('first ::error:: forged s');
    expect(sanitized).not.toContain('\n');
    expect(Buffer.byteLength(sanitized)).toBeLessThanOrEqual(24);
    expect(sanitizeGitHubText('😀😀', 5)).toBe('😀');
  });

  it('publishes only safe candidate repository-relative annotation paths', () => {
    expect(sanitizeGitHubRepositoryPath('src\\users.controller.ts')).toBe(
      'src/users.controller.ts',
    );
    expect(sanitizeGitHubRepositoryPath('../baseline/secret.ts')).toBeNull();
    expect(sanitizeGitHubRepositoryPath('/tmp/absolute.ts')).toBeNull();
    expect(sanitizeGitHubRepositoryPath('C:\\work\\absolute.ts')).toBeNull();
  });

  it('escapes workflow-command data and properties without shell interpolation', () => {
    const command = renderGitHubWorkflowCommand({
      level: 'warning',
      title: 'rule:one,two',
      message: 'line%one\n::error::forged',
      path: 'src/a,b.ts',
      startLine: 3,
      endLine: 3,
      startColumn: 4,
      endColumn: 8,
      sourceAnnotationId: 'ci_annotation:test',
    });
    expect(command).toBe(
      '::warning title=rule%3Aone%2Ctwo,file=src/a%2Cb.ts,line=3,endLine=3,col=4,endColumn=8::line%25one%0A::error::forged',
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
      evaluationId: 'ci_evaluation:00000000000000000000000000000000',
      outcome: 'success',
      annotations: { published: 0, omitted: 0 },
      files: [file],
    };
    expect(githubActionArtifactManifestSchema.safeParse(manifest).success).toBe(true);
    expect(
      githubActionArtifactManifestSchema.safeParse({
        ...manifest,
        files: [file, { ...file, path: 'manifest.json' }],
      }).success,
    ).toBe(false);
  });
});
