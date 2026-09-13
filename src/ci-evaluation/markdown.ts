import type { CiEvaluationDocument } from './model.js';
import { assertValidCiEvaluationDocument } from './validate.js';

function escape(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

export function renderCiEvaluationMarkdown(input: CiEvaluationDocument): string {
  const document = assertValidCiEvaluationDocument(input);
  const { summary } = document;
  const lines = [
    '# API Intelligence CI Evaluation',
    '',
    `Outcome: **${document.outcome === 'success' ? 'pass' : 'policy violation'}**  `,
    `Evaluation: \`${document.evaluationId}\`  `,
    `Baseline: \`${document.provenance.baseline.analysisId}\` (${document.provenance.baseline.repositoryRevision ?? 'revision unavailable'})  `,
    `Candidate: \`${document.provenance.candidate.analysisId}\` (${document.provenance.candidate.repositoryRevision ?? 'revision unavailable'})`,
    '',
    '> Potential impact is a repository-local static reachability result. It does not prove runtime behavior changed.',
    '',
    '## Summary',
    '',
    '| Category | Result |',
    '| --- | ---: |',
    `| Endpoints added / removed / modified | ${summary.endpointChanges.added} / ${summary.endpointChanges.removed} / ${summary.endpointChanges.modified} |`,
    `| Potentially impacted endpoints | ${summary.potentialImpact.impactedEndpointSlots} |`,
    `| Direct / transitive impact | ${summary.potentialImpact.directlyChangedEndpointSlots} / ${summary.potentialImpact.transitivelyImpactedEndpointSlots} |`,
    `| Blocking policy results | ${summary.policy.blocking} |`,
    `| Policy warnings / errors / unknown | ${summary.policy.warnings} / ${summary.policy.errors} / ${summary.policy.unknown} |`,
    `| Diagnostics new / resolved / changed | ${summary.diagnostics.new} / ${summary.diagnostics.resolved} / ${summary.diagnostics.changed} |`,
    `| Explicit gaps | ${summary.gaps} |`,
    '',
    '## Endpoint changes',
    '',
  ];
  if (document.endpointChanges.length === 0) lines.push('No semantic endpoint changes.');
  for (const change of document.endpointChanges) {
    lines.push(
      `- **${change.change}** \`${change.httpMethod} ${escape(change.path)}\` — ${change.reasons.join(', ')}`,
    );
  }
  lines.push('', '## Potential impact', '');
  if (document.impactedEndpoints.length === 0) {
    lines.push('No changed supported fact is reachable from an endpoint.');
  }
  for (const endpoint of document.impactedEndpoints) {
    lines.push(
      `- **${endpoint.direct ? 'direct' : 'transitive'}** \`${endpoint.httpMethod} ${escape(endpoint.path)}\` — ${endpoint.reasonCodes.join(', ')}`,
    );
  }
  lines.push('', '## Policy findings', '');
  const findings = document.policyResults.filter(
    ({ outcome }) => outcome === 'fail' || outcome === 'unknown',
  );
  if (findings.length === 0) lines.push('No failed or unknown policy results.');
  for (const result of findings) {
    lines.push(
      `- **${result.blocking ? 'blocking' : result.severity}** \`${result.ruleId}\` — ${escape(result.message)}`,
    );
  }
  lines.push('', '## Diagnostic changes', '');
  if (document.diagnosticChanges.length === 0) lines.push('No diagnostic changes.');
  for (const diagnostic of document.diagnosticChanges) {
    lines.push(
      `- **${diagnostic.change} ${diagnostic.severity}** \`${diagnostic.code}\` — ${escape(diagnostic.message)}`,
    );
  }
  lines.push('', '## Explicit gaps', '');
  if (document.gaps.length === 0) lines.push('No explicit comparison or analysis gaps.');
  for (const gap of document.gaps) {
    lines.push(`- \`${gap.code}\` — ${escape(gap.message)}`);
  }
  return `${lines.join('\n')}\n`;
}
