import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);

function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as T;
}

interface ReleaseIntegrityPolicy {
  readonly vulnerabilityAudit: {
    readonly blockingSeverities: readonly string[];
    readonly requiredExceptionFields: readonly string[];
  };
  readonly releaseEvidence: { readonly ociBaseAndOsPackagesIncluded: boolean };
  readonly trustBoundary: Readonly<Record<string, unknown>>;
}

interface VulnerabilityReport {
  readonly inputs: {
    readonly lockfileSha256: string;
    readonly policySha256: string;
    readonly exceptionsSha256: string;
  };
  readonly summary: Readonly<Record<string, unknown>>;
  readonly advisories: readonly unknown[];
}

interface DependencyInventory {
  readonly packages: readonly unknown[];
}

interface CycloneDxDocument {
  readonly bomFormat: string;
  readonly specVersion: string;
  readonly version: number;
  readonly metadata: {
    readonly properties: readonly { readonly name: string; readonly value: string }[];
  };
  readonly components: readonly unknown[];
}

interface ReleaseInputs {
  readonly source: Readonly<Record<string, unknown>>;
  readonly qualification: Readonly<Record<string, unknown>>;
}

interface PackageManifest {
  readonly private?: boolean;
  readonly scripts: Readonly<Record<string, string>>;
}

