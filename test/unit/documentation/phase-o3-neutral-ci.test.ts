import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface NeutralCiContract {
  readonly schemaVersion: string;
  readonly workflow: string;
  readonly packageManager: {
    readonly name: string;
    readonly version: string;
    readonly lockfile: string;
    readonly frozen: boolean;
  };
  readonly matrix: readonly { readonly os: string; readonly node: string }[];
  readonly macosStatus: string;
  readonly actions: Readonly<Record<string, string>>;
  readonly limits: {
    readonly timeoutMinutes: number;
    readonly maximumParallelMatrixJobs: number;
    readonly maximumTestWorkers: number;
    readonly nodeHeapMegabytes: number;
    readonly coverageRetentionDays: number;
  };
  readonly trust: {
    readonly permissions: string;
    readonly persistCheckoutCredentials: boolean;
    readonly candidateSecretsReferenced: boolean;
    readonly dependencyCacheEnabled: boolean;
    readonly rootLifecyclePolicy: string;
    readonly fixtureLifecycleScriptsExecuted: boolean;
    readonly usesProductActionUnderTest: boolean;
  };
  readonly compatibilityCorpus: {
    readonly root: string;
    readonly lockfile: string;
    readonly installer: string;
    readonly packages: Readonly<Record<string, string>>;
    readonly expectedAnalysis: {
      readonly schemaVersion: string;
      readonly resultState: string;
      readonly endpoints: number;
      readonly assertions: number;
      readonly diagnostics: readonly string[];
    };
    readonly targetApplicationExecuted: boolean;
  };
  readonly coverage: {
    readonly provider: string;
    readonly scope: string;
    readonly maximumWorkers: number;
    readonly thresholds: null;
    readonly status: string;
  };
}

