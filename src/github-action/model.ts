export const GITHUB_ACTION_ADAPTER_VERSION = '1.0.0' as const;
export const GITHUB_ACTION_ARTIFACT_SCHEMA_VERSION = '1.0.0' as const;
export const GITHUB_ACTION_MAX_ANNOTATIONS = 50;
export const GITHUB_ACTION_MAX_SUMMARY_BYTES = 65_536;
export const GITHUB_ACTION_MAX_INPUT_BYTES = 64 * 1024 * 1024;

export const GITHUB_ANNOTATION_LEVELS = ['notice', 'warning', 'error'] as const;
export type GitHubAnnotationLevel = (typeof GITHUB_ANNOTATION_LEVELS)[number];

export interface GitHubAnnotationProjection {
  readonly level: GitHubAnnotationLevel;
  readonly title: string;
  readonly message: string;
  readonly path: string | null;
  readonly startLine: number | null;
  readonly endLine: number | null;
  readonly startColumn: number | null;
  readonly endColumn: number | null;
  readonly sourceAnnotationId: string;
}

export interface GitHubCiProjection {
  readonly adapterVersion: typeof GITHUB_ACTION_ADAPTER_VERSION;
  readonly evaluationId: string;
  readonly outcome: 'success' | 'policy_violation';
  readonly summaryMarkdown: string;
  readonly annotations: readonly GitHubAnnotationProjection[];
  readonly annotationCount: number;
  readonly omittedAnnotationCount: number;
}

export interface GitHubActionArtifactManifest {
  readonly schemaVersion: typeof GITHUB_ACTION_ARTIFACT_SCHEMA_VERSION;
  readonly adapterVersion: typeof GITHUB_ACTION_ADAPTER_VERSION;
  readonly evaluationId: string;
  readonly outcome: 'success' | 'policy_violation';
  readonly annotations: { readonly published: number; readonly omitted: number };
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly contentHash: string;
  }[];
}
