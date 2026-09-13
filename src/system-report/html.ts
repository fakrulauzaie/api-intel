import { createHash } from 'node:crypto';
import { canonicalStringify } from '../model/ordering.js';
import {
  CYTOSCAPE_RUNTIME_CONTAINER_STYLE,
  loadCytoscapeBrowserSource,
} from '../graph-report/html.js';
import type { SystemReportDocument } from './model.js';
import type { SystemImpactDocumentV2, SystemImpactGraphOverlay } from '../system-impact/model.js';
import { assertValidSystemImpactDocument } from '../system-impact/validate.js';
import { assertValidSystemReportDocument } from './validate.js';
import { OFFLINE_SYSTEM_REPORT_APP } from './app-script.js';
import { OFFLINE_SYSTEM_REPORT_STYLES } from './styles.js';

function cspHash(contents: string): string {
  return `'sha256-${createHash('sha256').update(contents, 'utf8').digest('base64')}'`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeData(value: unknown): string {
  return canonicalStringify(value)
    .trimEnd()
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function assertScriptSafe(name: string, contents: string): void {
  if (/<\/script/iu.test(contents)) throw new Error(`${name} contains a closing script sequence.`);
}

interface ImpactRenderView {
  readonly impactId: string;
  readonly side: 'before' | 'after';
  readonly summary: SystemImpactDocumentV2['propagation']['summary'];
  readonly overlay: SystemImpactGraphOverlay;
}

async function renderOfflineSystemReportInternal(
  input: SystemReportDocument,
  cytoscapeSource: string | undefined,
  impact: ImpactRenderView | undefined,
): Promise<string> {
  const document = assertValidSystemReportDocument(input);
  const library = cytoscapeSource ?? (await loadCytoscapeBrowserSource());
  const data = safeData(impact === undefined ? document : { report: document, impact });
  for (const [name, value] of [
    ['Cytoscape.js', library],
    ['System graph application', OFFLINE_SYSTEM_REPORT_APP],
    ['System graph data', data],
  ] as const)
    assertScriptSafe(name, value);
  const styleHashes = [OFFLINE_SYSTEM_REPORT_STYLES, CYTOSCAPE_RUNTIME_CONTAINER_STYLE]
    .map(cspHash)
    .join(' ');
  const csp = [
    "default-src 'none'",
    `script-src ${[library, OFFLINE_SYSTEM_REPORT_APP, data].map(cspHash).join(' ')}`,
    `style-src ${styleHashes}`,
    `style-src-elem ${styleHashes}`,
    "style-src-attr 'unsafe-inline'",
    'img-src data: blob:',
    "connect-src 'none'",
    "font-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const rows = document.policies.results
    .map(
      (result) =>
        `<tr><td><code>${escapeHtml(result.ruleId)}</code></td><td class="${result.outcome}">${escapeHtml(result.outcome)}</td><td>${escapeHtml(result.message)}</td></tr>`,
    )
    .join('');
  const limitNotice =
    document.summary.omittedNodes + document.summary.omittedEdges === 0
      ? ''
      : `<p class="notice" role="status">Display limit omitted ${document.summary.omittedNodes} node(s) and ${document.summary.omittedEdges} edge(s). Canonical correlation and path summaries remain in the embedded report data.</p>`;
  const impactButton =
    impact === undefined
      ? ''
      : '<button id="view-impact" type="button" aria-pressed="true">Potential impact</button>';
  const impactChip =
    impact === undefined
      ? ''
      : `<span class="chip impact-chip">${impact.summary.effects} distributed-conditional effect${impact.summary.effects === 1 ? '' : 's'}</span>`;
  const impactNotice =
    impact === undefined
      ? ''
      : `<p class="notice impact-notice"><strong>Potential-impact overlay:</strong> highlighted paths begin at evidence-backed local changes and cross only explicitly declared-realm candidates. They remain static, distributed-conditional paths; delivery and execution are not proven.</p>`;
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="api-intel-system-report-schema" content="${document.schemaVersion}">
<title>API Intel system graph: ${escapeHtml(document.system.name)}</title>
<style>${OFFLINE_SYSTEM_REPORT_STYLES}</style>
</head><body>
<header><div><h1>API Intel system graph</h1><div class="subtitle">${escapeHtml(document.system.name)} · conditional static topology</div></div><div class="snapshot">Report ${escapeHtml(document.schemaVersion)}<br>${document.summary.services} services · ${document.summary.conditionalPaths} conditional paths</div></header>
${limitNotice}${impactNotice}
<div class="layout">
<aside class="sidebar"><h2>Correlations</h2><label>Search<input id="filter-search" type="search" autocomplete="off"></label><label>State<select id="filter-state"><option value="">Any</option><option value="declared_realm_candidate">Declared realm candidate</option><option value="target_only_candidate">Target only</option><option value="ambiguous">Ambiguous</option><option value="unmatched">Unmatched</option></select></label><p id="result-count" class="muted"></p><ul id="correlation-list" class="correlations"></ul></aside>
<main class="main">
<div class="summary"><span class="chip">${document.summary.declaredRealmCandidates} declared realm</span><span class="chip">${document.summary.workerEffects} worker effects</span>${impactChip}<span class="chip">${document.summary.policyFailures} policy failures</span><span class="chip">${document.summary.diagnostics} diagnostics</span></div>
<p class="notice"><strong>Honesty boundary:</strong> dashed broker paths are static conditional candidates. They do not prove deployment, routing, delivery, acknowledgement, handler execution, or downstream effects.</p>
<div class="workspace"><section class="card graph-card"><div class="graph-toolbar" role="group" aria-label="Graph view">${impactButton}<button id="view-paths" type="button" aria-pressed="${impact === undefined ? 'true' : 'false'}">Conditional paths</button><button id="view-all" type="button" aria-pressed="false">All interactions</button><button id="fit-graph" type="button">Fit view</button><span id="graph-view-status" class="muted" aria-live="polite"></span></div><div id="graph" aria-hidden="true"></div></section><aside id="inspector" class="card inspector" aria-live="polite"><h3>Inspect the graph</h3><p class="muted">Select a correlation, node, or edge.</p></aside></div>
<section class="card section"><h2>System policy results</h2><div class="table-scroll"><table><thead><tr><th>Rule</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<details class="card section"><summary>Accessible graph table</summary><div class="table-scroll"><table><thead><tr><th>Record</th><th>Kind</th><th>Label or connection</th><th>Certainty</th><th>Provenance / correlation</th></tr></thead><tbody id="fallback-body"></tbody></table></div></details>
</main></div>
<noscript><p class="notice">JavaScript is required to explore this local report. The file makes no network requests.</p></noscript>
<script id="api-intel-system-data" type="application/json">${data}</script><script>${library}</script><script>${OFFLINE_SYSTEM_REPORT_APP}</script>
</body></html>`;
  if (/(?:src|href)\s*=\s*["']\s*(?:https?:|\/\/)/iu.test(html)) {
    throw new Error('The offline system report contains an external resource URL.');
  }
  return html;
}

export async function renderOfflineSystemReport(
  input: SystemReportDocument,
  cytoscapeSource?: string,
): Promise<string> {
  return renderOfflineSystemReportInternal(input, cytoscapeSource, undefined);
}

export async function renderOfflineSystemImpactReport(
  input: {
    readonly report: SystemReportDocument;
    readonly impact: SystemImpactDocumentV2;
    readonly side: 'before' | 'after';
  },
  cytoscapeSource?: string,
): Promise<string> {
  const impact = assertValidSystemImpactDocument(input.impact);
  if (impact.schemaVersion !== '2.0.0' || impact.propagation.state !== 'computed') {
    throw new Error('System impact report requires a computed P4.2 document.');
  }
  const overlay = impact.propagation.graphOverlays.find(({ side }) => side === input.side);
  if (overlay === undefined) {
    throw new Error(`System impact document has no ${input.side} graph overlay.`);
  }
  if (overlay.systemAnalysisId !== input.report.system.id) {
    throw new Error('System report and impact overlay refer to different system snapshots.');
  }
  return renderOfflineSystemReportInternal(input.report, cytoscapeSource, {
    impactId: impact.impactId,
    side: input.side,
    summary: impact.propagation.summary,
    overlay,
  });
}
