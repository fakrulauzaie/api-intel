import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import {
  CI_ANNOTATION_CATEGORIES,
  CI_EVALUATION_FORMATS,
  CI_INPUT_ARTIFACT_KINDS,
  CI_PROCESS_EXIT_CODES,
  CI_PROCESS_OUTCOMES,
  ciAnnotationSchema,
  ciEvaluationDocumentSchema,
  evaluateCiArtifacts,
  projectCiAnnotations,
  renderCiEvaluationMarkdown,
  serializeCiAnnotationStream,
  serializeCiEvaluationDocument,
  validateCiEvaluationDocument,
} from '../../../src/ci-evaluation/index.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';

function artifacts(severity: 'warn' | 'error' = 'error') {
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
        'no-new-diagnostics': [severity, { minimumSeverity: 'warning', onUnknown: severity }],
      },
    }),
  });
  return { baseline, candidate, comparison, impact, policyResults };
}

describe('Phase P2.1 CI evaluation contract', () => {
  it('freezes the vendor-neutral process and format vocabulary', async () => {
    const manifest = JSON.parse(
      await readFile(
        join(process.cwd(), 'test/fixtures/ci-evaluation/p2-1-contract.expected.json'),
        'utf8',
      ),
    ) as {
      processOutcomes: Record<string, number>;
      annotationCategories: string[];
      inputArtifacts: string[];
      formats: string[];
    };
    expect(CI_PROCESS_OUTCOMES).toEqual(Object.keys(manifest.processOutcomes));
    expect(CI_PROCESS_EXIT_CODES).toEqual(manifest.processOutcomes);
    expect(CI_ANNOTATION_CATEGORIES).toEqual(manifest.annotationCategories);
    expect(CI_INPUT_ARTIFACT_KINDS).toEqual(manifest.inputArtifacts);
    expect(CI_EVALUATION_FORMATS).toEqual(manifest.formats);
  });

  it('composes validated artifacts into one strict proof-bounded document', () => {
    const inputs = artifacts();
    const document = evaluateCiArtifacts(inputs);
    expect(ciEvaluationDocumentSchema.safeParse(document).success).toBe(true);
    expect(validateCiEvaluationDocument(document)).toEqual({ success: true, data: document });
    expect(document).toMatchObject({
      schemaVersion: '1.0.0',
      outcome: 'policy_violation',
      summary: {
        endpointChanges: {
          added: inputs.comparison.summary.endpointsAdded,
          removed: inputs.comparison.summary.endpointsRemoved,
          modified: inputs.comparison.summary.endpointsModified,
        },
        potentialImpact: {
          impactedEndpointSlots: inputs.impact.summary.impactedEndpointSlots,
          unreachableSourceChanges: inputs.impact.summary.unreachableSourceChanges,
        },
        policy: inputs.policyResults.summary,
      },
    });
    expect(document.evaluationId).toMatch(/^ci_evaluation:[a-f0-9]{32}$/);
    expect(document.provenance.baseline.repositoryRevision).toBe('phase13-before');
    expect(document.provenance.candidate.repositoryRevision).toBe('phase13-after');
    expect(document.provenance.inputs.map(({ kind }) => kind)).toEqual([
      'comparison',
      'impact',
      'policy_results',
    ]);
    expect(document.endpointChanges.flatMap(({ evidence }) => evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          side: 'candidate',
          path: 'src/notes.controller.ts',
          startLine: expect.any(Number),
          contentHash: expect.stringMatching(/^sha256:/),
        }),
      ]),
    );
    expect(
      document.endpointChanges
        .flatMap(({ evidence }) => evidence)
        .some((evidence) => 'snippet' in evidence),
    ).toBe(false);
  });

  it('renders byte-stable JSON, Markdown, and neutral JSONL annotations', () => {
    const inputs = artifacts();
    const first = evaluateCiArtifacts(inputs);
    const permuted = evaluateCiArtifacts({
      ...inputs,
      comparison: {
        ...inputs.comparison,
        endpointChanges: [...inputs.comparison.endpointChanges].reverse(),
        diagnosticChanges: [...inputs.comparison.diagnosticChanges].reverse(),
      },
      policyResults: {
        ...inputs.policyResults,
        results: [...inputs.policyResults.results].reverse(),
      },
    });
    expect(serializeCiEvaluationDocument(permuted)).toBe(serializeCiEvaluationDocument(first));
    expect(renderCiEvaluationMarkdown(permuted)).toBe(renderCiEvaluationMarkdown(first));

    const annotations = projectCiAnnotations(first);
    expect(annotations.length).toBeGreaterThan(0);
    expect(
      annotations.every((annotation) => ciAnnotationSchema.safeParse(annotation).success),
    ).toBe(true);
    expect(serializeCiAnnotationStream(projectCiAnnotations(permuted))).toBe(
      serializeCiAnnotationStream(annotations),
    );
    for (const line of serializeCiAnnotationStream(annotations).trim().split('\n')) {
      expect(ciAnnotationSchema.safeParse(JSON.parse(line)).success).toBe(true);
    }
    expect(renderCiEvaluationMarkdown(first)).toContain(
      'Potential impact is a repository-local static reachability result',
    );
  });

  it('uses configured blocking semantics rather than treating every finding as failure', () => {
    const document = evaluateCiArtifacts(artifacts('warn'));
    expect(document.outcome).toBe('success');
    expect(document.summary.policy.warnings).toBeGreaterThan(0);
    expect(document.summary.policy.blocking).toBe(0);
  });

  it('rejects tampered summaries and identities', () => {
    const document = evaluateCiArtifacts(artifacts());
    const summary = validateCiEvaluationDocument({
      ...document,
      summary: {
        ...document.summary,
        endpointChanges: { ...document.summary.endpointChanges, total: 999 },
      },
    });
    expect(summary.success).toBe(false);
    if (!summary.success)
      expect(summary.issues.map(({ code }) => code)).toContain('SUMMARY_MISMATCH');

    const identity = validateCiEvaluationDocument({
      ...document,
      evaluationId: 'ci_evaluation:00000000000000000000000000000000',
    });
    expect(identity.success).toBe(false);
    if (!identity.success)
      expect(identity.issues.map(({ code }) => code)).toContain('IDENTITY_MISMATCH');
  });
});
