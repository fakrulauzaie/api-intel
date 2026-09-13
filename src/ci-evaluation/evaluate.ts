import type { DiffDocument, DiffInputSnapshot, EndpointSnapshot } from '../comparison/model.js';
import { assertValidDiffDocument } from '../comparison/validate.js';
import type { ImpactDocument } from '../impact/model.js';
import { assertValidImpactDocument } from '../impact/validate.js';
import type { AnalysisDocument } from '../model/analysis.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { hashContent } from '../model/hashing.js';
import { canonicalStringify, serializeCanonicalAnalysis } from '../model/ordering.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import { serializePolicyResults } from '../policy/ordering.js';
import { assertValidPolicyResultsDocument } from '../policy/validate.js';
import { serializeDiffDocument } from '../comparison/ordering.js';
import { serializeImpactDocument } from '../impact/ordering.js';
import { assertValidAnalysisDocument } from '../evidence/validate.js';
import {
  CI_EVALUATION_SCHEMA_VERSION,
  CI_PROCESS_EXIT_CODES,
  type CiAnalysisProvenance,
  type CiDiagnosticChangeRecord,
  type CiEndpointChangeRecord,
  type CiEvaluationDocument,
  type CiEvidenceLocation,
  type CiEvidenceSide,
  type CiGapRecord,
  type CiImpactedEndpointRecord,
  type CiPolicyResultRecord,
  type CiProcessOutcome,
} from './model.js';
import { canonicalizeCiEvaluationDocument, expectedCiEvaluationId } from './ordering.js';
import { assertValidCiEvaluationDocument } from './validate.js';

export interface CiEvaluationInput {
  readonly baseline: AnalysisDocument;
  readonly candidate: AnalysisDocument;
  readonly comparison: DiffDocument;
  readonly impact: ImpactDocument;
  readonly policyResults: PolicyResultsDocument;
  readonly signal?: AbortSignal | undefined;
}

export class CiEvaluationProcessError extends Error {
  readonly outcome: Exclude<CiProcessOutcome, 'success' | 'policy_violation'>;
  readonly exitCode: number;

  constructor(
    outcome: Exclude<CiProcessOutcome, 'success' | 'policy_violation'>,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CiEvaluationProcessError';
    this.outcome = outcome;
    this.exitCode = CI_PROCESS_EXIT_CODES[outcome];
  }
}

function fail(outcome: CiEvaluationProcessError['outcome'], message: string): never {
  throw new CiEvaluationProcessError(outcome, message);
}

function throwIfCanceled(signal?: AbortSignal): void {
  if (signal?.aborted === true) fail('canceled', 'CI evaluation canceled.');
}

function validateAnalysis(input: unknown, label: string): AnalysisDocument {
  let analysis: AnalysisDocument;
  try {
    analysis = assertValidAnalysisDocument(input);
  } catch (error) {
    throw new CiEvaluationProcessError('invalid_input', `Invalid ${label} analysis artifact.`, {
      cause: error,
    });
  }
  if (analysis.resultState === 'failed') {
    fail('analysis_failure', `${label} analysis did not complete successfully.`);
  }
  if (analysis.resultState === 'canceled') {
    fail('canceled', `${label} analysis was canceled.`);
  }
  return analysis;
}

function fingerprint(value: string): string {
  return hashContent(value);
}

function analysisProvenance(analysis: AnalysisDocument): CiAnalysisProvenance {
  return {
    analysisId: analysis.analysisRun.id,
    schemaVersion: analysis.schemaVersion,
    resultState: analysis.resultState as 'completed' | 'completed_with_gaps',
    repositoryRevision: analysis.analysisRun.repositoryRevision,
    tool: analysis.analysisRun.tool,
    configurationFingerprint: fingerprint(canonicalStringify(analysis.analysisRun.configuration)),
    artifactFingerprint: fingerprint(serializeCanonicalAnalysis(analysis)),
    sourceFileCount: analysis.sourceFiles.length,
  };
}

