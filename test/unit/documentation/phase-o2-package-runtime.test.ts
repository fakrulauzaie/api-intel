import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);

interface RuntimeContract {
  readonly schemaVersion: string;
  readonly packageName: string;
  readonly sourceManifestMustRemainPrivate: boolean;
  readonly publicMetadata: {
    readonly description: string;
    readonly author: string;
    readonly maintainers: readonly string[];
    readonly keywords: readonly string[];
  };
  readonly bins: Readonly<Record<string, string>>;
  readonly exports: Readonly<Record<string, string>>;
  readonly runtimeDependencies: readonly {
    readonly name: string;
    readonly version: string;
    readonly probe: string;
    readonly reason: string;
  }[];
  readonly lifecyclePolicy: {
    readonly consumerInstallScripts: readonly string[];
    readonly packPreparation: string;
    readonly targetProjectScriptsExecuted: boolean;
  };
  readonly destinationMetadata: {
    readonly status: string;
    readonly fields: readonly string[];
    readonly values: Readonly<Record<string, unknown>>;
    readonly fundingStatus: string;
  };
}

describe('Phase O2.1 package runtime and manifest', () => {
  it('uses the approved identity and a closed production runtime ledger', async () => {
    const [packageText, contractText, lockfile, guide, index, plan] = await Promise.all([
      readFile(resolve('package.json'), 'utf8'),
      readFile(resolve('packaging/npm/runtime-contract.json'), 'utf8'),
      readFile(resolve('pnpm-lock.yaml'), 'utf8'),
      readFile(resolve('docs/package-runtime-and-manifest.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
    ]);
    const manifest = JSON.parse(packageText) as Record<string, unknown> & {
      readonly dependencies: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
      readonly scripts: Readonly<Record<string, string>>;
    };
    const contract = JSON.parse(contractText) as RuntimeContract;

    expect(contract.schemaVersion).toBe('1.1.0');
    expect(manifest).toMatchObject({
      name: contract.packageName,
      description: contract.publicMetadata.description,
      author: contract.publicMetadata.author,
      maintainers: contract.publicMetadata.maintainers,
      keywords: contract.publicMetadata.keywords,
      license: 'Apache-2.0',
      engines: { node: '>=22.13 <25' },
      packageManager: 'pnpm@11.19.0',
      bin: contract.bins,
      exports: contract.exports,
    });
    expect(
      manifest.private === contract.sourceManifestMustRemainPrivate ||
        (contract.sourceManifestMustRemainPrivate && !Object.hasOwn(manifest, 'private')),
    ).toBe(true);
    expect(manifest.dependencies).toEqual(
      Object.fromEntries(contract.runtimeDependencies.map(({ name, version }) => [name, version])),
    );
    expect(manifest.devDependencies.typescript).toBeUndefined();
    expect(manifest.scripts).toMatchObject({
      prepack: 'npm run build && npm run pack:verify',
      'pack:verify': 'node scripts/verify-package-runtime.mjs',
    });
    for (const hook of ['preinstall', 'install', 'postinstall']) {
      expect(manifest.scripts[hook]).toBeUndefined();
    }
    expect(manifest).toMatchObject(contract.destinationMetadata.values);
    for (const field of ['funding', 'main', 'types']) {
      expect(manifest[field]).toBeUndefined();
    }
    expect(contract.destinationMetadata.fields).toEqual(['repository', 'homepage', 'bugs']);
    expect(contract.lifecyclePolicy).toEqual({
      consumerInstallScripts: [],
      packPreparation: 'build_then_verify',
      targetProjectScriptsExecuted: false,
    });
    expect(contract.destinationMetadata.status).toBe('active_sanitized_public_repository');
    const rootImporter = lockfile.slice(0, lockfile.indexOf('\npackages:'));
    expect(rootImporter).toMatch(/dependencies:[\s\S]*?typescript:\s+specifier: 5\.9\.3/u);
    expect(rootImporter).not.toMatch(/devDependencies:[\s\S]*?^\s{6}typescript:\s*$/mu);
    expect(guide).toContain('TypeScript is intentionally a production dependency.');
    expect(index).toContain('[Package runtime and manifest contract]');
    expect(plan).toMatch(/### Phase O2\.1[\s\S]*?Status: complete/u);
  });

  it('verifies the emitted closure and both executable entrypoints', async () => {
    const [verification, cliVersion, cliHelp, mcpVersion, mcpHelp] = await Promise.all([
      execFile(process.execPath, [resolve('scripts/verify-package-runtime.mjs')], {
        cwd: resolve('.'),
        encoding: 'utf8',
      }),
      execFile(process.execPath, [resolve('dist/cli/index.js'), '--version'], {
        cwd: resolve('.'),
        encoding: 'utf8',
      }),
      execFile(process.execPath, [resolve('dist/cli/index.js'), '--help'], {
        cwd: resolve('.'),
        encoding: 'utf8',
      }),
      execFile(process.execPath, [resolve('dist/mcp/index.js'), '--version'], {
        cwd: resolve('.'),
        encoding: 'utf8',
      }),
      execFile(process.execPath, [resolve('dist/mcp/index.js'), '--help'], {
        cwd: resolve('.'),
        encoding: 'utf8',
      }),
    ]);

    expect(verification.stderr).toMatch(
      /Package runtime verified: \d+ emitted files, \d+ imported packages, \d+ production dependency packages; consumer install hooks: 0\./u,
    );
    expect(cliVersion.stdout.trim()).toBe('0.1.0-alpha.1');
    expect(cliHelp.stdout).toContain('api-intel <command> [options]');
    expect(mcpVersion.stdout.trim()).toBe('1.2.0');
    expect(mcpHelp.stdout).toContain('api-intel-mcp --analysis');
  });
});
