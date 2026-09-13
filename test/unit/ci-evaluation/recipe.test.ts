import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareAnalysisDocuments } from '../../../src/comparison/compare.js';
import {
  CiEvaluationProcessError,
  createCiDependencyInstallPlan,
  createCiScanRecipe,
  evaluateCiArtifacts,
  serializeCiScanRecipeManifest,
  validateCiScanRecipeManifest,
  verifyCiScanRecipe,
  type CiScanRecipeExpectation,
} from '../../../src/ci-evaluation/index.js';
import { analyzePotentialImpact } from '../../../src/impact/analyze.js';
import { hashContent } from '../../../src/model/hashing.js';
import { normalizePolicyConfiguration } from '../../../src/policy/config.js';
import { evaluatePolicies } from '../../../src/policy/evaluate.js';
import { createComparisonAnalysisSnapshot } from '../../helpers/comparison-analysis.js';

function fixture() {
  const baseline = createComparisonAnalysisSnapshot('before');
  const candidate = createComparisonAnalysisSnapshot('after');
  const comparison = compareAnalysisDocuments(baseline, candidate);
  const impact = analyzePotentialImpact(baseline, candidate);
  const policyResults = evaluatePolicies({
    analysis: candidate,
    baseline,
    configuration: normalizePolicyConfiguration({
      version: 1,
      rules: { 'no-new-diagnostics': 'warn' },
    }),
  });
  const evaluation = evaluateCiArtifacts({
    baseline,
    candidate,
    comparison,
    impact,
    policyResults,
  });
  const baselineDependencies = createCiDependencyInstallPlan({
    packageManager: 'pnpm',
    packageManagerVersion: '11.19.0',
    lockfilePath: 'pnpm-lock.yaml',
    lockfileFingerprint: hashContent('baseline lockfile'),
  });
  const candidateDependencies = createCiDependencyInstallPlan({
    packageManager: 'npm',
    packageManagerVersion: '11.6.0',
    lockfilePath: 'package-lock.json',
    lockfileFingerprint: hashContent('candidate lockfile'),
  });
  const topology = { state: 'not_applicable', fingerprint: null } as const;
  const engineDistributionFingerprint = hashContent('api-intel distribution');
  const projectConfigurationFingerprint = hashContent('trusted api-intel.config.json');
  const manifest = createCiScanRecipe({
    evaluation,
    engineDistributionFingerprint,
    projectConfigurationPath: 'ci/api-intel.config.json',
    projectConfigurationFingerprint,
    topology,
    baselineAcquisition: {
      kind: 'isolated_scan',
      workspaceIsolationKey: 'trusted-baseline-workspace',
      dependencies: baselineDependencies,
    },
    candidateAcquisition: {
      kind: 'isolated_scan',
      workspaceIsolationKey: 'untrusted-candidate-workspace',
      dependencies: candidateDependencies,
    },
  });
  const expectation: CiScanRecipeExpectation = {
    evaluation,
    baselineRepositoryRevision: 'phase13-before',
    candidateRepositoryRevision: 'phase13-after',
    engineDistributionFingerprint,
    projectConfigurationFingerprint,
    topology,
    baselineDependencies,
    candidateDependencies,
    runtimeNodeVersion: '22.13.0',
  };
  return { manifest, expectation, evaluation, candidateDependencies };
}