function assertSnapshot(
  snapshot: DiffInputSnapshot,
  analysis: AnalysisDocument,
  label: string,
): void {
  const configuration = analysis.analysisRun.configuration;
  if (
    snapshot.analysisId !== analysis.analysisRun.id ||
    snapshot.analysisSchemaVersion !== analysis.schemaVersion ||
    snapshot.resultState !== analysis.resultState ||
    snapshot.configuration.maxCallDepth !== configuration.maxCallDepth ||
    snapshot.configuration.maxSourceFileBytes !== configuration.maxSourceFileBytes ||
    snapshot.configuration.evidenceSnippetLimit !== configuration.evidenceSnippetLimit
  ) {
    fail('incompatible_baseline', `${label} artifact provenance does not match its analysis.`);
  }
}

function assertCompatibleInputs(input: {
  baseline: AnalysisDocument;
  candidate: AnalysisDocument;
  comparison: DiffDocument;
  impact: ImpactDocument;
  policyResults: PolicyResultsDocument;
}): void {
  const { baseline, candidate, comparison, impact, policyResults } = input;
  if (
    baseline.schemaVersion !== candidate.schemaVersion ||
    canonicalStringify(baseline.analysisRun.configuration) !==
      canonicalStringify(candidate.analysisRun.configuration) ||
    canonicalStringify(baseline.analysisRun.tool) !== canonicalStringify(candidate.analysisRun.tool)
  ) {
    fail(
      'incompatible_baseline',
      'Baseline and candidate must use the same analysis schema, configuration, and toolchain.',
    );
  }
  assertSnapshot(comparison.before, baseline, 'Comparison baseline');
  assertSnapshot(comparison.after, candidate, 'Comparison candidate');
  assertSnapshot(impact.before, baseline, 'Impact baseline');
  assertSnapshot(impact.after, candidate, 'Impact candidate');
  if (
    policyResults.analysis.analysisId !== candidate.analysisRun.id ||
    policyResults.analysis.analysisSchemaVersion !== candidate.schemaVersion ||
    policyResults.analysis.resultState !== candidate.resultState
  ) {
    fail('incompatible_baseline', 'Policy candidate provenance does not match its analysis.');
  }
  if (
    policyResults.baseline !== null &&
    (policyResults.baseline.analysisId !== baseline.analysisRun.id ||
      policyResults.baseline.analysisSchemaVersion !== baseline.schemaVersion ||
      policyResults.baseline.resultState !== baseline.resultState)
  ) {
    fail('incompatible_baseline', 'Policy baseline provenance does not match its analysis.');
  }
}

interface AnalysisEvidenceIndex {
  readonly side: CiEvidenceSide;
  readonly evidence: ReadonlyMap<string, EvidenceRecord>;
  readonly sourcePaths: ReadonlyMap<string, string>;
  readonly resourceEvidence: ReadonlyMap<string, readonly string[]>;
}

function evidenceIndex(side: CiEvidenceSide, analysis: AnalysisDocument): AnalysisEvidenceIndex {
  return {
    side,
    evidence: new Map(analysis.evidence.map((record) => [record.id, record])),
    sourcePaths: new Map(analysis.sourceFiles.map((record) => [record.id, record.path])),
    resourceEvidence: new Map(
      ('resourceAccesses' in analysis ? analysis.resourceAccesses : []).map((record) => [
        record.id,
        record.evidenceIds,
      ]),
    ),
  };
}

function location(index: AnalysisEvidenceIndex, evidenceId: string): CiEvidenceLocation {
  const evidence = index.evidence.get(evidenceId);
  if (evidence === undefined) {
    fail(
      'incompatible_baseline',
      `Projected evidence ${evidenceId} is absent from the ${index.side} analysis.`,
    );
  }
  const path = index.sourcePaths.get(evidence.fileId);
  if (path === undefined) {
    fail(
      'incompatible_baseline',
      `Evidence source ${evidence.fileId} is absent from the analysis.`,
    );
  }
  return {
    side: index.side,
    evidenceId: evidence.id,
    fileId: evidence.fileId,
    path,
    startLine: evidence.startLine,
    startColumn: evidence.startColumn,
    endLine: evidence.endLine,
    endColumn: evidence.endColumn,
    role: evidence.role,
    contentHash: evidence.contentHash,
  };
}

function locations(
  index: AnalysisEvidenceIndex,
  evidenceIds: readonly string[],
): CiEvidenceLocation[] {
  return evidenceIds.map((evidenceId) => location(index, evidenceId));
}

