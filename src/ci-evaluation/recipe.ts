import { hashContent } from '../model/hashing.js';
import { canonicalStringify } from '../model/ordering.js';
import type { CiEvaluationDocument } from './model.js';
import { makeCiStableId } from './ordering.js';
import { assertValidCiEvaluationDocument } from './validate.js';
import type {
  CiBaselineAcquisition,
  CiCandidateAcquisition,
  CiDependencyInstallPlan,
  CiNodeRuntimePolicy,
  CiPackageManager,
  CiScanRecipeExpectation,
  CiScanRecipeManifest,
  CiTopologyProvenance,
} from './recipe-model.js';
import { ciDependencyInstallPlanSchema, ciScanRecipeManifestSchema } from './recipe-schemas.js';
import { CiEvaluationProcessError } from './evaluate.js';

export const DEFAULT_CI_NODE_POLICY: CiNodeRuntimePolicy = {
  declaredRange: '>=22.13 <25',
  minimum: { major: 22, minor: 13, patch: 0 },
  maximumMajorExclusive: 25,
};

export interface CreateCiScanRecipeInput {
  readonly evaluation: CiEvaluationDocument;
  readonly engineDistributionFingerprint: string;
  readonly nodePolicy?: CiNodeRuntimePolicy | undefined;
  readonly projectConfigurationPath: string;
  readonly projectConfigurationFingerprint: string;
  readonly topology: CiTopologyProvenance;
  readonly baselineAcquisition: CiBaselineAcquisition;
  readonly candidateAcquisition: CiCandidateAcquisition;
}

function expectedCommand(packageManager: CiPackageManager): readonly string[] {
  return packageManager === 'pnpm'
    ? ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile']
    : ['ci', '--ignore-scripts'];
}

export function createCiDependencyInstallPlan(input: {
  readonly packageManager: CiPackageManager;
  readonly packageManagerVersion: string;
  readonly lockfilePath: string;
  readonly lockfileFingerprint: string;
}): CiDependencyInstallPlan {
  return ciDependencyInstallPlanSchema.parse({
    ...input,
    command: {
      executable: input.packageManager,
      arguments: expectedCommand(input.packageManager),
    },
    lifecycleScripts: 'disabled',
    lockfileMode: 'immutable',
  });
}

function baselineCacheKey(input: {
  readonly baselineAnalysisFingerprint: string;
  readonly baselineRepositoryRevision: string | null;
  readonly engineDistributionFingerprint: string;
  readonly projectConfigurationFingerprint: string;
  readonly topology: CiTopologyProvenance;
  readonly baselineAcquisition: CiBaselineAcquisition;
}): string {
  return hashContent(
    canonicalStringify({
      baselineAnalysisFingerprint: input.baselineAnalysisFingerprint,
      baselineRepositoryRevision: input.baselineRepositoryRevision,
      baselineLockfileFingerprint: input.baselineAcquisition.dependencies.lockfileFingerprint,
      engineDistributionFingerprint: input.engineDistributionFingerprint,
      projectConfigurationFingerprint: input.projectConfigurationFingerprint,
      topology: input.topology,
    }),
  );
}

function identityInput(
  manifest: Omit<CiScanRecipeManifest, 'recipeId'>,
): Omit<CiScanRecipeManifest, 'recipeId'> {
  return manifest;
}

