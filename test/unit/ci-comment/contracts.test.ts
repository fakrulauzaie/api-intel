import { describe, expect, it } from 'vitest';
import {
  CI_COMMENT_UPSERT_MARKER,
  ciCommentDocumentSchema,
  expectedCiCommentId,
  projectCiComment,
  renderCiCommentMarkdown,
  serializeCiCommentDocument,
  validateCiCommentAgainstEvaluation,
  validateCiCommentDocument,
  type CiCommentArtifactLink,
  type CiCommentDocument,
} from '../../../src/ci-comment/index.js';
import { renderCiCommentMarkdownUnchecked } from '../../../src/ci-comment/render.js';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import {
  evaluateCiArtifacts,
  expectedCiEvaluationId,
  type CiEvaluationDocument,
} from '../../../src/ci-evaluation/index.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';

function evaluation(): CiEvaluationDocument {
  const baseline = createComparisonAnalysisSnapshot('before');
  const candidate = createComparisonAnalysisSnapshot('after');
  return evaluateCiArtifacts({
    baseline,
    candidate,
    comparison: compareAnalysisDocuments(baseline, candidate),
    impact: analyzePotentialImpact(baseline, candidate),
    policyResults: evaluatePolicies({
      analysis: candidate,
      baseline,
      configuration: normalizePolicyConfiguration({
        version: 1,
        rules: {
          'no-new-diagnostics': ['error', { minimumSeverity: 'warning', onUnknown: 'error' }],
        },
      }),
    }),
  });
}

const artifactLinks: readonly CiCommentArtifactLink[] = [
  {
    kind: 'graph',
    label: 'Offline impact graph',
    url: 'https://ci.example.test/runs/42/artifacts/graph',
  },
  {
    kind: 'bundle',
    label: 'Complete evidence bundle',
    url: 'https://ci.example.test/runs/42/artifacts/evidence',
  },
];

function project(source = evaluation(), links = artifactLinks): CiCommentDocument {
  return projectCiComment({
    evaluation: source,
    run: { provider: 'github', id: 'run-42', url: 'https://ci.example.test/runs/42' },
    artifactLinks: links,
  });
}

function withEvaluationMessage(
  document: CiEvaluationDocument,
  message: string,
): CiEvaluationDocument {
  const policyResults = document.policyResults.map((result, index) =>
    index === 0 ? { ...result, message } : result,
  );
  const { evaluationId, ...identityInput } = { ...document, policyResults };
  void evaluationId;
  return { ...identityInput, evaluationId: expectedCiEvaluationId(identityInput) };
}

function reidentifyComment(document: CiCommentDocument): CiCommentDocument {
  const provisional: CiCommentDocument = {
    ...document,
    commentId: 'ci_comment:00000000000000000000000000000000',
    limits: { ...document.limits, renderedMarkdownBytes: 0 },
  };
  const withBytes: CiCommentDocument = {
    ...provisional,
    limits: {
      ...provisional.limits,
      renderedMarkdownBytes: Buffer.byteLength(renderCiCommentMarkdownUnchecked(provisional)),
    },
  };
  const { commentId, ...identityInput } = withBytes;
  void commentId;
  return { ...withBytes, commentId: expectedCiCommentId(identityInput) };
}

