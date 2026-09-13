import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface EvaluationAnswer {
  readonly claims: readonly { readonly id: string; readonly evidenceIds: readonly string[] }[];
}

interface EvaluationCase {
  readonly id: string;
  readonly prompt: string;
  readonly groundTruth: {
    readonly supportedClaims: readonly string[];
    readonly requiredDependencies: readonly string[];
    readonly evidenceByClaim: Readonly<Record<string, readonly string[]>>;
  };
  readonly unsupportedUnaided: EvaluationAnswer;
  readonly artifactGrounded: EvaluationAnswer;
}

interface EvaluationMetrics {
  readonly citationAccuracy: number | null;
  readonly falseRelationshipClaims: number;
  readonly omittedDependencies: number;
}

interface EvaluationCorpus {
  readonly schemaVersion: string;
  readonly methodology: string;
  readonly answers: readonly ['artifactGrounded', 'unsupportedUnaided'];
  readonly metrics: readonly string[];
  readonly cases: readonly EvaluationCase[];
  readonly expectedAggregate: Readonly<
    Record<'artifactGrounded' | 'unsupportedUnaided', EvaluationMetrics>
  >;
}

function evaluate(
  cases: readonly EvaluationCase[],
  answerKind: 'artifactGrounded' | 'unsupportedUnaided',
): EvaluationMetrics {
  let citations = 0;
  let validCitations = 0;
  let falseRelationshipClaims = 0;
  let omittedDependencies = 0;
  for (const entry of cases) {
    const answer = entry[answerKind];
    const claimIds = new Set(answer.claims.map(({ id }) => id));
    falseRelationshipClaims += answer.claims.filter(
      ({ id }) => !entry.groundTruth.supportedClaims.includes(id),
    ).length;
    omittedDependencies += entry.groundTruth.requiredDependencies.filter(
      (dependency) => !claimIds.has(dependency),
    ).length;
    for (const claim of answer.claims) {
      const expectedEvidence = entry.groundTruth.evidenceByClaim[claim.id] ?? [];
      citations += claim.evidenceIds.length;
      validCitations += claim.evidenceIds.filter((id) => expectedEvidence.includes(id)).length;
    }
  }
  return {
    citationAccuracy: citations === 0 ? null : validCitations / citations,
    falseRelationshipClaims,
    omittedDependencies,
  };
}

describe('Phase P1.3 deterministic agent-evaluation corpus', () => {
  it('measures citations, omissions, and false relationship claims without model claims', async () => {
    const corpus = JSON.parse(
      await readFile(resolve('test/fixtures/mcp/p1-3-agent-evaluation.json'), 'utf8'),
    ) as EvaluationCorpus;
    expect(corpus.schemaVersion).toBe('1.0.0');
    expect(corpus.methodology).toContain('not a live model benchmark');
    expect(new Set(corpus.cases.map(({ id }) => id)).size).toBe(corpus.cases.length);
    expect(new Set(corpus.cases.map(({ prompt }) => prompt)).size).toBe(corpus.cases.length);
    for (const entry of corpus.cases) {
      for (const evidenceIds of Object.values(entry.groundTruth.evidenceByClaim)) {
        for (const evidenceId of evidenceIds) {
          expect(evidenceId).toMatch(/^evidence:[0-9a-f]{32}$/u);
        }
      }
    }
    expect(evaluate(corpus.cases, 'unsupportedUnaided')).toEqual(
      corpus.expectedAggregate.unsupportedUnaided,
    );
    expect(evaluate(corpus.cases, 'artifactGrounded')).toEqual(
      corpus.expectedAggregate.artifactGrounded,
    );
  });
});