function expectOutcome(run: () => unknown, outcome: CiEvaluationProcessError['outcome']): void {
  try {
    run();
    throw new Error('Expected recipe verification to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(CiEvaluationProcessError);
    expect((error as CiEvaluationProcessError).outcome).toBe(outcome);
  }
}

describe('Phase P2.2 reproducible scan recipe and Gate CK0', () => {
  it('freezes immutable no-lifecycle-script installs for supported lockfiles', async () => {
    const expected = JSON.parse(
      await readFile(resolve('test/fixtures/ci-evaluation/ck0.expected.json'), 'utf8'),
    ) as { packageManagers: Record<string, string[]> };
    const pnpm = createCiDependencyInstallPlan({
      packageManager: 'pnpm',
      packageManagerVersion: '11.19.0',
      lockfilePath: 'pnpm-lock.yaml',
      lockfileFingerprint: hashContent('pnpm lock'),
    });
    const npm = createCiDependencyInstallPlan({
      packageManager: 'npm',
      packageManagerVersion: '11.6.0',
      lockfilePath: 'package-lock.json',
      lockfileFingerprint: hashContent('npm lock'),
    });
    expect(pnpm.command.arguments).toEqual(expected.packageManagers.pnpm);
    expect(npm.command.arguments).toEqual(expected.packageManagers.npm);
    expect([pnpm, npm].every(({ lifecycleScripts }) => lifecycleScripts === 'disabled')).toBe(true);
    expect([pnpm, npm].every(({ lockfileMode }) => lockfileMode === 'immutable')).toBe(true);

    for (const invalid of [
      { ...pnpm, packageManagerVersion: 'latest' },
      { ...pnpm, lockfilePath: 'package-lock.json' },
      { ...npm, lockfilePath: 'pnpm-lock.yaml' },
    ]) {
      expect(() => createCiDependencyInstallPlan(invalid)).toThrow();
    }
  });

  it('creates and verifies a content-addressed isolated-scan manifest', () => {
    const { manifest, expectation } = fixture();
    expect(validateCiScanRecipeManifest(manifest)).toEqual({ success: true, data: manifest });
    expect(verifyCiScanRecipe(manifest, expectation)).toEqual(manifest);
    expect(manifest.recipeId).toMatch(/^ci_scan_recipe:[a-f0-9]{32}$/);
    expect(manifest.baselineCache.policy).toBe('trusted_writer_candidate_read_only');
    expect(manifest.trust).toEqual({
      baseline: 'trusted',
      candidate: 'untrusted',
      forkSecrets: 'none',
      candidateTokenPermission: 'read_only',
    });
  });

  it('supports a trusted baseline artifact without pretending it was scanned', () => {
    const { evaluation, expectation, candidateDependencies } = fixture();
    const manifest = createCiScanRecipe({
      evaluation,
      engineDistributionFingerprint: expectation.engineDistributionFingerprint,
      projectConfigurationPath: 'ci/api-intel.config.json',
      projectConfigurationFingerprint: expectation.projectConfigurationFingerprint,
      topology: expectation.topology,
      baselineAcquisition: {
        kind: 'trusted_artifact',
        workspaceIsolationKey: null,
        dependencies: expectation.baselineDependencies,
      },
      candidateAcquisition: {
        kind: 'isolated_scan',
        workspaceIsolationKey: 'untrusted-candidate-workspace',
        dependencies: candidateDependencies,
      },
    });
    expect(verifyCiScanRecipe(manifest, expectation).baseline.acquisition).toEqual({
      kind: 'trusted_artifact',
      workspaceIsolationKey: null,
      dependencies: expectation.baselineDependencies,
    });
  });

  it('rejects stale revisions, configuration, topology, distribution, and lockfiles', () => {
    const { manifest, expectation } = fixture();
    for (const changed of [
      { ...expectation, baselineRepositoryRevision: 'stale-baseline' },
      { ...expectation, projectConfigurationFingerprint: hashContent('different config') },
      {
        ...expectation,
        topology: { state: 'supplied', fingerprint: hashContent('topology') } as const,
      },
      { ...expectation, engineDistributionFingerprint: hashContent('different distribution') },
      {
        ...expectation,
        candidateDependencies: {
          ...expectation.candidateDependencies,
          lockfileFingerprint: hashContent('different lockfile'),
        },
      },
    ]) {
      expectOutcome(() => verifyCiScanRecipe(manifest, changed), 'incompatible_baseline');
    }
  });

  it('rejects unsafe commands, shared workspaces, cache tampering, and unsupported Node', () => {
    const { manifest, expectation } = fixture();
    expectOutcome(
      () =>
        verifyCiScanRecipe(
          {
            ...manifest,
            candidate: {
              ...manifest.candidate,
              acquisition: {
                ...manifest.candidate.acquisition,
                dependencies: {
                  ...manifest.candidate.acquisition.dependencies,
                  command: { executable: 'npm', arguments: ['install'] },
                },
              },
            },
          },
          expectation,
        ),
      'invalid_input',
    );
    for (const tampered of [
      {
        ...manifest,
        candidate: {
          ...manifest.candidate,
          acquisition: {
            ...manifest.candidate.acquisition,
            workspaceIsolationKey:
              manifest.baseline.acquisition.kind === 'isolated_scan'
                ? manifest.baseline.acquisition.workspaceIsolationKey
                : 'baseline',
          },
        },
      },
      {
        ...manifest,
        baselineCache: { ...manifest.baselineCache, key: hashContent('attacker key') },
      },
    ]) {
      expect(validateCiScanRecipeManifest(tampered).success).toBe(false);
    }
    expectOutcome(
      () => verifyCiScanRecipe(manifest, { ...expectation, runtimeNodeVersion: '25.0.0' }),
      'invalid_input',
    );
  });

  it('keeps the trusted baseline cache key independent of untrusted candidate inputs', () => {
    const { manifest, expectation, evaluation } = fixture();
    const alternateCandidate = createCiDependencyInstallPlan({
      ...expectation.candidateDependencies,
      lockfileFingerprint: hashContent('alternate candidate lockfile'),
    });
    const second = createCiScanRecipe({
      evaluation,
      engineDistributionFingerprint: expectation.engineDistributionFingerprint,
      projectConfigurationPath: 'ci/api-intel.config.json',
      projectConfigurationFingerprint: expectation.projectConfigurationFingerprint,
      topology: expectation.topology,
      baselineAcquisition: manifest.baseline.acquisition,
      candidateAcquisition: {
        kind: 'isolated_scan',
        workspaceIsolationKey: 'another-candidate-workspace',
        dependencies: alternateCandidate,
      },
    });
    expect(second.baselineCache.key).toBe(manifest.baselineCache.key);
    expect(second.recipeId).not.toBe(manifest.recipeId);
  });

  it('serializes validated manifests to stable canonical bytes', () => {
    const { manifest } = fixture();
    const serialized = serializeCiScanRecipeManifest(manifest);
    expect(serializeCiScanRecipeManifest(JSON.parse(serialized))).toBe(serialized);
  });

  it('rejects a display-only Node range that disagrees with its structured policy', () => {
    const { manifest } = fixture();
    expect(
      validateCiScanRecipeManifest({
        ...manifest,
        engine: {
          ...manifest.engine,
          node: { ...manifest.engine.node, declaredRange: '>=18 <99' },
        },
      }).success,
    ).toBe(false);
  });

  it('contains no checkout, install execution, filesystem, network, or provider adapter', async () => {
    const source = await readFile(resolve('src/ci-evaluation/recipe.ts'), 'utf8');
    for (const forbidden of [
      'node:child_process',
      'node:fs',
      'node:http',
      'node:https',
      'simple-git',
      'octokit',
      'gitbeaker',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