export function createCiScanRecipe(input: CreateCiScanRecipeInput): CiScanRecipeManifest {
  const evaluation = assertValidCiEvaluationDocument(input.evaluation);
  if (
    evaluation.provenance.baseline.repositoryRevision === null ||
    evaluation.provenance.candidate.repositoryRevision === null
  ) {
    throw new CiEvaluationProcessError(
      'incompatible_baseline',
      'Reproducible CI scans require baseline and candidate repository revisions.',
    );
  }
  const withoutId = {
    schemaVersion: '1.0.0',
    evaluationId: evaluation.evaluationId,
    engine: {
      name: evaluation.provenance.candidate.tool.name,
      version: evaluation.provenance.candidate.tool.version,
      distributionFingerprint: input.engineDistributionFingerprint,
      node: input.nodePolicy ?? DEFAULT_CI_NODE_POLICY,
    },
    projectConfiguration: {
      path: input.projectConfigurationPath,
      contentFingerprint: input.projectConfigurationFingerprint,
      effectiveAnalysisFingerprint: evaluation.provenance.candidate.configurationFingerprint,
    },
    topology: input.topology,
    baseline: {
      analysis: evaluation.provenance.baseline,
      acquisition: input.baselineAcquisition,
    },
    candidate: {
      analysis: evaluation.provenance.candidate,
      acquisition: input.candidateAcquisition,
    },
    baselineCache: {
      key: baselineCacheKey({
        baselineAnalysisFingerprint: evaluation.provenance.baseline.artifactFingerprint,
        baselineRepositoryRevision: evaluation.provenance.baseline.repositoryRevision,
        engineDistributionFingerprint: input.engineDistributionFingerprint,
        projectConfigurationFingerprint: input.projectConfigurationFingerprint,
        topology: input.topology,
        baselineAcquisition: input.baselineAcquisition,
      }),
      policy: 'trusted_writer_candidate_read_only',
    },
    trust: {
      baseline: 'trusted',
      candidate: 'untrusted',
      forkSecrets: 'none',
      candidateTokenPermission: 'read_only',
    },
  } satisfies Omit<CiScanRecipeManifest, 'recipeId'>;
  return assertValidCiScanRecipeManifest({
    ...withoutId,
    recipeId: makeCiStableId('ci_scan_recipe', identityInput(withoutId)),
  });
}

export const CI_SCAN_RECIPE_INTEGRITY_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'IDENTITY_MISMATCH',
  'PROVENANCE_MISMATCH',
  'WORKSPACE_NOT_ISOLATED',
  'CACHE_POLICY_INVALID',
] as const;
export type CiScanRecipeIntegrityIssueCode = (typeof CI_SCAN_RECIPE_INTEGRITY_ISSUE_CODES)[number];

export interface CiScanRecipeIntegrityIssue {
  readonly code: CiScanRecipeIntegrityIssueCode;
  readonly path: string;
  readonly message: string;
}

export type CiScanRecipeValidationResult =
  | { readonly success: true; readonly data: CiScanRecipeManifest }
  | { readonly success: false; readonly issues: readonly CiScanRecipeIntegrityIssue[] };

export function validateCiScanRecipeManifest(input: unknown): CiScanRecipeValidationResult {
  const parsed = ciScanRecipeManifestSchema.safeParse(input);
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
  const manifest = parsed.data;
  const issues: CiScanRecipeIntegrityIssue[] = [];
  const { recipeId, ...withoutId } = manifest;
  if (recipeId !== makeCiStableId('ci_scan_recipe', withoutId)) {
    issues.push({
      code: 'IDENTITY_MISMATCH',
      path: 'recipeId',
      message: 'Recipe ID does not match its canonical content.',
    });
  }
  if (
    manifest.projectConfiguration.effectiveAnalysisFingerprint !==
      manifest.baseline.analysis.configurationFingerprint ||
    manifest.projectConfiguration.effectiveAnalysisFingerprint !==
      manifest.candidate.analysis.configurationFingerprint ||
    manifest.engine.name !== manifest.baseline.analysis.tool.name ||
    manifest.engine.name !== manifest.candidate.analysis.tool.name ||
    manifest.engine.version !== manifest.baseline.analysis.tool.version ||
    manifest.engine.version !== manifest.candidate.analysis.tool.version ||
    manifest.baseline.analysis.repositoryRevision === null ||
    manifest.candidate.analysis.repositoryRevision === null
  ) {
    issues.push({
      code: 'PROVENANCE_MISMATCH',
      path: 'projectConfiguration',
      message:
        'Recipe engine, configuration, or repository provenance is incomplete or inconsistent.',
    });
  }
  if (
    manifest.baseline.acquisition.kind === 'isolated_scan' &&
    manifest.baseline.acquisition.workspaceIsolationKey ===
      manifest.candidate.acquisition.workspaceIsolationKey
  ) {
    issues.push({
      code: 'WORKSPACE_NOT_ISOLATED',
      path: 'candidate.acquisition.workspaceIsolationKey',
      message: 'Baseline and candidate scans must use distinct isolated workspaces.',
    });
  }
  const expectedCacheKey = baselineCacheKey({
    baselineAnalysisFingerprint: manifest.baseline.analysis.artifactFingerprint,
    baselineRepositoryRevision: manifest.baseline.analysis.repositoryRevision,
    engineDistributionFingerprint: manifest.engine.distributionFingerprint,
    projectConfigurationFingerprint: manifest.projectConfiguration.contentFingerprint,
    topology: manifest.topology,
    baselineAcquisition: manifest.baseline.acquisition,
  });
  if (manifest.baselineCache.key !== expectedCacheKey) {
    issues.push({
      code: 'CACHE_POLICY_INVALID',
      path: 'baselineCache.key',
      message: 'Baseline cache key is not derived exclusively from trusted immutable inputs.',
    });
  }
  return issues.length === 0
    ? { success: true, data: manifest }
    : { success: false, issues: issues.sort((left, right) => left.path.localeCompare(right.path)) };
}

