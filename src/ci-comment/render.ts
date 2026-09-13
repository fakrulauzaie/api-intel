import type { CiCommentDocument } from './model.js';
import { escapeCiCommentMarkdown } from './presentation.js';

function link(label: string, url: string): string {
  const destination = url.replaceAll('<', '%3C').replaceAll('>', '%3E');
  return `[${escapeCiCommentMarkdown(label, 160)}](<${destination}>)`;
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function renderCiCommentMarkdownUnchecked(document: CiCommentDocument): string {
  const { summary } = document;
  const lines = [
    document.upsert.marker,
    '## API Intelligence impact summary',
    '',
    `**Outcome:** ${document.outcome === 'success' ? 'Pass' : 'Policy violation'}  `,
    `**Run:** ${link(`${titleCase(document.run.provider)} ${document.run.id}`, document.run.url)}  `,
    `**Evaluation:** \`${document.evaluationId}\`  `,
    `**Candidate:** \`${document.candidate.analysisId}\` (${escapeCiCommentMarkdown(document.candidate.repositoryRevision ?? 'revision unavailable', 256)})`,
    '',
    '> Potential impact is evidence-backed static reachability. It does not prove runtime behavior, deployment, broker delivery, or remote execution.',
    '',
    '| Category | Result |',
    '| --- | ---: |',
    `| Endpoints added / removed / modified | ${summary.endpointChanges.added} / ${summary.endpointChanges.removed} / ${summary.endpointChanges.modified} |`,
    `| Potential impact: direct / transitive | ${summary.potentialImpact.directlyChangedEndpointSlots} / ${summary.potentialImpact.transitivelyImpactedEndpointSlots} |`,
    `| Blocking policy results | ${summary.policy.blocking} |`,
    `| Policy warnings / errors / unknown | ${summary.policy.warnings} / ${summary.policy.errors} / ${summary.policy.unknown} |`,
    `| New or changed diagnostic warnings / errors | ${summary.diagnostics.newOrChangedWarnings} / ${summary.diagnostics.newOrChangedErrors} |`,
    `| Explicit gaps | ${summary.gaps} |`,
    '',
    '### Highest-priority findings',
    '',
  ];

  if (document.findings.length === 0) lines.push('No publishable findings.');
  for (const finding of document.findings) {
    const location =
      finding.location === null
        ? ''
        : ` — ${escapeCiCommentMarkdown(finding.location.path, 1_024)}:${finding.location.startLine} (${finding.location.side})`;
    lines.push(
      `- **${titleCase(finding.level)} · ${titleCase(finding.category)}** — ${escapeCiCommentMarkdown(finding.title, 160)}: ${escapeCiCommentMarkdown(finding.message, 768)}${location}`,
    );
  }
  if (document.limits.omittedItems > 0) {
    lines.push(
      '',
      `${document.limits.omittedItems} additional finding(s) are retained in the evidence artifacts.`,
    );
  }

  lines.push('', '### Evidence artifacts', '');
  for (const artifact of document.artifactLinks) {
    lines.push(`- ${link(artifact.label, artifact.url)} — ${titleCase(artifact.kind)}`);
  }
  if (document.limits.omittedArtifactLinks > 0) {
    lines.push(
      '',
      `${document.limits.omittedArtifactLinks} additional artifact link(s) were omitted from this bounded comment.`,
    );
  }
  lines.push('', '_Full evidence remains in the downloadable CI artifacts._', '');
  return lines.join('\n');
}
