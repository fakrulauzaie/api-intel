import { describe, expect, it } from 'vitest';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import {
  CI_PROCESS_EXIT_CODES,
  CiEvaluationProcessError,
  ciProcessOutcome,
  evaluateCiArtifacts,
} from '../../../src/ci-evaluation/index.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';

function inputs() {
  const baseline = createComparisonAnalysisSnapshot('before');
  const candidate = createComparisonAnalysisSnapshot('after');
  return {
    baseline,
    candidate,
    comparison: compareAnalysisDocuments(baseline, candidate),
    impact: analyzePotentialImpact(baseline, candidate),
    policyResults: evaluatePolicies({
      analysis: candidate,
      baseline,
      configuration: normalizePolicyConfiguration({
        version: 1,
        rules: { 'no-new-diagnostics': 'error' },
      }),
    }),
  };
}

function expectOutcome(run: () => unknown, outcome: CiEvaluationProcessError['outcome']): void {
  try {
    run();
    throw new Error('Expected evaluation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(CiEvaluationProcessError);
    expect(ciProcessOutcome(error)).toBe(outcome);
    expect((error as CiEvaluationProcessError).exitCode).toBe(CI_PROCESS_EXIT_CODES[outcome]);
  }
}

describe('Phase P2.1 process outcomes', () => {
  it('separates invalid input from incompatible baseline provenance', () => {
    const valid = inputs();
    expectOutcome(
      () =>
        evaluateCiArtifacts({
          ...valid,
          comparison: {
            ...valid.comparison,
            summary: { ...valid.comparison.summary, endpointsAdded: 999 },
          },
        }),
      'invalid_input',
    );
    expectOutcome(
      () =>
        evaluateCiArtifacts({
          ...valid,
          comparison: {
            ...valid.comparison,
            before: {
              ...valid.comparison.before,
              analysisId: 'analysis:00000000000000000000000000000000',
            },
          },
        }),
      'incompatible_baseline',
    );
  });

  it('separates analysis failure and cancellation', () => {
    const valid = inputs();
    expectOutcome(
      () =>
        evaluateCiArtifacts({
          ...valid,
          candidate: { ...valid.candidate, resultState: 'failed' },
        }),
      'analysis_failure',
    );
    const controller = new AbortController();
    controller.abort();
    expectOutcome(() => evaluateCiArtifacts({ ...valid, signal: controller.signal }), 'canceled');
    expect(ciProcessOutcome(new Error('unclassified'))).toBe('invalid_input');
    expect(ciProcessOutcome(new DOMException('Canceled', 'AbortError'))).toBe('canceled');
  });
});