function endpointEvidence(
  snapshot: EndpointSnapshot | null,
  index: AnalysisEvidenceIndex,
): string[] {
  if (snapshot === null) return [];
  return [
    ...snapshot.handlers.flatMap(({ evidenceIds }) => evidenceIds),
    ...snapshot.directGuards.guards.flatMap(({ evidenceIds }) => evidenceIds),
    ...snapshot.effectiveGuards.guards.flatMap(({ evidenceIds }) => evidenceIds),
    ...snapshot.terminals.values.flatMap(({ contributors }) =>
      contributors.flatMap(({ evidenceIds }) => evidenceIds),
    ),
    ...(snapshot.authorization?.requirements.flatMap(({ evidenceIds }) => evidenceIds) ?? []),
    ...(snapshot.resourceAccesses?.values.flatMap(
      ({ resourceAccessId }) => index.resourceEvidence.get(resourceAccessId) ?? [],
    ) ?? []),
  ];
}

function resolvePolicyEvidence(
  evidenceIds: readonly string[],
  candidate: AnalysisEvidenceIndex,
  baseline: AnalysisEvidenceIndex,
): CiEvidenceLocation[] {
  return evidenceIds.map((evidenceId) => {
    if (candidate.evidence.has(evidenceId)) return location(candidate, evidenceId);
    if (baseline.evidence.has(evidenceId)) return location(baseline, evidenceId);
    return fail(
      'incompatible_baseline',
      `Policy evidence ${evidenceId} is absent from both analyses.`,
    );
  });
}

function createEndpointChanges(
  comparison: DiffDocument,
  baseline: AnalysisEvidenceIndex,
  candidate: AnalysisEvidenceIndex,
): CiEndpointChangeRecord[] {
  return comparison.endpointChanges.map((change) => {
    const snapshot = change.after ?? change.before!;
    return {
      change: change.change,
      httpMethod: snapshot.httpMethod,
      path: snapshot.path,
      routeSlotKey: change.routeSlotKey.encoded,
      reasons: change.reasons,
      baselineEndpointIds: change.before === null ? [] : [change.before.endpointId],
      candidateEndpointIds: change.after === null ? [] : [change.after.endpointId],
      evidence: [
        ...locations(baseline, endpointEvidence(change.before, baseline)),
        ...locations(candidate, endpointEvidence(change.after, candidate)),
      ],
    };
  });
}

function createImpactedEndpoints(
  impact: ImpactDocument,
  baseline: AnalysisEvidenceIndex,
  candidate: AnalysisEvidenceIndex,
): CiImpactedEndpointRecord[] {
  return impact.impactedEndpoints.map((endpoint) => ({
    httpMethod: endpoint.httpMethod,
    path: endpoint.path,
    routeSlotKey: endpoint.routeSlotKey.encoded,
    direct: endpoint.direct,
    reasonCodes: endpoint.reasons.map(({ reasonCode }) => reasonCode),
    baselineEndpointIds: endpoint.beforeEndpointIds,
    candidateEndpointIds: endpoint.afterEndpointIds,
    evidence: endpoint.reasons.flatMap((reason) => [
      ...locations(baseline, reason.beforeEvidenceIds),
      ...locations(candidate, reason.afterEvidenceIds),
      ...reason.paths.flatMap((path) =>
        locations(
          path.side === 'before' ? baseline : candidate,
          path.steps.flatMap(({ evidenceIds }) => evidenceIds),
        ),
      ),
    ]),
  }));
}

function createPolicyResults(
  policy: PolicyResultsDocument,
  baseline: AnalysisEvidenceIndex,
  candidate: AnalysisEvidenceIndex,
): CiPolicyResultRecord[] {
  return policy.results.map((result) => ({
    ruleId: result.ruleId,
    severity: result.severity,
    outcome: result.outcome,
    blocking: result.blocking,
    reasonCode: result.reasonCode,
    message: result.message,
    subjectKey: result.subject.semanticKey.encoded,
    subjectDisplayName: result.subject.displayName,
    canonicalIds: result.subject.canonicalIds,
    evidence: resolvePolicyEvidence(result.evidenceIds, candidate, baseline),
  }));
}