export class CiScanRecipeIntegrityError extends Error {
  readonly issues: readonly CiScanRecipeIntegrityIssue[];

  constructor(issues: readonly CiScanRecipeIntegrityIssue[]) {
    super(`CI scan recipe integrity validation failed with ${issues.length} issue(s).`);
    this.name = 'CiScanRecipeIntegrityError';
    this.issues = issues;
  }
}

export function assertValidCiScanRecipeManifest(input: unknown): CiScanRecipeManifest {
  const result = validateCiScanRecipeManifest(input);
  if (!result.success) throw new CiScanRecipeIntegrityError(result.issues);
  return result.data;
}

/** Canonical byte representation for artifact storage and content-addressed transfer. */
export function serializeCiScanRecipeManifest(input: unknown): string {
  return canonicalStringify(assertValidCiScanRecipeManifest(input));
}

function parseNodeVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function nodeSatisfies(version: string, policy: CiNodeRuntimePolicy): boolean {
  const parsed = parseNodeVersion(version);
  if (parsed === null) return false;
  const [major, minor, patch] = parsed;
  if (major >= policy.maximumMajorExclusive || major < policy.minimum.major) return false;
  if (major > policy.minimum.major) return true;
  return (
    minor > policy.minimum.minor ||
    (minor === policy.minimum.minor && patch >= policy.minimum.patch)
  );
}

function sameTopology(left: CiTopologyProvenance, right: CiTopologyProvenance): boolean {
  return canonicalStringify(left) === canonicalStringify(right);
}

export function verifyCiScanRecipe(
  input: unknown,
  expectation: CiScanRecipeExpectation,
): CiScanRecipeManifest {
  let manifest: CiScanRecipeManifest;
  let evaluation: CiEvaluationDocument;
  try {
    manifest = assertValidCiScanRecipeManifest(input);
    evaluation = assertValidCiEvaluationDocument(expectation.evaluation);
  } catch (error) {
    throw new CiEvaluationProcessError('invalid_input', 'Invalid CI scan recipe manifest.', {
      cause: error,
    });
  }
  if (
    manifest.evaluationId !== evaluation.evaluationId ||
    canonicalStringify(manifest.baseline.analysis) !==
      canonicalStringify(evaluation.provenance.baseline) ||
    canonicalStringify(manifest.candidate.analysis) !==
      canonicalStringify(evaluation.provenance.candidate) ||
    manifest.baseline.analysis.repositoryRevision !== expectation.baselineRepositoryRevision ||
    manifest.candidate.analysis.repositoryRevision !== expectation.candidateRepositoryRevision ||
    manifest.engine.distributionFingerprint !== expectation.engineDistributionFingerprint ||
    manifest.projectConfiguration.contentFingerprint !==
      expectation.projectConfigurationFingerprint ||
    !sameTopology(manifest.topology, expectation.topology) ||
    canonicalStringify(manifest.baseline.acquisition.dependencies) !==
      canonicalStringify(expectation.baselineDependencies) ||
    canonicalStringify(manifest.candidate.acquisition.dependencies) !==
      canonicalStringify(expectation.candidateDependencies)
  ) {
    throw new CiEvaluationProcessError(
      'incompatible_baseline',
      'CI scan recipe does not match the expected revisions, configuration, or topology.',
    );
  }
  if (!nodeSatisfies(expectation.runtimeNodeVersion, manifest.engine.node)) {
    throw new CiEvaluationProcessError(
      'invalid_input',
      `Node ${expectation.runtimeNodeVersion} is outside the pinned ${manifest.engine.node.declaredRange} range.`,
    );
  }
  return manifest;
}