describe('Phase P5.1 sanitized comment document', () => {
  it('projects one strict, bounded, failure-first comment with a stable upsert marker', () => {
    const source = evaluation();
    const document = projectCiComment({
      evaluation: source,
      run: { provider: 'github', id: 'run-42', url: 'https://ci.example.test/runs/42' },
      artifactLinks,
      limits: { maxItems: 1, maxArtifactLinks: 1 },
    });
    const markdown = renderCiCommentMarkdown(document);

    expect(document).toMatchObject({
      schemaVersion: '1.0.0',
      upsert: {
        key: 'api-intel-ci-evaluation',
        marker: CI_COMMENT_UPSERT_MARKER,
      },
      evaluationId: source.evaluationId,
      outcome: source.outcome,
      limits: { includedItems: 1, includedArtifactLinks: 1 },
    });
    expect(document.commentId).toMatch(/^ci_comment:[a-f0-9]{32}$/);
    expect(document.findings[0]?.level).toBe('failure');
    expect(document.limits.omittedItems).toBeGreaterThan(0);
    expect(document.limits.renderedMarkdownBytes).toBe(Buffer.byteLength(markdown));
    expect(Buffer.byteLength(markdown)).toBeLessThanOrEqual(document.limits.maxMarkdownBytes);
    expect(markdown.split(CI_COMMENT_UPSERT_MARKER)).toHaveLength(2);
    expect(markdown).toContain('Full evidence remains in the downloadable CI artifacts');
    expect(ciCommentDocumentSchema.safeParse(document).success).toBe(true);
    expect(validateCiCommentDocument(document)).toEqual({ success: true, data: document });
    expect(validateCiCommentAgainstEvaluation(document, source)).toEqual({
      success: true,
      data: document,
    });
  });

  it('is byte-stable across artifact order and duplicate inputs', () => {
    const source = evaluation();
    const first = project(source, artifactLinks);
    const second = project(source, [artifactLinks[1]!, artifactLinks[0]!, artifactLinks[1]!]);
    expect(serializeCiCommentDocument(second)).toBe(serializeCiCommentDocument(first));
    expect(renderCiCommentMarkdown(second)).toBe(renderCiCommentMarkdown(first));
  });

  it('neutralizes repository-derived Markdown and keeps oversized text inside the byte ceiling', () => {
    const source = withEvaluationMessage(
      evaluation(),
      `line\n# forged [click](javascript:alert(1)) <script>x</script> ${'x'.repeat(100_000)}`,
    );
    const document = projectCiComment({
      evaluation: source,
      run: {
        provider: 'github',
        id: 'run\n<!-- attacker-marker -->\u202e',
        url: 'https://ci.example.test/runs/42',
      },
      artifactLinks: [
        {
          kind: 'bundle',
          label: 'Evidence [click](javascript:alert(1)) <script>',
          url: 'https://ci.example.test/runs/42/artifacts/evidence',
        },
      ],
      limits: { maxMarkdownBytes: 8_192 },
    });
    const markdown = renderCiCommentMarkdown(document);

    expect(Buffer.byteLength(markdown)).toBeLessThanOrEqual(8_192);
    expect(markdown.split(CI_COMMENT_UPSERT_MARKER)).toHaveLength(2);
    expect(markdown).not.toContain('<script>');
    expect(markdown).not.toContain('](javascript:');
    expect(markdown).not.toContain('\u202e');
    expect(markdown).toContain('&lt;script&gt;');
    expect(markdown).toContain('\\[click\\]\\(javascript:alert\\(1\\)\\)');
  });

  it('accepts only canonical credential-free HTTPS destinations and bounded inputs', () => {
    const source = evaluation();
    for (const url of [
      'javascript:alert(1)',
      'http://ci.example.test/run/42',
      'https://user:secret@ci.example.test/run/42',
      ' https://ci.example.test/run/42',
    ]) {
      expect(() =>
        projectCiComment({
          evaluation: source,
          run: { provider: 'github', id: '42', url },
          artifactLinks,
        }),
      ).toThrow();
    }
    expect(() =>
      projectCiComment({
        evaluation: source,
        run: { provider: 'github', id: '42', url: 'https://ci.example.test/run/42' },
        artifactLinks: [],
      }),
    ).toThrow('At least one downloadable evidence artifact link');
    expect(() =>
      projectCiComment({
        evaluation: source,
        run: { provider: 'github', id: '42', url: 'https://ci.example.test/run/42' },
        artifactLinks,
        limits: { maxItems: 51 },
      }),
    ).toThrow('maxItems');
  });

  it('rejects tampered limits and markers and can bind a self-consistent document to its source', () => {
    const source = evaluation();
    const document = project(source);
    expect(
      validateCiCommentDocument({
        ...document,
        limits: { ...document.limits, includedItems: 999 },
      }).success,
    ).toBe(false);
    expect(
      validateCiCommentDocument({
        ...document,
        upsert: { ...document.upsert, marker: '<!-- forged -->' },
      }).success,
    ).toBe(false);

    const sourceMismatch = reidentifyComment({
      ...document,
      summary: {
        ...document.summary,
        endpointChanges: { ...document.summary.endpointChanges, added: 999 },
      },
    });
    expect(validateCiCommentDocument(sourceMismatch).success).toBe(true);
    const result = validateCiCommentAgainstEvaluation(sourceMismatch, source);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('EVALUATION_MISMATCH');
    }
  });
});