function createDiagnosticChanges(
  comparison: DiffDocument,
  baseline: AnalysisEvidenceIndex,
  candidate: AnalysisEvidenceIndex,
): CiDiagnosticChangeRecord[] {
  return comparison.diagnosticChanges.map((change) => {
    const snapshot = change.after ?? change.before!;
    const index = change.after === null ? baseline : candidate;
    return {
      change: change.change,
      code: snapshot.code,
      severity: snapshot.severity,
      message: snapshot.message,
      diagnosticId: snapshot.diagnosticId,
      subjectKey: snapshot.subjectKey?.encoded ?? null,
      evidence: locations(index, snapshot.evidenceIds),
    };
  });
}

function createGaps(input: {
  baselineAnalysis: AnalysisDocument;
  candidateAnalysis: AnalysisDocument;
  comparison: DiffDocument;
  impact: ImpactDocument;
  policy: readonly CiPolicyResultRecord[];
  baseline: AnalysisEvidenceIndex;
  candidate: AnalysisEvidenceIndex;
}): CiGapRecord[] {
  const gaps: CiGapRecord[] = [];
  if (input.baselineAnalysis.resultState === 'completed_with_gaps') {
    gaps.push({
      code: 'baseline_analysis_incomplete',
      side: 'baseline',
      message: 'The baseline analysis completed with explicit diagnostic gaps.',
      canonicalIds: [input.baselineAnalysis.analysisRun.id],
      evidence: [],
    });
  }
  if (input.candidateAnalysis.resultState === 'completed_with_gaps') {
    gaps.push({
      code: 'candidate_analysis_incomplete',
      side: 'candidate',
      message: 'The candidate analysis completed with explicit diagnostic gaps.',
      canonicalIds: [input.candidateAnalysis.analysisRun.id],
      evidence: [],
    });
  }
  for (const [side, analysis] of [
    ['baseline', input.baselineAnalysis] as const,
    ['candidate', input.candidateAnalysis] as const,
  ]) {
    if (analysis.analysisRun.repositoryRevision === null) {
      gaps.push({
        code: 'repository_revision_missing',
        side,
        message: `The ${side} analysis has no repository revision.`,
        canonicalIds: [analysis.analysisRun.id],
        evidence: [],
      });
    }
  }
  for (const ambiguity of input.comparison.ambiguities) {
    gaps.push({
      code: 'comparison_ambiguity',
      side:
        ambiguity.side === 'both' ? null : ambiguity.side === 'before' ? 'baseline' : 'candidate',
      message: `Comparison ambiguity for ${ambiguity.recordKind} (${ambiguity.kind}).`,
      canonicalIds: [...ambiguity.beforeCandidateIds, ...ambiguity.afterCandidateIds],
      evidence: [],
    });
  }
  for (const result of input.policy.filter(({ outcome }) => outcome === 'unknown')) {
    gaps.push({
      code: 'policy_unknown',
      side: 'candidate',
      message: `Policy ${result.ruleId} is unknown for ${result.subjectDisplayName}.`,
      canonicalIds: result.canonicalIds,
      evidence: result.evidence,
    });
  }
  for (const endpoint of input.impact.impactedEndpoints) {
    for (const reason of endpoint.reasons.filter(
      ({ category }) => category === 'unknown_due_to_incomplete_trace',
    )) {
      gaps.push({
        code: 'impact_trace_incomplete',
        side: null,
        message: `Potential impact for ${endpoint.httpMethod} ${endpoint.path} contains an incomplete path.`,
        canonicalIds: [...endpoint.beforeEndpointIds, ...endpoint.afterEndpointIds],
        evidence: [
          ...locations(input.baseline, reason.beforeEvidenceIds),
          ...locations(input.candidate, reason.afterEvidenceIds),
        ],
      });
    }
  }
  for (const source of input.impact.unreachableSourceChanges) {
    gaps.push({
      code: 'changed_source_unreachable',
      side: null,
      message: `Changed source ${source.path} has no proven endpoint path (${source.reasonCodes.join(', ')}).`,
      canonicalIds: [],
      evidence: [],
    });
  }
  return gaps;
}

