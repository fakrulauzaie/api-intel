import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fingerprintCiDistribution } from '../../../src/ci-adapter/distribution.js';

interface ProviderArtifactContract {
  readonly schemaVersion: string;
  readonly providers: Readonly<
    Record<
      string,
      {
        readonly directory: string;
        readonly requiredFiles: readonly string[];
        readonly chunkPattern: string;
      }
    >
  >;
  readonly metadataInputs: readonly string[];
  readonly container: {
    readonly runtimeUser: string;
    readonly runtimeValidation: string;
  };
  readonly browser: {
    readonly claimedBrowsers: readonly string[];
    readonly automatedContracts: readonly string[];
    readonly manualGate: string;
    readonly namedBrowserMatrix: string;
  };
}

interface ProviderArtifactManifest {
  readonly schemaVersion: string;
  readonly contractSha256: string;
  readonly providers: Readonly<
    Record<
      string,
      {
        readonly directory: string;
        readonly fileCount: number;
        readonly fingerprint: string;
        readonly files: readonly {
          readonly path: string;
          readonly bytes: number;
          readonly sha256: string;
        }[];
      }
    >
  >;
  readonly npmPackageManifest: {
    readonly path: string;
    readonly fileCount: number;
    readonly integrity: string;
  };
  readonly container: ProviderArtifactContract['container'];
  readonly browser: ProviderArtifactContract['browser'];
}

