import { createHash } from 'node:crypto';
import { canonicalStringify } from '../model/ordering.js';
import type { CiAnnotation, CiEvaluationDocument, CiEvidenceLocation } from './model.js';

function compare(left: string, right: string): number {
  return left.localeCompare(right);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compare);
}

function evidenceKey(location: CiEvidenceLocation): string {
  return `${location.side}:${location.path}:${location.startLine}:${location.startColumn}:${location.endLine}:${location.endColumn}:${location.evidenceId}`;
}

export function canonicalizeCiEvidence(
  evidence: readonly CiEvidenceLocation[],
): CiEvidenceLocation[] {
  return [...new Map(evidence.map((location) => [evidenceKey(location), location])).values()].sort(
    (left, right) => compare(evidenceKey(left), evidenceKey(right)),
  );
}

export function canonicalizeCiEvaluationDocument(
  document: CiEvaluationDocument,
): CiEvaluationDocument {
  return {
    ...document,
    provenance: {
      ...document.provenance,
      inputs: [...document.provenance.inputs].sort((left, right) => compare(left.kind, right.kind)),
    },
    endpointChanges: [...document.endpointChanges]
      .map((record) => ({
        ...record,
        reasons: unique(record.reasons) as typeof record.reasons,
        baselineEndpointIds: unique(record.baselineEndpointIds),
        candidateEndpointIds: unique(record.candidateEndpointIds),
        evidence: canonicalizeCiEvidence(record.evidence),
      }))
      .sort((left, right) =>
        compare(`${left.routeSlotKey}:${left.change}`, `${right.routeSlotKey}:${right.change}`),
      ),
    impactedEndpoints: [...document.impactedEndpoints]
      .map((record) => ({
        ...record,
        reasonCodes: unique(record.reasonCodes) as typeof record.reasonCodes,
        baselineEndpointIds: unique(record.baselineEndpointIds),
        candidateEndpointIds: unique(record.candidateEndpointIds),
        evidence: canonicalizeCiEvidence(record.evidence),
      }))
      .sort((left, right) => compare(left.routeSlotKey, right.routeSlotKey)),
    policyResults: [...document.policyResults]
      .map((record) => ({
        ...record,
        canonicalIds: unique(record.canonicalIds),
        evidence: canonicalizeCiEvidence(record.evidence),
      }))
      .sort((left, right) =>
        compare(`${left.ruleId}:${left.subjectKey}`, `${right.ruleId}:${right.subjectKey}`),
      ),
    diagnosticChanges: [...document.diagnosticChanges]
      .map((record) => ({ ...record, evidence: canonicalizeCiEvidence(record.evidence) }))
      .sort((left, right) =>
        compare(
          `${left.code}:${left.diagnosticId}:${left.change}`,
          `${right.code}:${right.diagnosticId}:${right.change}`,
        ),
      ),
    gaps: [...document.gaps]
      .map((record) => ({
        ...record,
        canonicalIds: unique(record.canonicalIds),
        evidence: canonicalizeCiEvidence(record.evidence),
      }))
      .sort((left, right) =>
        compare(
          `${left.code}:${left.side ?? ''}:${left.message}`,
          `${right.code}:${right.side ?? ''}:${right.message}`,
        ),
      ),
  };
}

export function makeCiStableId(
  kind: 'ci_evaluation' | 'ci_annotation' | 'ci_scan_recipe' | 'ci_comment',
  value: unknown,
): string {
  const digest = createHash('sha256').update(canonicalStringify(value)).digest('hex').slice(0, 32);
  return `${kind}:${digest}`;
}

export function expectedCiEvaluationId(
  document: Omit<CiEvaluationDocument, 'evaluationId'>,
): string {
  return makeCiStableId('ci_evaluation', document);
}

export function serializeCiEvaluationDocument(document: CiEvaluationDocument): string {
  return canonicalStringify(canonicalizeCiEvaluationDocument(document));
}

export function canonicalizeCiAnnotations(annotations: readonly CiAnnotation[]): CiAnnotation[] {
  return [...annotations]
    .map((annotation) => ({
      ...annotation,
      canonicalIds: unique(annotation.canonicalIds),
    }))
    .sort((left, right) => compare(left.id, right.id));
}

export function serializeCiAnnotationStream(annotations: readonly CiAnnotation[]): string {
  const records = canonicalizeCiAnnotations(annotations);
  return records.length === 0
    ? ''
    : `${records
        .map((record) => JSON.stringify(JSON.parse(canonicalStringify(record))))
        .join('\n')}\n`;
}
