import { execFile as execFileCallback } from 'node:child_process';
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseCriticalSectionWrapperGateManifest } from '../../helpers/critical-section-wrapper-gate-manifest.js';
import { parseSystemStitchingGateManifest } from '../../helpers/system-stitching-gate-manifest.js';

const execFile = promisify(execFileCallback);

interface PublicReleaseAudit {
  readonly schemaVersion: string;
  readonly currentTree: { readonly status: string; readonly findings: readonly unknown[] };
  readonly releaseCandidate: { readonly status: string; readonly findings: readonly unknown[] };
  readonly history: {
    readonly status: string;
    readonly evidenceState: string;
    readonly publicationDisposition: string;
    readonly commitCount: number;
    readonly findings: readonly {
      readonly category: string;
      readonly id: string | null;
      readonly occurrences: number;
      readonly pathCount: number;
      readonly commitCount: number;
      readonly paths?: readonly string[];
    }[];
    readonly historyRewritePerformed: boolean;
    readonly recommendedStrategy: string | null;
    readonly selectedStrategy: string;
    readonly strategySelectedAt: string;
    readonly legacyHistoryIncluded: boolean;
  };
  readonly ownershipAndPublication: {
    readonly status: string;
    readonly recordedAt: string;
    readonly projectOwnedSourceAuthorized: boolean;
    readonly organizationDerivedMaterialDisposition: string;
    readonly legacyHistoryIncluded: boolean;
    readonly thirdPartyObligations: string;
    readonly exactExternalPublicationAuthorized: boolean;
  };
  readonly publicRepositoryPlan: {
    readonly status: string;
    readonly strategy: string;
    readonly sourceRepositoryHistoryDisposition: string;
    readonly legacyHistoryIncluded: boolean;
    readonly externalRepositoryCreated: boolean;
    readonly publicationAuthorized: boolean;
  };
  readonly publicationAuthorized: boolean;
}

