export const GITLAB_CI_ADAPTER_VERSION = '1.0.0' as const;
export const GITLAB_CI_ARTIFACT_SCHEMA_VERSION = '1.0.0' as const;
export const GITLAB_CI_MAX_FINDINGS = 500;
export const GITLAB_CI_MAX_SUMMARY_BYTES = 65_536;

export const GITLAB_CODE_QUALITY_SEVERITIES = [
  'info',
  'minor',
  'major',
  'critical',
  'blocker',
] as const;
export type GitLabCodeQualitySeverity = (typeof GITLAB_CODE_QUALITY_SEVERITIES)[number];

export interface GitLabCodeQualityFinding {
  readonly description: string;
  readonly check_name: string;
  readonly fingerprint: string;
  readonly severity: GitLabCodeQualitySeverity;
  readonly location: {
    readonly path: string;
    readonly lines: { readonly begin: number };
  };
}

export interface GitLabCiProjection {
  readonly adapterVersion: typeof GITLAB_CI_ADAPTER_VERSION;
  readonly executionImage: string;
  readonly evaluationId: string;
  readonly outcome: 'success' | 'policy_violation';
  readonly summaryMarkdown: string;
  readonly findings: readonly GitLabCodeQualityFinding[];
  readonly findingCount: number;
  readonly omittedFindingCount: number;
}

export interface GitLabCiArtifactManifest {
  readonly schemaVersion: typeof GITLAB_CI_ARTIFACT_SCHEMA_VERSION;
  readonly adapterVersion: typeof GITLAB_CI_ADAPTER_VERSION;
  readonly executionImage: string;
  readonly evaluationId: string;
  readonly outcome: 'success' | 'policy_violation';
  readonly codeQuality: { readonly published: number; readonly omitted: number };
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly contentHash: string;
  }[];
}
