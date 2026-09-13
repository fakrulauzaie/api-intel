import type { DiffDocument } from '../comparison/model.js';
import { serializeDiffDocument } from '../comparison/ordering.js';
import type { ImpactDocument } from '../impact/model.js';
import { serializeImpactDocument } from '../impact/ordering.js';
import type { AnalysisDocument, AnalysisResultState } from '../model/analysis.js';
import { hashContent } from '../model/hashing.js';
import { serializeCanonicalAnalysis } from '../model/ordering.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import { serializePolicyResults } from '../policy/ordering.js';
import type { SystemAnalysisDocument } from '../system-analysis/model.js';
import { serializeCanonicalSystemAnalysis } from '../system-analysis/ordering.js';
import type { SystemReportDocument } from '../system-report/model.js';
import { serializeCanonicalSystemReport } from '../system-report/ordering.js';
import type {
  QueryArtifactDescriptor,
  QueryArtifactKind,
  QueryArtifactResultState,
} from './model.js';

export type QueryArtifactInput =
  | { readonly name: string; readonly kind: 'analysis'; readonly document: AnalysisDocument }
  | { readonly name: string; readonly kind: 'comparison'; readonly document: DiffDocument }
  | { readonly name: string; readonly kind: 'impact'; readonly document: ImpactDocument }
  | { readonly name: string; readonly kind: 'policy'; readonly document: PolicyResultsDocument }
  | {
      readonly name: string;
      readonly kind: 'system_analysis';
      readonly document: SystemAnalysisDocument;
    }
  | {
      readonly name: string;
      readonly kind: 'system_report';
      readonly document: SystemReportDocument;
    };

function combinedResultState(states: readonly AnalysisResultState[]): QueryArtifactResultState {
  if (states.includes('failed')) return 'failed';
  if (states.includes('canceled')) return 'canceled';
  if (states.includes('completed_with_gaps')) return 'completed_with_gaps';
  return states.length === 0 ? 'not_declared' : 'completed';
}

function serializedArtifact(input: QueryArtifactInput): string {
  switch (input.kind) {
    case 'analysis':
      return serializeCanonicalAnalysis(input.document);
    case 'comparison':
      return serializeDiffDocument(input.document);
    case 'impact':
      return serializeImpactDocument(input.document);
    case 'policy':
      return serializePolicyResults(input.document);
    case 'system_analysis':
      return serializeCanonicalSystemAnalysis(input.document);
    case 'system_report':
      return serializeCanonicalSystemReport(input.document);
  }
}

function canonicalDocumentId(input: QueryArtifactInput): string | null {
  switch (input.kind) {
    case 'analysis':
      return input.document.analysisRun.id;
    case 'system_analysis':
      return input.document.systemId;
    case 'system_report':
      return input.document.reportId;
    case 'comparison':
    case 'impact':
    case 'policy':
      return null;
  }
}

function artifactResultState(input: QueryArtifactInput): QueryArtifactResultState {
  switch (input.kind) {
    case 'analysis':
      return input.document.resultState;
    case 'comparison':
    case 'impact':
      return combinedResultState([
        input.document.before.resultState,
        input.document.after.resultState,
      ]);
    case 'policy':
      return combinedResultState([
        input.document.analysis.resultState,
        ...(input.document.baseline === null ? [] : [input.document.baseline.resultState]),
      ]);
    case 'system_analysis':
      return combinedResultState(
        input.document.services.map(({ analysisResultState }) => analysisResultState),
      );
    case 'system_report':
      return 'not_declared';
  }
}

export function describeQueryArtifact(input: QueryArtifactInput): QueryArtifactDescriptor {
  const digest = hashContent(`${input.kind}\n${serializedArtifact(input)}`).slice('sha256:'.length);
  return {
    name: input.name,
    kind: input.kind,
    documentId: `query_document:${digest}`,
    canonicalDocumentId: canonicalDocumentId(input),
    schemaVersion: input.document.schemaVersion,
    resultState: artifactResultState(input),
  };
}

export function queryArtifactKind(input: QueryArtifactInput): QueryArtifactKind {
  return input.kind;
}