describe('Phase O3.1 neutral repository CI', () => {
  it('freezes a read-only four-cell source matrix without product-action recursion', async () => {
    const contract = JSON.parse(
      await readFile(resolve('packaging/ci/neutral-ci-contract.json'), 'utf8'),
    ) as NeutralCiContract;
    const workflow = await readFile(resolve(contract.workflow), 'utf8');

    expect(contract).toMatchObject({
      schemaVersion: '1.0.0',
      packageManager: {
        name: 'pnpm',
        version: '11.19.0',
        lockfile: 'pnpm-lock.yaml',
        frozen: true,
      },
      matrix: [
        { os: 'ubuntu-24.04', node: '22.13.1' },
        { os: 'ubuntu-24.04', node: '24.20.0' },
        { os: 'windows-2025', node: '22.13.1' },
        { os: 'windows-2025', node: '24.20.0' },
      ],
      macosStatus: 'unverified_not_in_matrix',
      trust: {
        permissions: 'contents_read_only',
        persistCheckoutCredentials: false,
        candidateSecretsReferenced: false,
        dependencyCacheEnabled: false,
        fixtureLifecycleScriptsExecuted: false,
        usesProductActionUnderTest: false,
      },
      coverage: {
        provider: 'v8',
        scope: 'src/**/*.ts',
        maximumWorkers: 1,
        thresholds: null,
        status: 'measurement_only',
      },
    });
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('package-manager-cache: false');
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain(`max-parallel: ${contract.limits.maximumParallelMatrixJobs}`);
    expect(contract.limits.maximumTestWorkers).toBe(2);
    expect(workflow).toContain(`timeout-minutes: ${contract.limits.timeoutMinutes}`);
    expect(workflow).toContain(
      `NODE_OPTIONS: --max-old-space-size=${contract.limits.nodeHeapMegabytes}`,
    );
    expect(workflow).not.toMatch(/pull_request_target:|secrets\.|permissions:[\s\S]*?write/u);
    expect(workflow).not.toMatch(/uses:\s+(?:\.\/|OWNER\/|fakrulauzaie\/)/u);
    expect(workflow).not.toContain('macos-');
    for (const reference of Object.values(contract.actions)) {
      expect(reference).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/u);
      expect(workflow).toContain(`uses: ${reference}`);
    }
    for (const cell of contract.matrix) {
      expect(workflow).toContain(`- ${cell.os}`);
      expect(workflow).toContain(`- ${cell.node}`);
    }
  });

  it('runs the complete quality boundary with constrained dependency execution', async () => {
    const [manifestText, workflow, workspace, vitest, attributes] = await Promise.all([
      readFile(resolve('package.json'), 'utf8'),
      readFile(resolve('.github/workflows/ci.yml'), 'utf8'),
      readFile(resolve('pnpm-workspace.yaml'), 'utf8'),
      readFile(resolve('vitest.config.ts'), 'utf8'),
      readFile(resolve('.gitattributes'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as {
      readonly scripts: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
    };

    expect(workflow).toContain('npm install --global pnpm@11.19.0 --ignore-scripts');
    expect(workflow).toContain('pnpm install --frozen-lockfile');
    expect(workflow).toContain('npm ci --ignore-scripts --no-audit --no-fund');
    expect(workflow).toMatch(
      /coverage-observation:[\s\S]*?Build production output for runtime-dependent tests[\s\S]*?pnpm run build[\s\S]*?Measure coverage without enforcing a threshold[\s\S]*?pnpm run test:coverage/u,
    );
    for (const command of [
      'pnpm run format:check',
      'pnpm run lint',
      'pnpm run typecheck',
      'pnpm run build',
      'pnpm run schema:check',
      'pnpm run compatibility:check',
      'pnpm run test',
    ]) {
      expect(workflow).toContain(command);
    }
    expect(workspace).toMatch(/allowBuilds:[\s\S]*?esbuild: true/u);
    expect(manifest.scripts).toMatchObject({
      'compatibility:check': 'node scripts/verify-compatibility-corpus.mjs',
      'schema:check': 'node scripts/verify-config-schema.mjs',
      'test:coverage':
        'vitest run --configLoader runner --coverage --maxWorkers=1 --testTimeout=60000',
    });
    expect(manifest.devDependencies['@vitest/coverage-v8']).toBe('4.1.11');
    expect(vitest).toContain("provider: 'v8'");
    expect(vitest).toContain("include: ['src/**/*.ts']");
    expect(vitest).toContain('maxWorkers: 2');
    expect(vitest).toContain('testTimeout: 60_000');
    expect(vitest).not.toMatch(/thresholds\s*:/u);
    expect(attributes).toContain('* text=auto eol=lf');
    expect(attributes).toContain('*.wasm binary');
  });

  it('pins one real-package corpus without generalizing declaration fixtures', async () => {
    const [
      contractText,
      lockText,
      gitignore,
      verifier,
      guide,
      compatibility,
      boundary,
      index,
      plan,
    ] = await Promise.all([
      readFile(resolve('packaging/ci/neutral-ci-contract.json'), 'utf8'),
      readFile(resolve('example-nestjs-app/package-lock.json'), 'utf8'),
      readFile(resolve('.gitignore'), 'utf8'),
      readFile(resolve('scripts/verify-compatibility-corpus.mjs'), 'utf8'),
      readFile(resolve('docs/neutral-repository-ci.md'), 'utf8'),
      readFile(resolve('docs/compatibility-and-support.md'), 'utf8'),
      readFile(resolve('docs/public-release-boundary.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
    ]);
    const contract = JSON.parse(contractText) as NeutralCiContract;
    const lockfile = JSON.parse(lockText) as {
      readonly packages: Readonly<Record<string, { readonly version: string }>>;
    };

    expect(contract.compatibilityCorpus).toMatchObject({
      root: 'example-nestjs-app',
      lockfile: 'example-nestjs-app/package-lock.json',
      installer: 'npm ci --ignore-scripts --no-audit --no-fund',
      expectedAnalysis: {
        schemaVersion: '8.0.0',
        resultState: 'completed_with_gaps',
        endpoints: 7,
        assertions: 70,
      },
      targetApplicationExecuted: false,
    });
    for (const [name, version] of Object.entries(contract.compatibilityCorpus.packages)) {
      expect(lockfile.packages[`node_modules/${name}`]?.version).toBe(version);
    }
    expect(gitignore).toContain('!example-nestjs-app/package-lock.json');
    expect(contract.compatibilityCorpus.expectedAnalysis.diagnostics).toHaveLength(7);
    expect(verifier).toContain("'dist/cli/index.js'");
    expect(verifier).toContain("'--no-config'");
    expect(guide).toContain('public hosted qualification active');
    expect(guide).toMatch(/Generated\s+declaration stubs continue to prove extractor semantics/u);
    expect(compatibility).toContain('exact release commit passed the four-cell');
    expect(boundary).toContain('Exact release commit passed all four hosted source cells');
    expect(index).toContain('[Neutral repository CI]');
    expect(plan).toMatch(
      /### Phase O3\.1[\s\S]*?Status: complete for exact release commit; hosted four-cell matrix passed/u,
    );
  });
});
