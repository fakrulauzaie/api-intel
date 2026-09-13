import { execFile as execFileCallback } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const packageRequire = createRequire(resolve('package.json'));

interface DistributionContract {
  readonly schemaVersion: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly surface: string;
  readonly allowedExactFiles: readonly string[];
  readonly runtimeFilePattern: string;
  readonly dataExports: Readonly<Record<string, string>>;
  readonly budgets: {
    readonly maximumFileCount: number;
    readonly maximumPackedBytes: number;
    readonly maximumUnpackedBytes: number;
  };
  readonly assets: readonly {
    readonly id: string;
    readonly distributions: {
      readonly npm: { readonly strategy: string; readonly copiedPaths: readonly string[] };
      readonly githubAction: {
        readonly strategy: string;
        readonly copiedPaths: readonly string[];
      };
      readonly gitlab: { readonly strategy: string; readonly copiedPaths: readonly string[] };
    };
  }[];
}

interface PackageContents {
  readonly schemaVersion: string;
  readonly package: { readonly name: string; readonly version: string; readonly surface: string };
  readonly archive: {
    readonly fileCount: number;
    readonly packedBytes: number;
    readonly unpackedBytes: number;
  };
  readonly budgets: DistributionContract['budgets'];
  readonly dataExports: Readonly<Record<string, string>>;
  readonly files: readonly { readonly path: string; readonly role: string }[];
}

async function markdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

function resolutionErrorCode(specifier: string): string | undefined {
  try {
    packageRequire.resolve(specifier);
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
}

describe('Phase O2.2 npm package surface', () => {
  it('keeps a finite CLI-first manifest and imports every approved data export', async () => {
    const [manifestText, contractText] = await Promise.all([
      readFile(resolve('package.json'), 'utf8'),
      readFile(resolve('packaging/npm/distribution-contract.json'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as Record<string, unknown> & {
      readonly exports: Readonly<Record<string, string>>;
      readonly files: readonly string[];
    };
    const contract = JSON.parse(contractText) as DistributionContract;

    expect(contract).toMatchObject({
      schemaVersion: '1.0.0',
      packageName: '@fakrulauzaie/api-intel',
      packageVersion: '0.1.0-alpha.1',
      surface: 'cli_first_data_exports_only',
      runtimeFilePattern: 'dist/**/*.js',
    });
    expect(manifest.exports).toEqual(contract.dataExports);
    expect(manifest.main).toBeUndefined();
    expect(manifest.types).toBeUndefined();
    expect(manifest.files).toEqual([
      'dist/**/*.js',
      'schemas/api-intel.config.schema.json',
      'schemas/support-diagnostic-manifest.schema.json',
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      'docs/legal/dependency-license-inventory.json',
      'docs/legal/redistribution-audit.md',
    ]);

    for (const [subpath, target] of Object.entries(contract.dataExports)) {
      const specifier = `${contract.packageName}/${subpath.slice(2)}`;
      expect(packageRequire.resolve(specifier)).toBe(resolve(target.slice(2)));
      const schema = packageRequire(specifier) as { readonly $schema?: string };
      expect(schema.$schema).toContain('json-schema.org');
    }
    expect(resolutionErrorCode(contract.packageName)).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
    expect(resolutionErrorCode(`${contract.packageName}/dist/model/index.js`)).toBe(
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
    );
  });

  it('retains the exact tarball inventory, budgets, and asset disposition', async () => {
    const [contractText, manifestText, verification] = await Promise.all([
      readFile(resolve('packaging/npm/distribution-contract.json'), 'utf8'),
      readFile(resolve('package.json'), 'utf8'),
      execFile(process.execPath, [resolve('scripts/verify-npm-package.mjs'), '--check'], {
        cwd: resolve('.'),
        encoding: 'utf8',
      }),
    ]);
    const contract = JSON.parse(contractText) as DistributionContract;
    const manifest = JSON.parse(manifestText) as { readonly private?: boolean };
    const contentsText = await readFile(
      resolve(
        Object.hasOwn(manifest, 'private')
          ? 'packaging/npm/package-contents.json'
          : 'packaging/npm/public-package-contents.json',
      ),
      'utf8',
    );
    const contents = JSON.parse(contentsText) as PackageContents;

    expect(verification.stdout).toBe(
      `npm package verified: ${contents.archive.fileCount} files, ` +
        `${contents.archive.packedBytes} packed bytes, ` +
        `${contents.archive.unpackedBytes} unpacked bytes.\n`,
    );
    expect(contents).toMatchObject({
      schemaVersion: '1.0.0',
      package: {
        name: contract.packageName,
        version: contract.packageVersion,
        surface: contract.surface,
      },
      budgets: contract.budgets,
      dataExports: contract.dataExports,
    });
    expect(contents.archive.fileCount).toBe(contents.files.length);
    expect(contents.archive.fileCount).toBeLessThanOrEqual(contract.budgets.maximumFileCount);
    expect(contents.archive.packedBytes).toBeLessThanOrEqual(contract.budgets.maximumPackedBytes);
    expect(contents.archive.unpackedBytes).toBeLessThanOrEqual(
      contract.budgets.maximumUnpackedBytes,
    );
    expect(contents.files.filter(({ role }) => role === 'runtime_javascript')).toHaveLength(263);
    expect(contents.files.some(({ path }) => path.endsWith('.map'))).toBe(false);
    expect(contents.files.some(({ path }) => path.endsWith('.d.ts'))).toBe(false);
    expect(
      contents.files.some(({ path }) =>
        /^(?:action-dist|gitlab-dist|packaging|scripts|src|templates|test)\//u.test(path),
      ),
    ).toBe(false);
    for (const asset of contract.assets) {
      expect(asset.distributions.npm).toEqual({ strategy: 'runtime_dependency', copiedPaths: [] });
      expect(asset.distributions.githubAction).toMatchObject({
        strategy: 'copied_once',
        copiedPaths: [expect.any(String)],
      });
      expect(asset.distributions.gitlab).toMatchObject({
        strategy: 'copied_once',
        copiedPaths: [expect.any(String)],
      });
    }
  });

  it('documents shipped schemas and contains no supported package deep import', async () => {
    const [guide, configuration, index, plan, rootReadme, ...documentation] = await Promise.all([
      readFile(resolve('docs/npm-package-surface.md'), 'utf8'),
      readFile(resolve('docs/project-configuration.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('README.md'), 'utf8'),
      ...(await markdownFiles(resolve('docs'))).map((path) => readFile(path, 'utf8')),
    ]);

    expect(guide).toContain('@fakrulauzaie/api-intel/schemas/api-intel.config.schema.json');
    expect(guide).toContain(
      '@fakrulauzaie/api-intel/schemas/support-diagnostic-manifest.schema.json',
    );
    expect(configuration).toContain(
      './node_modules/@fakrulauzaie/api-intel/schemas/api-intel.config.schema.json',
    );
    expect(index).toContain('[npm package surface]');
    expect(plan).toMatch(/### Phase O2\.2[\s\S]*?Status: complete/u);
    for (const text of [rootReadme, ...documentation]) {
      expect(text).not.toMatch(/@fakrulauzaie\/api-intel\/(?:dist|src)\//u);
    }
  });
});
