import type { EndpointChangeKind, EndpointChangeReason } from '../comparison/model.js';
import type { DiagnosticCode, DiagnosticSeverity } from '../model/diagnostics.js';
import type { EvidenceRole } from '../model/evidence.js';
import type { HttpMethod, ToolMetadata } from '../model/entities.js';
import type { ImpactReasonCode } from '../impact/model.js';
import type {
  PolicyOutcome,
  PolicyReasonCode,
  PolicyRuleId,
  PolicySeverity,
  PolicySummary,
} from '../policy/model.js';

export const CI_EVALUATION_SCHEMA_VERSION = '1.0.0' as const;
export const CI_INPUT_ARTIFACT_KINDS = ['comparison', 'impact', 'policy_results'] as const;
export type CiInputArtifactKind = (typeof CI_INPUT_ARTIFACT_KINDS)[number];
export const CI_EVALUATION_FORMATS = ['json', 'markdown', 'annotations-jsonl'] as const;
export type CiEvaluationFormat = (typeof CI_EVALUATION_FORMATS)[number];

export const CI_EVALUATION_OUTCOMES = ['success', 'policy_violation'] as const;
export type CiEvaluationOutcome = (typeof CI_EVALUATION_OUTCOMES)[number];

export const CI_PROCESS_OUTCOMES = [
  ...CI_EVALUATION_OUTCOMES,
  'invalid_input',
  'incompatible_baseline',
  'analysis_failure',
  'canceled',
] as const;
export type CiProcessOutcome = (typeof CI_PROCESS_OUTCOMES)[number];

export const CI_PROCESS_EXIT_CODES: Readonly<Record<CiProcessOutcome, number>> = {
  success: 0,
  policy_violation: 8,
  invalid_input: 10,
  incompatible_baseline: 11,
  analysis_failure: 6,
  canceled: 130,
};

export const CI_EVIDENCE_SIDES = ['baseline', 'candidate'] as const;
export type CiEvidenceSide = (typeof CI_EVIDENCE_SIDES)[number];

export interface CiEvidenceLocation {
  readonly side: CiEvidenceSide;
  readonly evidenceId: string;
  readonly fileId: string;
  readonly path: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly role: EvidenceRole;
  readonly contentHash: string;
}

export interface CiAnalysisProvenance {
  readonly analysisId: string;
  readonly schemaVersion: string;
  readonly resultState: 'completed' | 'completed_with_gaps';
  readonly repositoryRevision: string | null;
  readonly tool: ToolMetadata;
  readonly configurationFingerprint: string;
  readonly artifactFingerprint: string;
  readonly sourceFileCount: number;
}

export interface CiInputArtifactProvenance {
  readonly kind: CiInputArtifactKind;
  readonly schemaVersion: string;
  readonly artifactFingerprint: string;
}

export interface CiEndpointChangeRecord {
  readonly change: EndpointChangeKind;
  readonly httpMethod: HttpMethod;
  readonly path: string;
  readonly routeSlotKey: string;
  readonly reasons: readonly EndpointChangeReason[];
  readonly baselineEndpointIds: readonly string[];
  readonly candidateEndpointIds: readonly string[];
  readonly evidence: readonly CiEvidenceLocation[];
}

export interface CiImpactedEndpointRecord {
  readonly httpMethod: HttpMethod;
  readonly path: string;
  readonly routeSlotKey: string;
  readonly direct: boolean;
  readonly reasonCodes: readonly ImpactReasonCode[];
  readonly baselineEndpointIds: readonly string[];
  readonly candidateEndpointIds: readonly string[];
  readonly evidence: readonly CiEvidenceLocation[];
}

export interface CiPolicyResultRecord {
  readonly ruleId: PolicyRuleId;
  readonly severity: PolicySeverity;
  readonly outcome: PolicyOutcome;
  readonly blocking: boolean;
  readonly reasonCode: PolicyReasonCode;
  readonly message: string;
  readonly subjectKey: string;
  readonly subjectDisplayName: string;
  readonly canonicalIds: readonly string[];
  readonly evidence: readonly CiEvidenceLocation[];
}

export interface CiDiagnosticChangeRecord {
  readonly change: 'new' | 'resolved' | 'changed';
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly diagnosticId: string;
  readonly subjectKey: string | null;
  readonly evidence: readonly CiEvidenceLocation[];
}

export const CI_GAP_CODES = [
  'baseline_analysis_incomplete',
  'candidate_analysis_incomplete',
  'repository_revision_missing',
  'comparison_ambiguity',
  'policy_unknown',
  'impact_trace_incomplete',
  'changed_source_unreachable',
] as const;
export type CiGapCode = (typeof CI_GAP_CODES)[number];

export interface CiGapRecord {
  readonly code: CiGapCode;
  readonly side: CiEvidenceSide | null;
  readonly message: string;
  readonly canonicalIds: readonly string[];
  readonly evidence: readonly CiEvidenceLocation[];
}

export interface CiEvaluationSummary {
  readonly endpointChanges: {
    readonly added: number;
    readonly removed: number;
    readonly modified: number;
    readonly total: number;
  };
  readonly potentialImpact: {
    readonly impactedEndpointSlots: number;
    readonly directlyChangedEndpointSlots: number;
    readonly transitivelyImpactedEndpointSlots: number;
    readonly unreachableSourceChanges: number;
  };
  readonly policy: PolicySummary;
  readonly diagnostics: {
    readonly newOrChangedInfo: number;
    readonly newOrChangedWarnings: number;
    readonly newOrChangedErrors: number;
    readonly new: number;
    readonly resolved: number;
    readonly changed: number;
  };
  readonly gaps: number;
}

export interface CiEvaluationDocument {
  readonly schemaVersion: typeof CI_EVALUATION_SCHEMA_VERSION;
  readonly evaluationId: string;
  readonly outcome: CiEvaluationOutcome;
  readonly provenance: {
    readonly baseline: CiAnalysisProvenance;
    readonly candidate: CiAnalysisProvenance;
    readonly inputs: readonly CiInputArtifactProvenance[];
  };
  readonly summary: CiEvaluationSummary;
  readonly endpointChanges: readonly CiEndpointChangeRecord[];
  readonly impactedEndpoints: readonly CiImpactedEndpointRecord[];
  readonly policyResults: readonly CiPolicyResultRecord[];
  readonly diagnosticChanges: readonly CiDiagnosticChangeRecord[];
  readonly gaps: readonly CiGapRecord[];
}

export const CI_ANNOTATION_LEVELS = ['notice', 'warning', 'failure'] as const;
export type CiAnnotationLevel = (typeof CI_ANNOTATION_LEVELS)[number];
export const CI_ANNOTATION_CATEGORIES = [
  'endpoint_change',
  'potential_impact',
  'policy',
  'diagnostic',
  'gap',
] as const;
export type CiAnnotationCategory = (typeof CI_ANNOTATION_CATEGORIES)[number];

export interface CiAnnotation {
  readonly id: string;
  readonly category: CiAnnotationCategory;
  readonly level: CiAnnotationLevel;
  readonly title: string;
  readonly message: string;
  readonly location: CiEvidenceLocation | null;
  readonly canonicalIds: readonly string[];
}
