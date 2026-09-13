import { z } from 'zod';
import { ENDPOINT_CHANGE_KINDS, ENDPOINT_CHANGE_REASONS } from '../comparison/model.js';
import { DIAGNOSTIC_CODES, DIAGNOSTIC_SEVERITIES } from '../model/diagnostics.js';
import { EVIDENCE_ROLES } from '../model/evidence.js';
import { HTTP_METHODS } from '../model/entities.js';
import { IMPACT_REASON_CODES } from '../impact/model.js';
import {
  POLICY_OUTCOMES,
  POLICY_REASON_CODES,
  POLICY_RULE_IDS,
  POLICY_SEVERITIES,
} from '../policy/model.js';
import {
  contentHashSchema,
  repositoryRelativePathSchema,
  stableIdSchema,
} from '../model/schemas.js';
import {
  CI_ANNOTATION_CATEGORIES,
  CI_ANNOTATION_LEVELS,
  CI_EVALUATION_OUTCOMES,
  CI_EVALUATION_SCHEMA_VERSION,
  CI_EVIDENCE_SIDES,
  CI_GAP_CODES,
  CI_INPUT_ARTIFACT_KINDS,
  type CiAnnotation,
  type CiEvaluationDocument,
} from './model.js';

const nonEmptyString = z.string().min(1);
const count = z.number().int().nonnegative();

export const ciEvidenceLocationSchema = z
  .object({
    side: z.enum(CI_EVIDENCE_SIDES),
    evidenceId: stableIdSchema,
    fileId: stableIdSchema,
    path: repositoryRelativePathSchema,
    startLine: z.number().int().positive(),
    startColumn: z.number().int().positive(),
    endLine: z.number().int().positive(),
    endColumn: z.number().int().positive(),
    role: z.enum(EVIDENCE_ROLES),
    contentHash: contentHashSchema,
  })
  .strict()
  .refine(
    ({ startLine, startColumn, endLine, endColumn }) =>
      endLine > startLine || (endLine === startLine && endColumn >= startColumn),
    'Evidence end must not precede its start.',
  );

const analysisProvenanceSchema = z
  .object({
    analysisId: stableIdSchema,
    schemaVersion: nonEmptyString,
    resultState: z.enum(['completed', 'completed_with_gaps']),
    repositoryRevision: nonEmptyString.nullable(),
    tool: z
      .object({ name: nonEmptyString, version: nonEmptyString, typescriptVersion: nonEmptyString })
      .strict(),
    configurationFingerprint: contentHashSchema,
    artifactFingerprint: contentHashSchema,
    sourceFileCount: count,
  })
  .strict();

const inputArtifactSchema = z
  .object({
    kind: z.enum(CI_INPUT_ARTIFACT_KINDS),
    schemaVersion: nonEmptyString,
    artifactFingerprint: contentHashSchema,
  })
  .strict();

const endpointChangeSchema = z
  .object({
    change: z.enum(ENDPOINT_CHANGE_KINDS),
    httpMethod: z.enum(HTTP_METHODS),
    path: nonEmptyString,
    routeSlotKey: nonEmptyString,
    reasons: z.array(z.enum(ENDPOINT_CHANGE_REASONS)).min(1),
    baselineEndpointIds: z.array(stableIdSchema),
    candidateEndpointIds: z.array(stableIdSchema),
    evidence: z.array(ciEvidenceLocationSchema),
  })
  .strict();

const impactedEndpointSchema = z
  .object({
    httpMethod: z.enum(HTTP_METHODS),
    path: nonEmptyString,
    routeSlotKey: nonEmptyString,
    direct: z.boolean(),
    reasonCodes: z.array(z.enum(IMPACT_REASON_CODES)).min(1),
    baselineEndpointIds: z.array(stableIdSchema),
    candidateEndpointIds: z.array(stableIdSchema),
    evidence: z.array(ciEvidenceLocationSchema),
  })
  .strict();

const policyResultSchema = z
  .object({
    ruleId: z.enum(POLICY_RULE_IDS),
    severity: z.enum(POLICY_SEVERITIES),
    outcome: z.enum(POLICY_OUTCOMES),
    blocking: z.boolean(),
    reasonCode: z.enum(POLICY_REASON_CODES),
    message: nonEmptyString,
    subjectKey: nonEmptyString,
    subjectDisplayName: nonEmptyString,
    canonicalIds: z.array(stableIdSchema).min(1),
    evidence: z.array(ciEvidenceLocationSchema),
  })
  .strict();

const diagnosticChangeSchema = z
  .object({
    change: z.enum(['new', 'resolved', 'changed']),
    code: z.enum(DIAGNOSTIC_CODES),
    severity: z.enum(DIAGNOSTIC_SEVERITIES),
    message: nonEmptyString,
    diagnosticId: stableIdSchema,
    subjectKey: nonEmptyString.nullable(),
    evidence: z.array(ciEvidenceLocationSchema),
  })
  .strict();

const gapSchema = z
  .object({
    code: z.enum(CI_GAP_CODES),
    side: z.enum(CI_EVIDENCE_SIDES).nullable(),
    message: nonEmptyString,
    canonicalIds: z.array(stableIdSchema),
    evidence: z.array(ciEvidenceLocationSchema),
  })
  .strict();

export const ciPolicySummarySchema = z
  .object({
    passed: count,
    failed: count,
    unknown: count,
    notApplicable: count,
    warnings: count,
    errors: count,
    blocking: count,
  })
  .strict();

export const ciEvaluationSummarySchema = z
  .object({
    endpointChanges: z
      .object({ added: count, removed: count, modified: count, total: count })
      .strict(),
    potentialImpact: z
      .object({
        impactedEndpointSlots: count,
        directlyChangedEndpointSlots: count,
        transitivelyImpactedEndpointSlots: count,
        unreachableSourceChanges: count,
      })
      .strict(),
    policy: ciPolicySummarySchema,
    diagnostics: z
      .object({
        newOrChangedInfo: count,
        newOrChangedWarnings: count,
        newOrChangedErrors: count,
        new: count,
        resolved: count,
        changed: count,
      })
      .strict(),
    gaps: count,
  })
  .strict();

export const ciEvaluationDocumentSchema: z.ZodType<CiEvaluationDocument> = z
  .object({
    schemaVersion: z.literal(CI_EVALUATION_SCHEMA_VERSION),
    evaluationId: stableIdSchema,
    outcome: z.enum(CI_EVALUATION_OUTCOMES),
    provenance: z
      .object({
        baseline: analysisProvenanceSchema,
        candidate: analysisProvenanceSchema,
        inputs: z.array(inputArtifactSchema).length(3),
      })
      .strict(),
    summary: ciEvaluationSummarySchema,
    endpointChanges: z.array(endpointChangeSchema),
    impactedEndpoints: z.array(impactedEndpointSchema),
    policyResults: z.array(policyResultSchema),
    diagnosticChanges: z.array(diagnosticChangeSchema),
    gaps: z.array(gapSchema),
  })
  .strict();

export const ciAnnotationSchema: z.ZodType<CiAnnotation> = z
  .object({
    id: stableIdSchema,
    category: z.enum(CI_ANNOTATION_CATEGORIES),
    level: z.enum(CI_ANNOTATION_LEVELS),
    title: nonEmptyString,
    message: nonEmptyString,
    location: ciEvidenceLocationSchema.nullable(),
    canonicalIds: z.array(stableIdSchema),
  })
  .strict();