describe('Phase O1.2 public-tree sanitation', () => {
  it('publishes a local/no-telemetry threat boundary and visible artifact warning', async () => {
    const [readme, privacy, index, sanitation, repositoryStrategy] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/privacy-and-artifact-safety.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(resolve('docs/legal/public-release-audit.md'), 'utf8'),
      readFile(resolve('docs/public-repository-strategy.md'), 'utf8'),
    ]);

    expect(readme).toContain('## Privacy and artifact safety');
    expect(readme).toContain('Core analysis is local and sends no telemetry.');
    expect(readme).toContain('Treat every `.api-intel/` bundle');
    expect(privacy).toContain('Generated artifacts are sensitive');
    expect(privacy).toContain('not a confidentiality guarantee');
    expect(privacy).toContain('Safe storage and sharing');
    expect(privacy).toContain('a scan does not authorize upload');
    expect(index).toContain('Privacy, threat model, and artifact safety');
    expect(sanitation).toContain('public-history strategy selected');
    expect(sanitation).toContain(
      'No commit was changed, removed, rebased, filtered, or force-pushed.',
    );
    expect(repositoryStrategy).toContain('new, sanitized repository with fresh history');
    expect(repositoryStrategy).toContain(
      'changing the visibility of the private source repository',
    );
    expect(repositoryStrategy).toContain('External repository created: yes');
    expect(repositoryStrategy).toContain('Exact external publication action authorized: yes');
    expect(index).toContain('Public repository strategy');
  });

  it('retains the distributed and wrapper contracts in explicitly synthetic fixtures', async () => {
    const [systemText, wrapperText] = await Promise.all([
      readFile(resolve('test/fixtures/system-stitching/gate.expected.json'), 'utf8'),
      readFile(
        resolve('test/fixtures/resources/critical-section-wrappers/gate.expected.json'),
        'utf8',
      ),
    ]);
    const system = parseSystemStitchingGateManifest(JSON.parse(systemText) as unknown);
    const wrapper = parseCriticalSectionWrapperGateManifest(JSON.parse(wrapperText) as unknown);

    expect(system.syntheticBasis).toMatchObject({
      producerService: 'orders-api-example',
      consumerService: 'orders-worker-example',
      queue: 'orders_jobs',
      pattern: 'orders.rebuild-index',
    });
    expect(new Set(system.cases.map(({ topology }) => topology))).toEqual(
      new Set(system.requiredTopologies),
    );
    expect(system.cases.every(({ expected }) => expected.provenCrossServiceEdge === false)).toBe(
      true,
    );
    expect(wrapper.syntheticBasis).toMatchObject({
      repository: 'orders-api-example',
      entryMethod: 'WorkflowService.resolveTicket',
    });
    expect(new Set(wrapper.cases.map(({ classification }) => classification))).toEqual(
      new Set(['eligible', 'unsupported']),
    );

    await Promise.all([
      access(resolve('test/fixtures/system-stitching/orders.topology.json')),
      access(resolve('test/fixtures/system-stitching/microservices/orders-api-producer.ts.txt')),
      access(resolve('test/fixtures/system-stitching/microservices/orders-worker-consumer.ts.txt')),
    ]);
  });

  it('records passing current/package gates and a redacted read-only history decision', async () => {
    const [packageText, policyText, auditText] = await Promise.all([
      readFile(resolve('package.json'), 'utf8'),
      readFile(resolve('scripts/public-release-audit-policy.json'), 'utf8'),
      readFile(resolve('docs/legal/public-release-audit.json'), 'utf8'),
    ]);
    const manifest = JSON.parse(packageText) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const policy = JSON.parse(policyText) as {
      readonly schemaVersion: string;
      readonly sensitiveTextFingerprints: readonly {
        readonly id: string;
        readonly length: number;
        readonly sha256: string;
      }[];
      readonly historyPublicationStrategy: {
        readonly status: string;
        readonly strategy: string;
        readonly selectedAt: string;
        readonly includeLegacyHistory: boolean;
        readonly rewriteLegacyHistory: boolean;
      };
      readonly ownershipPublicationAttestation: {
        readonly status: string;
        readonly recordedAt: string;
        readonly projectOwnedSourceAuthorized: boolean;
        readonly organizationTestingPermissionDoesNotGrantRedistribution: boolean;
        readonly organizationDerivedPublicMaterialAllowed: boolean;
        readonly legacyHistoryIncluded: boolean;
        readonly thirdPartyObligationsRemainApplicable: boolean;
        readonly externalMutationAuthorized: boolean;
      };
    };
    const audit = JSON.parse(auditText) as PublicReleaseAudit;

    expect(manifest.scripts['audit:public']).toContain('--current');
    expect(manifest.scripts['audit:public:history']).toContain('--history');
    expect(manifest.scripts['audit:public:report']).toContain('--check-report');
    expect(policy.sensitiveTextFingerprints.length).toBeGreaterThan(10);
    expect(policy.schemaVersion).toBe('1.1.0');
    expect(
      policy.sensitiveTextFingerprints.every(
        ({ id, length, sha256 }) =>
          /^legacy_[a-z]+_marker_\d{2}$/u.test(id) &&
          Number.isInteger(length) &&
          /^[a-f0-9]{64}$/u.test(sha256),
      ),
    ).toBe(true);
    expect(policy.historyPublicationStrategy).toEqual({
      status: 'selected',
      strategy: 'sanitized_new_public_repository_without_legacy_history',
      selectedAt: '2026-09-10',
      includeLegacyHistory: false,
      rewriteLegacyHistory: false,
    });
    expect(policy.ownershipPublicationAttestation).toEqual({
      status: 'recorded',
      recordedAt: '2026-09-10',
      projectOwnedSourceAuthorized: true,
      organizationTestingPermissionDoesNotGrantRedistribution: true,
      organizationDerivedPublicMaterialAllowed: false,
      legacyHistoryIncluded: false,
      thirdPartyObligationsRemainApplicable: true,
      externalMutationAuthorized: false,
    });

    expect(audit).toMatchObject({
      schemaVersion: '1.1.0',
      currentTree: { status: 'pass', findings: [] },
      releaseCandidate: { status: 'pass', findings: [] },
      history: {
        status: 'excluded_by_selected_strategy',
        evidenceState: 'findings_detected',
        publicationDisposition: 'excluded_by_selected_strategy',
        commitCount: 15,
        historyRewritePerformed: false,
        recommendedStrategy: 'sanitized_new_public_repository_without_legacy_history',
        selectedStrategy: 'sanitized_new_public_repository_without_legacy_history',
        strategySelectedAt: '2026-09-10',
        legacyHistoryIncluded: false,
      },
      ownershipAndPublication: {
        status: 'owner_attestation_recorded',
        recordedAt: '2026-09-10',
        projectOwnedSourceAuthorized: true,
        organizationDerivedMaterialDisposition: 'prohibited_from_public_surfaces',
        legacyHistoryIncluded: false,
        thirdPartyObligations: 'remain_applicable',
        exactExternalPublicationAuthorized: false,
      },
      publicRepositoryPlan: {
        status: 'selected_execution_deferred',
        strategy: 'sanitized_new_public_repository_without_legacy_history',
        sourceRepositoryHistoryDisposition: 'remain_private',
        legacyHistoryIncluded: false,
        externalRepositoryCreated: false,
        publicationAuthorized: false,
      },
      publicationAuthorized: false,
    });
    expect(audit.history.findings.length).toBeGreaterThan(0);
    expect(audit.history.findings.every((finding) => finding.paths === undefined)).toBe(true);
    expect(audit.history.findings.every((finding) => finding.occurrences > 0)).toBe(true);
  });

  it('re-runs the fail-closed current-tree and npm-candidate audit', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [resolve('scripts/audit-public-release.mjs'), '--current'],
      { cwd: resolve('.'), encoding: 'utf8', timeout: 75_000 },
    );
    expect(stdout).toMatch(/Current tree: pass .* npm candidate: pass/u);
  }, 90_000);

  it('passes the selected history disposition without claiming that history is clean', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [resolve('scripts/audit-public-release.mjs'), '--history'],
      { cwd: resolve('.'), encoding: 'utf8', timeout: 75_000 },
    );
    expect(stdout).toMatch(/Git history evidence: (?:findings_detected|no_findings)/u);
    expect(stdout).toMatch(
      /publication disposition: (?:excluded_by_selected_strategy|eligible_but_not_selected)/u,
    );
    expect(stdout).toContain('rewrite performed: no');
  }, 90_000);

  it('fails closed without echoing a newly introduced credential-shaped value', async () => {
    const negativePath = resolve('public-release-negative-fixture.txt');
    const credentialShape = ['github', '_pat_', 'A'.repeat(24)].join('');
    await writeFile(negativePath, credentialShape, 'utf8');
    try {
      await expect(
        execFile(process.execPath, [resolve('scripts/audit-public-release.mjs'), '--current'], {
          cwd: resolve('.'),
          encoding: 'utf8',
          timeout: 75_000,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('Finding github_token'),
      });
    } finally {
      await unlink(negativePath);
    }
  }, 90_000);
});
