import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface LicenseInventory {
  readonly schemaVersion: string;
  readonly project: {
    readonly license: string;
    readonly licenseFile: { readonly path: string; readonly sha256: string };
  };
  readonly input: {
    readonly environment: { readonly platform: string; readonly architecture: string };
  };
  readonly policy: {
    readonly allowedDeclaredLicenses: readonly string[];
    readonly unresolvedLicenseCount: number;
  };
  readonly summary: {
    readonly packages: number;
    readonly byScope: { readonly production: number; readonly development: number };
  };
  readonly redistributedAssets: readonly {
    readonly package: string;
    readonly sourcePath: string;
    readonly destinations: readonly string[];
    readonly sha256: string;
  }[];
  readonly packages: readonly {
    readonly name: string;
    readonly version: string;
    readonly scope: 'production' | 'development';
    readonly direct: boolean;
    readonly declaredLicense: string;
    readonly licenseFiles: readonly { readonly name: string; readonly sha256: string }[];
  }[];
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Phase O1.1 license and redistribution audit', () => {
  it('aligns the project license, package surface, and public release boundary', async () => {
    const [packageText, license, notices, releaseBoundary, plan] = await Promise.all([
      readFile(resolve('package.json'), 'utf8'),
      readFile(resolve('LICENSE'), 'utf8'),
      readFile(resolve('THIRD_PARTY_NOTICES.md'), 'utf8'),
      readFile(resolve('docs/public-release-boundary.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
    ]);
    const manifest = JSON.parse(packageText) as {
      readonly private?: boolean;
      readonly license?: string;
      readonly files?: readonly string[];
      readonly scripts?: Readonly<Record<string, string>>;
    };

    expect(manifest.private === true || !Object.hasOwn(manifest, 'private')).toBe(true);
    expect(manifest.license).toBe('Apache-2.0');
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        'LICENSE',
        'THIRD_PARTY_NOTICES.md',
        'docs/legal/dependency-license-inventory.json',
        'docs/legal/redistribution-audit.md',
      ]),
    );
    expect(manifest.scripts?.['audit:licenses']).toContain('--check');
    expect(manifest.scripts?.['audit:licenses:write']).toContain('--write');
    expect(license).toContain('Apache License');
    expect(license).toContain('Version 2.0, January 2004');
    expect(notices).toContain('Cytoscape.js 3.34.0');
    expect(notices).toContain('libpg-query 18.1.2');
    expect(notices).toContain('@modelcontextprotocol/server@2.0.0');
    expect(releaseBoundary).toContain('Apache-2.0; project-owned source authorized by owner');
    expect(plan).toMatch(/### Phase O1\.1[\s\S]*?Status: project-owner authorization complete/u);
  });

  it('retains a deterministic complete installed-graph and copied-asset inventory', async () => {
    const inventory = JSON.parse(
      await readFile(resolve('docs/legal/dependency-license-inventory.json'), 'utf8'),
    ) as LicenseInventory;

    expect(inventory.schemaVersion).toBe('1.0.0');
    // This checked document is exact evidence from its named generation
    // environment. The live audit performed earlier in CI independently checks
    // the current runner's installed graph; the retained snapshot must not
    // pretend to have been generated on whichever platform reads it.
    expect(inventory.input.environment).toEqual({
      platform: 'win32',
      architecture: 'x64',
    });
    expect(inventory.project.license).toBe('Apache-2.0');
    expect(inventory.project).toMatchObject({
      name: '@fakrulauzaie/api-intel',
      version: '0.1.0-alpha.1',
    });
    expect(inventory.project.licenseFile).toEqual({
      path: 'LICENSE',
      sha256: sha256(await readFile(resolve('LICENSE'))),
    });
    expect(inventory.policy.unresolvedLicenseCount).toBe(0);
    expect(inventory.summary).toEqual({
      packages: 189,
      byScope: { production: 8, development: 181 },
      byDeclaredLicense: expect.any(Object),
    });
    const allowedLicenses = new Set(inventory.policy.allowedDeclaredLicenses);
    expect(
      inventory.packages.every(({ declaredLicense }) => allowedLicenses.has(declaredLicense)),
    ).toBe(true);
    expect(
      inventory.packages.find(
        ({ name, version }) => name === '@modelcontextprotocol/server' && version === '2.0.0',
      ),
    ).toMatchObject({ scope: 'production', direct: true, declaredLicense: 'MIT' });
    expect(
      inventory.packages.find(({ name, version }) => name === 'argparse' && version === '2.0.1'),
    ).toMatchObject({ scope: 'development', direct: false, declaredLicense: 'Python-2.0' });
    expect(
      inventory.packages.find(({ name, version }) => name === 'typescript' && version === '5.9.3'),
    ).toMatchObject({ scope: 'production', direct: true, declaredLicense: 'Apache-2.0' });
    expect(
      inventory.packages.find(({ name, version }) => name === 'vitest' && version === '4.1.11'),
    ).toMatchObject({ scope: 'development', direct: true, declaredLicense: 'MIT' });

    for (const asset of inventory.redistributedAssets) {
      expect(asset.sha256).toBe(sha256(await readFile(resolve(asset.sourcePath))));
      expect(asset.destinations).toHaveLength(2);
    }
    expect(JSON.stringify(inventory)).not.toMatch(/[A-Z]:\\Users\\/iu);
  });

  it('makes license evidence inseparable from both host bundles and documents OCI limits', async () => {
    const [actionBuild, gitlabBuild, sharedBuild, dockerfile, audit, fixtureProvenance] =
      await Promise.all([
        readFile(resolve('scripts/build-github-action.mjs'), 'utf8'),
        readFile(resolve('scripts/build-gitlab-ci.mjs'), 'utf8'),
        readFile(resolve('scripts/provider-distribution.mjs'), 'utf8'),
        readFile(resolve('packaging/gitlab/Dockerfile'), 'utf8'),
        readFile(resolve('docs/legal/redistribution-audit.md'), 'utf8'),
        readFile(resolve('docs/legal/fixture-provenance.md'), 'utf8'),
      ]);

    for (const build of [actionBuild, gitlabBuild]) {
      expect(build).toContain('buildProviderDistribution');
    }
    expect(sharedBuild).toContain("'--license'");
    expect(sharedBuild).toContain("'THIRD_PARTY_LICENSES.txt'");
    expect(sharedBuild).toContain("['LICENSE', 'THIRD_PARTY_NOTICES.md']");
    expect(sharedBuild).toContain('dependency-license-inventory.json');
    expect(dockerfile).toContain('org.opencontainers.image.licenses="Apache-2.0"');
    expect(audit).toContain('corresponding-source review');
    expect(audit).toContain('owner attestation');
    expect(fixtureProvenance).toContain('Project-authored synthetic');
    expect(fixtureProvenance).toContain('`docs/assets/evidence-path.svg`');
    expect(fixtureProvenance).toContain('not private output, a browser screenshot');

    for (const directory of ['action-dist', 'gitlab-dist']) {
      const [
        license,
        notices,
        aggregate,
        inventoryStat,
        cytoscapeLicense,
        sourceCytoscapeLicense,
        libpgLicense,
        sourceLibpgLicense,
      ] = await Promise.all([
        readFile(resolve(directory, 'LICENSE'), 'utf8'),
        readFile(resolve(directory, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
        readFile(resolve(directory, 'THIRD_PARTY_LICENSES.txt'), 'utf8'),
        stat(resolve(directory, 'dependency-license-inventory.json')),
        readFile(resolve(directory, 'licenses/cytoscape-3.34.0-MIT.txt')),
        readFile(resolve('node_modules/cytoscape/LICENSE')),
        readFile(resolve(directory, 'licenses/libpg-query-18.1.2-MIT.txt')),
        readFile(resolve('node_modules/libpg-query/LICENSE')),
      ]);
      expect(license).toContain('Apache License');
      expect(notices).toContain('Standalone redistributed assets');
      expect(aggregate.length).toBeGreaterThan(1_000);
      expect(inventoryStat.size).toBeGreaterThan(1_000);
      expect(cytoscapeLicense.equals(sourceCytoscapeLicense)).toBe(true);
      expect(libpgLicense.equals(sourceLibpgLicense)).toBe(true);
    }
  });
});