function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Phase O3.2 reproducible provider and package artifacts', () => {
  it('binds the complete checked distributions to one canonical byte ledger', async () => {
    const contractText = await readFile(
      resolve('packaging/release/provider-artifact-contract.json'),
      'utf8',
    );
    const contract = JSON.parse(contractText) as ProviderArtifactContract;
    const manifest = JSON.parse(
      await readFile(resolve('packaging/release/reproducible-artifacts.json'), 'utf8'),
    ) as ProviderArtifactManifest;

    expect(contract.schemaVersion).toBe('1.0.0');
    expect(manifest.schemaVersion).toBe('1.0.0');
    expect(manifest.contractSha256).toBe(sha256(contractText));
    for (const [name, provider] of Object.entries(contract.providers)) {
      const retained = manifest.providers[name];
      expect(retained).toBeDefined();
      expect(retained?.directory).toBe(provider.directory);
      expect(retained?.fileCount).toBe(retained?.files.length);
      expect(retained?.files.map(({ path }) => path)).toEqual(
        expect.arrayContaining([...provider.requiredFiles]),
      );
      expect(
        retained?.files.some(({ path }) => new RegExp(provider.chunkPattern, 'u').test(path)),
      ).toBe(true);
      for (const file of retained?.files ?? []) {
        const bytes = await readFile(resolve(provider.directory, file.path));
        expect(file.bytes, `${name}:${file.path}`).toBe(bytes.byteLength);
        expect(file.sha256, `${name}:${file.path}`).toBe(sha256(bytes));
      }
      expect(retained?.fingerprint).toBe(
        await fingerprintCiDistribution(resolve(provider.directory)),
      );
    }
  });

  it('verifies metadata, copied assets, an unprivileged image, and the canonical npm manifest', async () => {
    const [
      contractText,
      generatedText,
      distributionText,
      packageContentsText,
      dockerfile,
      action,
      component,
    ] = await Promise.all([
      readFile(resolve('packaging/release/provider-artifact-contract.json'), 'utf8'),
      readFile(resolve('packaging/release/reproducible-artifacts.json'), 'utf8'),
      readFile(resolve('packaging/npm/distribution-contract.json'), 'utf8'),
      readFile(resolve('packaging/npm/package-contents.json'), 'utf8'),
      readFile(resolve('packaging/gitlab/Dockerfile'), 'utf8'),
      readFile(resolve('action.yml'), 'utf8'),
      readFile(resolve('templates/api-intel/template.yml'), 'utf8'),
    ]);
    const contract = JSON.parse(contractText) as ProviderArtifactContract;
    const generated = JSON.parse(generatedText) as ProviderArtifactManifest;
    const distribution = JSON.parse(distributionText) as {
      readonly assets: readonly {
        readonly sourcePath: string;
        readonly sha256: string;
        readonly distributions: Readonly<
          Record<string, { readonly copiedPaths: readonly string[] }>
        >;
      }[];
    };
    const packageContents = JSON.parse(packageContentsText) as {
      readonly archive: { readonly fileCount: number; readonly integrity: string };
    };

    expect(contract.metadataInputs).toContain('action.yml');
    expect(contract.metadataInputs).toContain('packaging/gitlab/Dockerfile');
    expect(action).toContain('action-dist/index.js');
    expect(component).toContain('regex: ^.+@sha256:[a-f0-9]{64}$');
    expect(contract.container.runtimeUser).toBe('10001:10001');
    expect(dockerfile).toContain(`USER ${contract.container.runtimeUser}`);
    expect(generated.container).toEqual(contract.container);
    expect(generated.npmPackageManifest).toMatchObject({
      path: 'packaging/npm/package-contents.json',
      fileCount: packageContents.archive.fileCount,
      integrity: packageContents.archive.integrity,
    });
    for (const asset of distribution.assets) {
      const source = await readFile(resolve(asset.sourcePath));
      expect(sha256(source)).toBe(asset.sha256);
      for (const provider of ['githubAction', 'gitlab']) {
        expect(asset.distributions[provider]?.copiedPaths).toHaveLength(1);
        expect(await readFile(resolve(asset.distributions[provider]!.copiedPaths[0]!))).toEqual(
          source,
        );
      }
    }
  });

  it('keeps controlled execution, browser support, and provider-host claims honest', async () => {
    const [
      contractText,
      manifestText,
      packageText,
      workflow,
      expectedText,
      smoke,
      guide,
      boundary,
      plan,
    ] = await Promise.all([
      readFile(resolve('packaging/release/provider-artifact-contract.json'), 'utf8'),
      readFile(resolve('packaging/release/reproducible-artifacts.json'), 'utf8'),
      readFile(resolve('package.json'), 'utf8'),
      readFile(resolve('.github/workflows/ci.yml'), 'utf8'),
      readFile(resolve('test/fixtures/github-action/controlled/expected.json'), 'utf8'),
      readFile(resolve('scripts/test-controlled-github-action.mjs'), 'utf8'),
      readFile(resolve('docs/reproducible-release-artifacts.md'), 'utf8'),
      readFile(resolve('docs/public-release-boundary.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
    ]);
    const contract = JSON.parse(contractText) as ProviderArtifactContract;
    const manifest = JSON.parse(manifestText) as ProviderArtifactManifest;
    const packageJson = JSON.parse(packageText) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const expected = JSON.parse(expectedText) as {
      readonly actionImplementation: string;
      readonly targetContainsActionImplementation: boolean;
    };

    expect(packageJson.scripts).toMatchObject({
      'artifacts:check': 'node scripts/verify-provider-artifacts.mjs --check',
      'action:controlled-smoke': 'node scripts/test-controlled-github-action.mjs',
      'pack:clean-room:smoke':
        'npm run pack:contents:check && node scripts/verify-package-install.mjs --smoke',
    });
    for (const command of [
      'pnpm run artifacts:check',
      'pnpm run action:controlled-smoke',
      'pnpm run pack:clean-room:smoke',
      'docker image inspect api-intel-o3-2:candidate',
    ]) {
      expect(workflow).toContain(command);
    }
    expect(expected).toEqual(
      expect.objectContaining({
        actionImplementation: 'action-dist/index.js',
        targetContainsActionImplementation: false,
      }),
    );
    expect(smoke).toContain("resolve(repositoryRoot, 'action-dist/index.js')");
    expect(smoke).not.toContain('../src/github-action');
    expect(contract.browser.claimedBrowsers).toEqual([]);
    expect(contract.browser.automatedContracts).toHaveLength(6);
    expect(contract.browser.namedBrowserMatrix).toBe('unverified');
    expect(manifest.browser).toEqual(contract.browser);
    expect(guide).toContain('names **no supported browser matrix**');
    expect(guide).toContain('not GitLab-hosted component validation');
    expect(boundary).toContain('GitLab-hosted execution/catalog publication remains deferred.');
    expect(boundary).toContain('No real hosted comment mutation is claimed.');
    expect(plan).toMatch(
      /### Phase O3\.2[\s\S]*?Status: complete for the published npm and GitHub Action surfaces; container publication withheld/u,
    );
  });
});