describe('Phase O3.3 release integrity and dependency policy', () => {
  it('rejects an unreviewed blocking advisory in the frozen negative contract', async () => {
    await expect(
      execFile(
        process.execPath,
        [
          resolve('scripts/audit-dependencies.mjs'),
          '--input',
          'test/fixtures/release/pnpm-audit-critical.json',
        ],
        { cwd: resolve('.'), encoding: 'utf8' },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Unreviewed dependency vulnerabilities: GHSA-0000-0000-0000:synthetic-vulnerable-package:critical.',
      ),
    });
  });

  it('binds a fresh passing vulnerability decision to the lockfile, policy, and empty exception ledger', async () => {
    const [policyText, exceptionsText, lockfile, report] = await Promise.all([
      readFile(resolve('packaging/release/release-integrity-policy.json'), 'utf8'),
      readFile(resolve('packaging/release/vulnerability-exceptions.json'), 'utf8'),
      readFile(resolve('pnpm-lock.yaml')),
      json<VulnerabilityReport>('packaging/release/dependency-vulnerability-report.json'),
    ]);
    const policy = JSON.parse(policyText) as ReleaseIntegrityPolicy;
    const exceptions = JSON.parse(exceptionsText) as { readonly exceptions: readonly unknown[] };

    expect(policy.vulnerabilityAudit.blockingSeverities).toEqual(['high', 'critical']);
    expect(policy.vulnerabilityAudit.requiredExceptionFields).toEqual(
      expect.arrayContaining([
        'owner',
        'rationale',
        'affectedSurfaces',
        'compensatingControls',
        'reviewedOn',
        'expiresOn',
      ]),
    );
    expect(exceptions.exceptions).toEqual([]);
    expect(report.inputs).toMatchObject({
      lockfileSha256: sha256(lockfile),
      policySha256: sha256(policyText),
      exceptionsSha256: sha256(exceptionsText),
    });
    expect(report.summary).toMatchObject({
      high: 0,
      critical: 0,
      highCriticalTotal: 0,
      acceptedExceptions: 0,
      unreviewedHighCritical: 0,
      status: 'pass',
    });
    expect(report.advisories).toEqual([]);
  });

  it('publishes a bounded CycloneDX dependency inventory and exact source-input checksums', async () => {
    const packageManifest = await json<PackageManifest>('package.json');
    const publicManifest = !Object.hasOwn(packageManifest, 'private');
    const releaseInputsPath = publicManifest
      ? 'packaging/release/public-release-inputs.json'
      : 'packaging/release/release-inputs.json';
    const checksumsPath = publicManifest
      ? 'packaging/release/PUBLIC_SHA256SUMS'
      : 'packaging/release/SHA256SUMS';
    const [policy, inventory, sbom, inputs, checksums] = await Promise.all([
      json<ReleaseIntegrityPolicy>('packaging/release/release-integrity-policy.json'),
      json<DependencyInventory>('docs/legal/dependency-license-inventory.json'),
      json<CycloneDxDocument>('packaging/release/source-dependencies.cdx.json'),
      json<ReleaseInputs>(releaseInputsPath),
      readFile(resolve(checksumsPath), 'utf8'),
    ]);

    expect(sbom).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1 });
    expect(sbom.components).toHaveLength(inventory.packages.length);
    expect(sbom.metadata.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'api-intel:scope',
          value: expect.stringContaining('no OCI base/OS packages'),
        }),
      ]),
    );
    expect(policy.releaseEvidence.ociBaseAndOsPackagesIncluded).toBe(false);
    expect(inputs.source).toMatchObject({
      revisionResolution: 'release_dry_run_runtime',
      cleanTreeRequiredForPublication: true,
      expectedTag: 'v0.1.0-alpha.1',
    });
    expect(inputs.qualification).toMatchObject({
      ociBaseAndOsPackagesIncluded: false,
      externalPublicationAuthorizedByThisDocument: false,
    });

    const records = checksums.trim().split(/\r?\n/u);
    expect(records.length).toBeGreaterThan(15);
    for (const record of records) {
      const match = record.match(/^([a-f0-9]{64}) {2}(.+)$/u);
      expect(match, record).not.toBeNull();
      const [, digest, path] = match!;
      expect(sha256(await readFile(resolve(path!))), path).toBe(digest);
    }
  });

  it('keeps candidate jobs credential-free and the dry run incapable of external publication', async () => {
    const [policy, packageJson, workflow, dryRun, guide, plan, changelog] = await Promise.all([
      json<ReleaseIntegrityPolicy>('packaging/release/release-integrity-policy.json'),
      json<PackageManifest>('package.json'),
      readFile(resolve('.github/workflows/ci.yml'), 'utf8'),
      readFile(resolve('scripts/release-dry-run.mjs'), 'utf8'),
      readFile(resolve('docs/release-integrity-and-response.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('CHANGELOG.md'), 'utf8'),
    ]);

    expect(packageJson.private === true || !Object.hasOwn(packageJson, 'private')).toBe(true);
    expect(packageJson.scripts).toMatchObject({
      'audit:dependencies': 'node scripts/audit-dependencies.mjs --check',
      'release:integrity': 'node scripts/release-candidate.mjs --check',
      'release:dry-run': 'node scripts/release-dry-run.mjs',
    });
    expect(policy.trustBoundary).toMatchObject({
      pullRequestPermissions: 'contents_read_only',
      pullRequestSecrets: 'none',
      candidateExternalMutation: false,
      longLivedRegistryTokens: 'forbidden',
      publishWorkflowImplemented: false,
    });
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('pnpm run audit:dependencies:live');
    expect(workflow).toContain('pnpm run release:dry-run --prepared');
    expect(workflow).not.toContain('id-token: write');
    expect(workflow).not.toContain('packages: write');
    expect(workflow).not.toContain('GITHUB_TOKEN');
    for (const forbidden of ['npm publish', 'docker push', 'gh release', 'git tag']) {
      expect(dryRun).not.toContain(forbidden);
    }
    expect(dryRun).toContain("kind: 'non_publishing_release_dry_run'");
    expect(dryRun).toContain('externalMutationPerformed: false');
    expect(guide).toContain('Passing these local checks is necessary release evidence');
    expect(guide).toMatch(
      /Published\s+bytes, tags, checksums, provenance, and release notes are never silently replaced\./u,
    );
    expect(changelog).toMatch(/^## 0\.1\.0-alpha\.1(?:\s|$)/mu);
    expect(plan).toMatch(
      /### Phase O3\.3[\s\S]*?Status: implementation complete; Gate OR0 independent hosted\/public-release validation pending/u,
    );
    expect(plan).toContain('Gate OR0 is not marked passed.');
  });
});