export function evaluateCiArtifacts(input: CiEvaluationInput): CiEvaluationDocument {
  throwIfCanceled(input.signal);
  const baseline = validateAnalysis(input.baseline, 'baseline');
  const candidate = validateAnalysis(input.candidate, 'candidate');
  let comparison: DiffDocument;
  let impact: ImpactDocument;
  let policyResults: PolicyResultsDocument;
  try {
    comparison = assertValidDiffDocument(input.comparison);
    impact = assertValidImpactDocument(input.impact);
    policyResults = assertValidPolicyResultsDocument(input.policyResults);
  } catch (error) {
    throw new CiEvaluationProcessError('invalid_input', 'Invalid CI input artifact.', {
      cause: error,
    });
  }
  assertCompatibleInputs({ baseline, candidate, comparison, impact, policyResults });
  throwIfCanceled(input.signal);

  const baselineIndex = evidenceIndex('baseline', baseline);
  const candidateIndex = evidenceIndex('candidate', candidate);
  const endpointChanges = createEndpointChanges(comparison, baselineIndex, candidateIndex);
  const impactedEndpoints = createImpactedEndpoints(impact, baselineIndex, candidateIndex);
  const policy = createPolicyResults(policyResults, baselineIndex, candidateIndex);
  const diagnosticChanges = createDiagnosticChanges(comparison, baselineIndex, candidateIndex);
  const gaps = createGaps({
    baselineAnalysis: baseline,
    candidateAnalysis: candidate,
    comparison,
    impact,
    policy,
    baseline: baselineIndex,
    candidate: candidateIndex,
  });
  const candidateDiagnostics = diagnosticChanges.filter(({ change }) => change !== 'resolved');
  const withoutId = {
    schemaVersion: CI_EVALUATION_SCHEMA_VERSION,
    outcome: policyResults.summary.blocking > 0 ? 'policy_violation' : 'success',
    provenance: {
      baseline: analysisProvenance(baseline),
      candidate: analysisProvenance(candidate),
      inputs: [
        {
          kind: 'comparison',
          schemaVersion: comparison.schemaVersion,
          artifactFingerprint: fingerprint(serializeDiffDocument(comparison)),
        },
        {
          kind: 'impact',
          schemaVersion: impact.schemaVersion,
          artifactFingerprint: fingerprint(serializeImpactDocument(impact)),
        },
        {
          kind: 'policy_results',
          schemaVersion: policyResults.schemaVersion,
          artifactFingerprint: fingerprint(serializePolicyResults(policyResults)),
        },
      ],
    },
    summary: {
      endpointChanges: {
        added: endpointChanges.filter(({ change }) => change === 'added').length,
        removed: endpointChanges.filter(({ change }) => change === 'removed').length,
        modified: endpointChanges.filter(({ change }) => change === 'modified').length,
        total: endpointChanges.length,
      },
      potentialImpact: {
        impactedEndpointSlots: impact.summary.impactedEndpointSlots,
        directlyChangedEndpointSlots: impact.summary.directlyChangedEndpointSlots,
        transitivelyImpactedEndpointSlots: impact.summary.transitivelyImpactedEndpointSlots,
        unreachableSourceChanges: impact.summary.unreachableSourceChanges,
      },
      policy: policyResults.summary,
      diagnostics: {
        newOrChangedInfo: candidateDiagnostics.filter(({ severity }) => severity === 'info').length,
        newOrChangedWarnings: candidateDiagnostics.filter(({ severity }) => severity === 'warning')
          .length,
        newOrChangedErrors: candidateDiagnostics.filter(({ severity }) => severity === 'error')
          .length,
        new: diagnosticChanges.filter(({ change }) => change === 'new').length,
        resolved: diagnosticChanges.filter(({ change }) => change === 'resolved').length,
        changed: diagnosticChanges.filter(({ change }) => change === 'changed').length,
      },
      gaps: gaps.length,
    },
    endpointChanges,
    impactedEndpoints,
    policyResults: policy,
    diagnosticChanges,
    gaps,
  } satisfies Omit<CiEvaluationDocument, 'evaluationId'>;

  const provisional = canonicalizeCiEvaluationDocument({
    ...withoutId,
    evaluationId: 'ci_evaluation:00000000000000000000000000000000',
  });
  const { evaluationId, ...canonicalWithoutId } = provisional;
  void evaluationId;
  throwIfCanceled(input.signal);
  return assertValidCiEvaluationDocument({
    ...canonicalWithoutId,
    evaluationId: expectedCiEvaluationId(canonicalWithoutId),
  });
}

export function ciProcessOutcome(error: unknown, signal?: AbortSignal): CiProcessOutcome {
  if (
    signal?.aborted === true ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  ) {
    return 'canceled';
  }
  return error instanceof CiEvaluationProcessError ? error.outcome : 'invalid_input';
}
