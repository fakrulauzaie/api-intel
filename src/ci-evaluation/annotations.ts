import type { DiagnosticSeverity } from '../model/diagnostics.js';
import type {
  CiAnnotation,
  CiAnnotationLevel,
  CiEvaluationDocument,
  CiEvidenceLocation,
} from './model.js';
import { canonicalizeCiAnnotations, makeCiStableId } from './ordering.js';
import { assertValidCiEvaluationDocument } from './validate.js';
import { ciAnnotationSchema } from './schemas.js';

function preferredLocation(evidence: readonly CiEvidenceLocation[]): CiEvidenceLocation | null {
  return evidence.find(({ side }) => side === 'candidate') ?? evidence[0] ?? null;
}

function diagnosticLevel(severity: DiagnosticSeverity): CiAnnotationLevel {
  return severity === 'error' ? 'failure' : severity === 'warning' ? 'warning' : 'notice';
}

function annotation(input: Omit<CiAnnotation, 'id'>): CiAnnotation {
  return ciAnnotationSchema.parse({
    ...input,
    id: makeCiStableId('ci_annotation', input),
  });
}

export function projectCiAnnotations(input: CiEvaluationDocument): CiAnnotation[] {
  const document = assertValidCiEvaluationDocument(input);
  const annotations: CiAnnotation[] = [];

  for (const change of document.endpointChanges) {
    annotations.push(
      annotation({
        category: 'endpoint_change',
        level: 'notice',
        title: `Endpoint ${change.change}`,
        message: `${change.httpMethod} ${change.path}: ${change.reasons.join(', ')}.`,
        location: preferredLocation(change.evidence),
        canonicalIds: [...change.baselineEndpointIds, ...change.candidateEndpointIds],
      }),
    );
  }
  for (const endpoint of document.impactedEndpoints) {
    annotations.push(
      annotation({
        category: 'potential_impact',
        level: endpoint.direct ? 'notice' : 'warning',
        title: endpoint.direct ? 'Direct endpoint change' : 'Potential transitive impact',
        message: `${endpoint.httpMethod} ${endpoint.path}: ${endpoint.reasonCodes.join(', ')}.`,
        location: preferredLocation(endpoint.evidence),
        canonicalIds: [...endpoint.baselineEndpointIds, ...endpoint.candidateEndpointIds],
      }),
    );
  }
  for (const result of document.policyResults.filter(
    ({ outcome }) => outcome === 'fail' || outcome === 'unknown',
  )) {
    annotations.push(
      annotation({
        category: 'policy',
        level: result.blocking ? 'failure' : 'warning',
        title: `Policy ${result.outcome}: ${result.ruleId}`,
        message: result.message,
        location: preferredLocation(result.evidence),
        canonicalIds: result.canonicalIds,
      }),
    );
  }
  for (const diagnostic of document.diagnosticChanges.filter(
    ({ change }) => change !== 'resolved',
  )) {
    annotations.push(
      annotation({
        category: 'diagnostic',
        level: diagnosticLevel(diagnostic.severity),
        title: `${diagnostic.change} diagnostic: ${diagnostic.code}`,
        message: diagnostic.message,
        location: preferredLocation(diagnostic.evidence),
        canonicalIds: [diagnostic.diagnosticId],
      }),
    );
  }
  for (const gap of document.gaps) {
    annotations.push(
      annotation({
        category: 'gap',
        level: 'warning',
        title: `Analysis gap: ${gap.code}`,
        message: gap.message,
        location: preferredLocation(gap.evidence),
        canonicalIds: gap.canonicalIds,
      }),
    );
  }
  return canonicalizeCiAnnotations(annotations);
}
