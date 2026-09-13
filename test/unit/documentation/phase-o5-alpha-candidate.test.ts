import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface CandidateContract {
  readonly schemaVersion: string;
  readonly package: {
    readonly name: string;
    readonly version: string;
    readonly sourceManifestPrivate: boolean;
    readonly stagedManifestPrivateProperty: string;
  };
  readonly sourceExport: {
    readonly allowedRootFiles: readonly string[];
    readonly allowedRootDirectories: readonly string[];
    readonly forbiddenPathSegments: readonly string[];
    readonly historyDisposition: string;
    readonly symbolicLinksAllowed: boolean;
  };
  readonly immutableReferences: { readonly mutableConsumptionTagsAllowed: boolean };
  readonly surfaceClaims: Readonly<Record<string, string>>;
  readonly releaseBoundary: Readonly<Record<string, boolean>>;
}

describe('Phase O5.1 audited alpha release candidate', () => {
  it('selects a prerelease while retaining the private source manifest guard', async () => {
    const [manifestText, contractText, versionSource, changelog] = await Promise.all([
      readFile(resolve('package.json'), 'utf8'),
      readFile(resolve('packaging/release/public-alpha-candidate-contract.json'), 'utf8'),
      readFile(resolve('src/version.ts'), 'utf8'),
      readFile(resolve('CHANGELOG.md'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as {
      name: string;
      version: string;
      private?: boolean;
    };
    const contract = JSON.parse(contractText) as CandidateContract;

    expect(contract.schemaVersion).toBe('1.0.0');
    expect(manifest).toMatchObject({
      name: '@fakrulauzaie/api-intel',
      version: '0.1.0-alpha.1',
    });
    expect(manifest.private === true || !Object.hasOwn(manifest, 'private')).toBe(true);
    expect(contract.package).toEqual({
      name: manifest.name,
      version: manifest.version,
      sourceManifestPrivate: true,
      stagedManifestPrivateProperty: 'omitted',
    });
    expect(versionSource).toContain("TOOL_VERSION = '0.1.0-alpha.1'");
    expect(changelog).toMatch(/^## 0\.1\.0-alpha\.1 — 2026-09-12$/mu);
  });

  it('uses an allowlisted history-free regular-file export and candidate-only transform', async () => {
    const [contractText, staging] = await Promise.all([
      readFile(resolve('packaging/release/public-alpha-candidate-contract.json'), 'utf8'),
      readFile(resolve('scripts/stage-public-alpha-candidate.mjs'), 'utf8'),
    ]);
    const contract = JSON.parse(contractText) as CandidateContract;

    expect(contract.sourceExport.historyDisposition).toBe('fresh_public_history_only');
    expect(contract.sourceExport.symbolicLinksAllowed).toBe(false);
    expect(contract.sourceExport.forbiddenPathSegments).toEqual(
      expect.arrayContaining(['.git', '.tmp', 'dist', 'node_modules']),
    );
    expect(contract.sourceExport.allowedRootFiles).toContain('package.json');
    expect(contract.sourceExport.allowedRootDirectories).toEqual(
      expect.arrayContaining(['src', 'test', 'docs', 'action-dist', 'gitlab-dist']),
    );
    expect(staging).toContain('delete manifest.private');
    expect(staging).toContain(
      "derivation: 'allowlisted export plus package.json private-property omission only'",
    );
    expect(staging).toContain('gitHistoryIncluded: false');
    expect(staging).toContain(
      'Two independent npm pack operations did not produce identical bytes.',
    );
    expect(staging).not.toContain('npm publish');
    expect(staging).not.toContain('docker push');
    expect(staging).not.toContain('gh release');
  });

  it('freezes honest surface labels, immutable consumer references, and external blockers', async () => {
    const [contractText, releaseNotes, guide, gitlabExample, actionExample] = await Promise.all([
      readFile(resolve('packaging/release/public-alpha-candidate-contract.json'), 'utf8'),
      readFile(resolve('docs/releases/0.1.0-alpha.1.md'), 'utf8'),
      readFile(resolve('docs/alpha-release-candidate.md'), 'utf8'),
      readFile(resolve('docs/examples/gitlab/api-intel-merge-request.yml'), 'utf8'),
      readFile(resolve('docs/examples/github/api-intel-pull-request.yml'), 'utf8'),
    ]);
    const contract = JSON.parse(contractText) as CandidateContract;

    expect(Object.values(contract.surfaceClaims)).toEqual(
      expect.arrayContaining([
        'core-alpha candidate',
        'hosted-validated preview',
        'locally verified preview',
        'mock-verified preview',
        'deferred',
      ]),
    );
    expect(contract.immutableReferences.mutableConsumptionTagsAllowed).toBe(false);
    expect(gitlabExample).toContain('@sha256:IMAGE_MANIFEST_DIGEST');
    expect(actionExample).toContain('@ACTION_COMMIT_SHA');
    expect(contract.releaseBoundary).toMatchObject({
      externalMutationAuthorized: true,
      publicationWorkflowImplemented: false,
      sourceRepositoryHistoryIncluded: false,
      privateSecurityChannelActive: true,
      privateConductChannelActive: true,
      namedBrowserMatrixClaimed: false,
    });
    expect(releaseNotes).toContain('Remaining release boundaries');
    expect(releaseNotes).toContain('Migration notes');
    expect(releaseNotes).toContain('Rollback and compromise');
    expect(guide).toContain('content hash—not HEAD alone—is the exact source identity');
  });

  it('adds an explicit staged-tree sanitation mode without weakening current/history audits', async () => {
    const audit = await readFile(resolve('scripts/audit-public-release.mjs'), 'utf8');
    expect(audit).toContain("mode === '--staged'");
    expect(audit).toContain('The staged public tree must not contain .git history.');
    expect(audit).toContain("mode === '--current'");
    expect(audit).toContain("mode === '--history'");
  });
});
