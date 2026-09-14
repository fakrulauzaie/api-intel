import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PublishedAlphaContract {
  readonly schemaVersion: string;
  readonly source: {
    readonly repository: string;
    readonly commit: string;
    readonly tag: string;
    readonly release: string;
  };
  readonly npm: {
    readonly packageSpec: string;
    readonly intendedDistTag: string;
    readonly bootstrapLatestRequired: boolean;
    readonly sha256: string;
    readonly fileCount: number;
  };
  readonly githubAction: {
    readonly reference: string;
    readonly distributionFingerprint: string;
    readonly event: string;
  };
  readonly maintainedPackageMatrix: readonly {
    readonly runner: string;
    readonly node: string;
  }[];
  readonly publishedSurfaces: Readonly<Record<string, boolean>>;
}

describe('Phase O5.3 published artifact verification', () => {
  it('binds the npm package, GitHub release, and Action to immutable reviewed identities', async () => {
    const contract = JSON.parse(
      await readFile(resolve('packaging/release/published-alpha-contract.json'), 'utf8'),
    ) as PublishedAlphaContract;

    expect(contract).toMatchObject({
      schemaVersion: '1.0.0',
      source: {
        repository: 'https://github.com/fakrulauzaie/api-intel',
        commit: '641d830176f9ba36875392edd5c419da9d5e01b1',
        tag: 'v0.1.0-alpha.1',
      },
      npm: {
        packageSpec: '@fakrulauzaie/api-intel@0.1.0-alpha.1',
        intendedDistTag: 'alpha',
        bootstrapLatestRequired: true,
        fileCount: 271,
      },
      githubAction: {
        reference: 'fakrulauzaie/api-intel@641d830176f9ba36875392edd5c419da9d5e01b1',
        event: 'pull_request',
      },
    });
    expect(contract.npm.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(contract.githubAction.distributionFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(contract.source.release).toContain(contract.source.tag);
    expect(contract.publishedSurfaces).toEqual({
      npmPackage: true,
      githubRelease: true,
      githubAction: true,
      gitlabComponent: false,
      ociImage: false,
      privilegedCommentPublisher: false,
    });
  });

  it('runs the exact registry package through the four maintained clean-room cells', async () => {
    const [contractText, workflow, packageVerifier, releaseVerifier, manifestText] =
      await Promise.all([
        readFile(resolve('packaging/release/published-alpha-contract.json'), 'utf8'),
        readFile(resolve('.github/workflows/published-release-verification.yml'), 'utf8'),
        readFile(resolve('scripts/verify-package-install.mjs'), 'utf8'),
        readFile(resolve('scripts/verify-published-release.mjs'), 'utf8'),
        readFile(resolve('package.json'), 'utf8'),
      ]);
    const contract = JSON.parse(contractText) as PublishedAlphaContract;
    const manifest = JSON.parse(manifestText) as {
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(contract.maintainedPackageMatrix).toEqual([
      { runner: 'ubuntu-24.04', node: '22.13.1' },
      { runner: 'ubuntu-24.04', node: '24.20.0' },
      { runner: 'windows-2025', node: '22.13.1' },
      { runner: 'windows-2025', node: '24.20.0' },
    ]);
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('pnpm install --frozen-lockfile --ignore-scripts');
    expect(workflow).toContain('node scripts/verify-published-release.mjs');
    expect(workflow).not.toMatch(
      /pull_request_target:|permissions:[\s\S]*?write|GITHUB_TOKEN:|github\.token/u,
    );
    for (const cell of contract.maintainedPackageMatrix) {
      expect(workflow).toContain(`- ${cell.runner}`);
      expect(workflow).toContain(`- ${cell.node}`);
    }
    expect(packageVerifier).toContain("'--package-spec'");
    expect(packageVerifier).toContain("'--expected-sha256'");
    expect(packageVerifier).toContain("kind: 'npm_registry'");
    expect(releaseVerifier).toContain('verifyNpmMetadata');
    expect(releaseVerifier).toContain('verifyGitHubMetadata');
    expect(releaseVerifier).toContain('delete cleanEnvironment.GITHUB_TOKEN');
    expect(manifest.scripts['release:published:smoke']).toBeUndefined();
  });

  it('executes the published full-SHA Action against isolated synthetic pull-request targets', async () => {
    const [contractText, workflow, targetBuilder, resultVerifier, guide, plan] = await Promise.all([
      readFile(resolve('packaging/release/published-alpha-contract.json'), 'utf8'),
      readFile(resolve('.github/workflows/published-release-verification.yml'), 'utf8'),
      readFile(resolve('scripts/prepare-published-action-targets.mjs'), 'utf8'),
      readFile(resolve('scripts/verify-published-action-result.mjs'), 'utf8'),
      readFile(resolve('docs/published-release-verification.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
    ]);
    const contract = JSON.parse(contractText) as PublishedAlphaContract;

    expect(workflow).toContain(`uses: ${contract.githubAction.reference}`);
    expect(workflow).toContain("github.event_name == 'pull_request'");
    expect(workflow).toContain('baseline-package-manager: npm');
    expect(workflow).toContain('candidate-package-manager: npm');
    expect(targetBuilder).toContain("'.api-intel-published-action-targets'");
    expect(targetBuilder).toContain("createTarget('baseline', 'baseline.ts.txt')");
    expect(targetBuilder).toContain("createTarget('candidate', 'candidate.ts.txt')");
    expect(targetBuilder).toContain('preserveSymlinks: true');
    expect(resultVerifier).toContain('distributionFingerprint');
    expect(resultVerifier).toContain('manifest.files');
    expect(resultVerifier).toContain('api-intel-graph.html');
    expect(guide).toContain('Non-destructive rollback drill');
    expect(guide).toContain('must not unpublish it');
    expect(guide).toContain('actions/runs/34835680659');
    expect(plan).toMatch(/### Phase O5\.3[\s\S]*?Status: complete/u);
  });

  it('resolves every local link in the public Markdown surface', async () => {
    const rootDocuments = [
      'README.md',
      'CHANGELOG.md',
      'CODE_OF_CONDUCT.md',
      'CONTRIBUTING.md',
      'GOVERNANCE.md',
      'MAINTAINERS.md',
      'SECURITY.md',
      'SUPPORT.md',
      'THIRD_PARTY_NOTICES.md',
    ];
    const documents = [...rootDocuments, ...(await markdownFiles(resolve('docs')))];
    const missing: string[] = [];
    for (const document of documents) {
      const documentPath = resolve(document);
      const text = await readFile(documentPath, 'utf8');
      for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
        const raw = match[1]!.trim();
        const destination = raw.startsWith('<')
          ? raw.slice(1, raw.indexOf('>'))
          : raw.split(/\s+["']/u)[0]!;
        if (/^(?:https?:|mailto:|#)/u.test(destination)) continue;
        const path = decodeURIComponent(destination.split('#')[0]!.split('?')[0]!);
        if (path === '') continue;
        try {
          await stat(resolve(dirname(documentPath), path));
        } catch {
          missing.push(`${document} -> ${destination}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

async function markdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}
