import type { CiEvaluationDocument, CiEvaluationSummary } from './model.js';
import { canonicalizeCiEvaluationDocument, expectedCiEvaluationId } from './ordering.js';
import { ciEvaluationDocumentSchema } from './schemas.js';

export const CI_EVALUATION_INTEGRITY_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'SUMMARY_MISMATCH',
  'OUTCOME_MISMATCH',
  'IDENTITY_MISMATCH',
  'DUPLICATE_RECORD',
] as const;
export type CiEvaluationIntegrityIssueCode = (typeof CI_EVALUATION_INTEGRITY_ISSUE_CODES)[number];

export interface CiEvaluationIntegrityIssue {
  readonly code: CiEvaluationIntegrityIssueCode;
  readonly message: string;
  readonly path?: string;
}

export type CiEvaluationValidationResult =
  | { readonly success: true; readonly data: CiEvaluationDocument }
  | { readonly success: false; readonly issues: readonly CiEvaluationIntegrityIssue[] };

function expectedSummary(document: CiEvaluationDocument): CiEvaluationSummary {
  const candidateDiagnostics = document.diagnosticChanges.filter(
    ({ change }) => change !== 'resolved',
  );
  return {
    endpointChanges: {
      added: document.endpointChanges.filter(({ change }) => change === 'added').length,
      removed: document.endpointChanges.filter(({ change }) => change === 'removed').length,
      modified: document.endpointChanges.filter(({ change }) => change === 'modified').length,
      total: document.endpointChanges.length,
    },
    potentialImpact: {
      impactedEndpointSlots: document.impactedEndpoints.length,
      directlyChangedEndpointSlots: document.impactedEndpoints.filter(({ direct }) => direct)
        .length,
      transitivelyImpactedEndpointSlots: document.impactedEndpoints.filter(({ reasonCodes }) =>
        reasonCodes.some((reasonCode) =>
          ['changed_method_reachable', 'changed_entity_table_reachable'].includes(reasonCode),
        ),
      ).length,
      unreachableSourceChanges: document.gaps.filter(
        ({ code }) => code === 'changed_source_unreachable',
      ).length,
    },
    policy: {
      passed: document.policyResults.filter(({ outcome }) => outcome === 'pass').length,
      failed: document.policyResults.filter(({ outcome }) => outcome === 'fail').length,
      unknown: document.policyResults.filter(({ outcome }) => outcome === 'unknown').length,
      notApplicable: document.policyResults.filter(({ outcome }) => outcome === 'not_applicable')
        .length,
      warnings: document.policyResults.filter(
        ({ outcome, severity }) =>
          (outcome === 'fail' || outcome === 'unknown') && severity === 'warn',
      ).length,
      errors: document.policyResults.filter(
        ({ outcome, severity }) =>
          (outcome === 'fail' || outcome === 'unknown') && severity === 'error',
      ).length,
      blocking: document.policyResults.filter(({ blocking }) => blocking).length,
    },
    diagnostics: {
      newOrChangedInfo: candidateDiagnostics.filter(({ severity }) => severity === 'info').length,
      newOrChangedWarnings: candidateDiagnostics.filter(({ severity }) => severity === 'warning')
        .length,
      newOrChangedErrors: candidateDiagnostics.filter(({ severity }) => severity === 'error')
        .length,
      new: document.diagnosticChanges.filter(({ change }) => change === 'new').length,
      resolved: document.diagnosticChanges.filter(({ change }) => change === 'resolved').length,
      changed: document.diagnosticChanges.filter(({ change }) => change === 'changed').length,
    },
    gaps: document.gaps.length,
  };
}

function addSummaryIssues(
  document: CiEvaluationDocument,
  issues: CiEvaluationIntegrityIssue[],
): void {
  const expected = expectedSummary(document);
  for (const section of Object.keys(expected) as (keyof CiEvaluationSummary)[]) {
    if (JSON.stringify(document.summary[section]) !== JSON.stringify(expected[section])) {
      issues.push({
        code: 'SUMMARY_MISMATCH',
        path: `summary.${section}`,
        message: `Summary ${section} does not match its projected records.`,
      });
    }
  }
}

function addDuplicateIssues(
  document: CiEvaluationDocument,
  issues: CiEvaluationIntegrityIssue[],
): void {
  const collections: readonly [string, readonly string[]][] = [
    [
      'endpointChanges',
      document.endpointChanges.map(({ change, routeSlotKey }) => `${change}:${routeSlotKey}`),
    ],
    ['impactedEndpoints', document.impactedEndpoints.map(({ routeSlotKey }) => routeSlotKey)],
    [
      'policyResults',
      document.policyResults.map(({ ruleId, subjectKey }) => `${ruleId}:${subjectKey}`),
    ],
    [
      'diagnosticChanges',
      document.diagnosticChanges.map(({ change, diagnosticId }) => `${change}:${diagnosticId}`),
    ],
  ];
  for (const [path, keys] of collections) {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) {
        issues.push({
          code: 'DUPLICATE_RECORD',
          path,
          message: `${path} repeats ${key}.`,
        });
      }
      seen.add(key);
    }
  }
}

export function validateCiEvaluationDocument(input: unknown): CiEvaluationValidationResult {
  const parsed = ciEvaluationDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_INVALID',
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  const document = canonicalizeCiEvaluationDocument(parsed.data);
  const issues: CiEvaluationIntegrityIssue[] = [];
  addSummaryIssues(document, issues);
  addDuplicateIssues(document, issues);

  const expectedOutcome = document.summary.policy.blocking > 0 ? 'policy_violation' : 'success';
  if (document.outcome !== expectedOutcome) {
    issues.push({
      code: 'OUTCOME_MISMATCH',
      path: 'outcome',
      message: 'Evaluation outcome does not match the configured blocking policy results.',
    });
  }

  const { evaluationId, ...identityInput } = document;
  void evaluationId;
  if (document.evaluationId !== expectedCiEvaluationId(identityInput)) {
    issues.push({
      code: 'IDENTITY_MISMATCH',
      path: 'evaluationId',
      message: 'Evaluation ID does not match the canonical document projection.',
    });
  }

  return issues.length === 0
    ? { success: true, data: document }
    : {
        success: false,
        issues: issues.sort((left, right) =>
          `${left.code}:${left.path ?? ''}`.localeCompare(`${right.code}:${right.path ?? ''}`),
        ),
      };
}

export class CiEvaluationIntegrityError extends Error {
  readonly issues: readonly CiEvaluationIntegrityIssue[];

  constructor(issues: readonly CiEvaluationIntegrityIssue[]) {
    super(`CI evaluation integrity validation failed with ${issues.length} issue(s).`);
    this.name = 'CiEvaluationIntegrityError';
    this.issues = issues;
  }
}

export function assertValidCiEvaluationDocument(input: unknown): CiEvaluationDocument {
  const result = validateCiEvaluationDocument(input);
  if (!result.success) throw new CiEvaluationIntegrityError(result.issues);
  return result.data;
}
