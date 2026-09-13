import type { CiAnalysisProvenance, CiEvaluationDocument } from './model.js';

export const CI_SCAN_RECIPE_SCHEMA_VERSION = '1.0.0' as const;
export const CI_PACKAGE_MANAGERS = ['pnpm', 'npm'] as const;
export type CiPackageManager = (typeof CI_PACKAGE_MANAGERS)[number];

export interface CiDependencyInstallPlan {
  readonly packageManager: CiPackageManager;
  readonly packageManagerVersion: string;
  readonly lockfilePath: string;
  readonly lockfileFingerprint: string;
  readonly command: {
    readonly executable: CiPackageManager;
    readonly arguments: readonly string[];
  };
  readonly lifecycleScripts: 'disabled';
  readonly lockfileMode: 'immutable';
}

export type CiTopologyProvenance =
  | { readonly state: 'not_applicable'; readonly fingerprint: null }
  | { readonly state: 'supplied'; readonly fingerprint: string };

export type CiBaselineAcquisition =
  | {
      readonly kind: 'isolated_scan';
      readonly workspaceIsolationKey: string;
      readonly dependencies: CiDependencyInstallPlan;
    }
  | {
      readonly kind: 'trusted_artifact';
      readonly workspaceIsolationKey: null;
      /** Immutable dependency provenance recorded when the trusted artifact was produced. */
      readonly dependencies: CiDependencyInstallPlan;
    };

export interface CiCandidateAcquisition {
  readonly kind: 'isolated_scan';
  readonly workspaceIsolationKey: string;
  readonly dependencies: CiDependencyInstallPlan;
}

export interface CiNodeRuntimePolicy {
  readonly declaredRange: string;
  readonly minimum: {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
  };
  readonly maximumMajorExclusive: number;
}

export interface CiScanRecipeManifest {
  readonly schemaVersion: typeof CI_SCAN_RECIPE_SCHEMA_VERSION;
  readonly recipeId: string;
  readonly evaluationId: string;
  readonly engine: {
    readonly name: string;
    readonly version: string;
    readonly distributionFingerprint: string;
    readonly node: CiNodeRuntimePolicy;
  };
  readonly projectConfiguration: {
    readonly path: string;
    readonly contentFingerprint: string;
    readonly effectiveAnalysisFingerprint: string;
  };
  readonly topology: CiTopologyProvenance;
  readonly baseline: {
    readonly analysis: CiAnalysisProvenance;
    readonly acquisition: CiBaselineAcquisition;
  };
  readonly candidate: {
    readonly analysis: CiAnalysisProvenance;
    readonly acquisition: CiCandidateAcquisition;
  };
  readonly baselineCache: {
    readonly key: string;
    readonly policy: 'trusted_writer_candidate_read_only';
  };
  readonly trust: {
    readonly baseline: 'trusted';
    readonly candidate: 'untrusted';
    readonly forkSecrets: 'none';
    readonly candidateTokenPermission: 'read_only';
  };
}

export interface CiScanRecipeExpectation {
  readonly evaluation: CiEvaluationDocument;
  readonly baselineRepositoryRevision: string;
  readonly candidateRepositoryRevision: string;
  readonly engineDistributionFingerprint: string;
  readonly projectConfigurationFingerprint: string;
  readonly topology: CiTopologyProvenance;
  readonly baselineDependencies: CiDependencyInstallPlan;
  readonly candidateDependencies: CiDependencyInstallPlan;
  readonly runtimeNodeVersion: string;
}
