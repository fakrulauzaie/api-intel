import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);

interface CleanRoomContract {
  readonly schemaVersion: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageManagers: readonly string[];
  readonly expected: {
    readonly cliVersion: string;
    readonly mcpVersion: string;
    readonly analysisSchemaVersion: string;
    readonly doctorSchemaVersion: string;
    readonly doctorResult: string;
    readonly initializationSchemaVersion: string;
    readonly initialConfiguration: { readonly version: number };
    readonly existingConfigurationExitCode: number;
    readonly endpoint: {
      readonly httpMethod: string;
      readonly routePath: string;
      readonly handler: string;
    };
    readonly rawSql: {
      readonly dialect: string;
      readonly ruleId: string;
      readonly table: string;
      readonly direction: string;
    };
    readonly graphFile: string;
    readonly mcpProtocolVersion: string;
    readonly mcpTools: readonly string[];
    readonly missingDependency: {
      readonly diagnosticCode: string;
      readonly resultState: string;
    };
    readonly invalidTsconfig: { readonly exitCode: number; readonly message: string };
  };
}

interface CleanRoomConsumer {
  readonly manager: string;
  readonly version: string;
  readonly installScriptsExecuted: boolean;
  readonly consumerRootOutsideSourceWorkspace: boolean;
  readonly runtimePathsOutsideSourceWorkspace: boolean;
  readonly installedPackageFiles: number;
  readonly runtimeDependencies: readonly string[];
  readonly bins: {
    readonly apiIntel: string;
    readonly apiIntelMcp: string;
    readonly shims: readonly string[];
  };
  readonly initialization: {
    readonly schemaVersion: string;
    readonly previewResult: string;
    readonly writeResult: string;
    readonly existingConfigurationExitCode: number;
    readonly configuration: { readonly version: number };
    readonly absoluteConsumerPathExposed: boolean;
    readonly headlessGraphGenerated: boolean;
  };
  readonly doctor: {
    readonly schemaVersion: string;
    readonly result: string;
    readonly repository: string;
    readonly runtimeAssetsReady: boolean;
    readonly nestDeclarationsResolved: boolean;
    readonly absoluteConsumerPathExposed: boolean;
  };
  readonly schemas: {
    readonly configuration: string;
    readonly support: string;
    readonly rootImport: string;
    readonly deepImport: string;
  };
  readonly scan: {
    readonly resultState: string;
    readonly schemaVersion: string;
    readonly endpoints: number;
    readonly handler: string;
    readonly rawSql: {
      readonly dialect: string;
      readonly ruleId: string;
      readonly table: string;
      readonly direction: string;
    };
    readonly graph: {
      readonly file: string;
      readonly externalScriptOrStylesheetReferences: number;
      readonly browserPreviewRequested: boolean;
    };
  };
  readonly mcp: { readonly protocolVersion: string; readonly tools: readonly string[] };
  readonly negatives: {
    readonly missingDependency: {
      readonly exitCode: number;
      readonly resultState: string;
      readonly diagnosticCode: string;
      readonly stackTrace: boolean;
    };
    readonly invalidTsconfig: {
      readonly exitCode: number;
      readonly messageCategory: string;
      readonly stackTrace: boolean;
    };
  };
}

interface CleanRoomReport {
  readonly schemaVersion: string;
  readonly package: {
    readonly name: string;
    readonly version: string;
    readonly fileCount: number;
    readonly packedBytes: number;
    readonly unpackedBytes: number;
    readonly shasum: string;
    readonly integrity: string;
  };
  readonly environment: {
    readonly platform: string;
    readonly architecture: string;
    readonly node: string;
    readonly npm: string;
    readonly pnpm: string;
  };
  readonly isolation: {
    readonly consumerLocation: string;
    readonly sourceWorkspaceNodeModulesUsed: boolean;
    readonly targetApplicationExecuted: boolean;
    readonly packageInstallScriptsExecuted: boolean;
  };
  readonly expected: CleanRoomContract['expected'];
  readonly consumers: readonly CleanRoomConsumer[];
}

describe('Phase O2.3 clean-room package installation', () => {
  it('retains exact, source-free npm and pnpm consumer evidence', async () => {
    const [
      contractText,
      reportText,
      privateContentsText,
      publicContentsText,
      manifestText,
      verification,
    ] = await Promise.all([
      readFile(resolve('packaging/npm/clean-room-contract.json'), 'utf8'),
      readFile(resolve('packaging/npm/clean-room-install-report.json'), 'utf8'),
      readFile(resolve('packaging/npm/package-contents.json'), 'utf8'),
      readFile(resolve('packaging/npm/public-package-contents.json'), 'utf8'),
      readFile(resolve('package.json'), 'utf8'),
      execFile(
        process.execPath,
        [resolve('scripts/verify-package-install.mjs'), '--check-report'],
        {
          cwd: resolve('.'),
          encoding: 'utf8',
        },
      ),
    ]);
    const contract = JSON.parse(contractText) as CleanRoomContract;
    const report = JSON.parse(reportText) as CleanRoomReport;
    const manifest = JSON.parse(manifestText) as {
      readonly private: boolean;
      readonly scripts: Readonly<Record<string, string>>;
    };
    const contents = JSON.parse(
      Object.hasOwn(manifest, 'private') ? privateContentsText : publicContentsText,
    ) as {
      readonly archive: CleanRoomReport['package'];
    };

    expect(contract).toMatchObject({
      schemaVersion: '1.0.0',
      packageName: '@fakrulauzaie/api-intel',
      packageVersion: '0.1.0-alpha.1',
      packageManagers: ['npm', 'pnpm'],
    });
    expect(report).toMatchObject({
      schemaVersion: '1.0.0',
      package: {
        name: contract.packageName,
        version: contract.packageVersion,
        fileCount: contents.archive.fileCount,
        packedBytes: contents.archive.packedBytes,
        unpackedBytes: contents.archive.unpackedBytes,
        shasum: contents.archive.shasum,
        integrity: contents.archive.integrity,
      },
      environment: {
        platform: 'win32',
        architecture: 'x64',
        node: 'v22.13.1',
        npm: '10.9.2',
        pnpm: '11.21.0',
      },
      isolation: {
        consumerLocation: 'operating_system_temporary_directory',
        sourceWorkspaceNodeModulesUsed: false,
        targetApplicationExecuted: false,
        packageInstallScriptsExecuted: false,
      },
      expected: contract.expected,
    });
    expect(report.consumers.map(({ manager }) => manager)).toEqual(contract.packageManagers);
    expect(JSON.stringify(report)).not.toMatch(
      /(?:[A-Za-z]:\\Users\\[^"\s]+|\/(?:Users|home)\/[^/"\s]+)/u,
    );
    expect(manifest.private === true || !Object.hasOwn(manifest, 'private')).toBe(true);
    expect(manifest.scripts).toMatchObject({
      'pack:clean-room:check':
        'npm run pack:contents:check && node scripts/verify-package-install.mjs --check',
      'pack:clean-room:write':
        'npm run pack:contents:check && node scripts/verify-package-install.mjs --write',
      'pack:clean-room:report': 'node scripts/verify-package-install.mjs --check-report',
    });
    expect(verification.stdout).toBe(
      `Clean-room report verified: ${contract.packageManagers.length} package managers, ` +
        `${report.package.fileCount} installed package files.\n`,
    );
  });

  it('proves the installed semantic surfaces and bounded negative behavior', async () => {
    const [contractText, reportText, fixture, missingFixture, configuration, verifier] =
      await Promise.all([
        readFile(resolve('packaging/npm/clean-room-contract.json'), 'utf8'),
        readFile(resolve('packaging/npm/clean-room-install-report.json'), 'utf8'),
        readFile(resolve('packaging/npm/fixtures/clean-room/src/orders.ts.txt'), 'utf8'),
        readFile(resolve('packaging/npm/fixtures/clean-room/missing-dependency.ts.txt'), 'utf8'),
        readFile(resolve('packaging/npm/fixtures/clean-room/api-intel.config.json'), 'utf8'),
        readFile(resolve('scripts/verify-package-install.mjs'), 'utf8'),
      ]);
    const contract = JSON.parse(contractText) as CleanRoomContract;
    const report = JSON.parse(reportText) as CleanRoomReport;

    for (const consumer of report.consumers) {
      expect(consumer).toMatchObject({
        installScriptsExecuted: false,
        consumerRootOutsideSourceWorkspace: true,
        runtimePathsOutsideSourceWorkspace: true,
        installedPackageFiles: report.package.fileCount,
        runtimeDependencies: ['cytoscape', 'libpgQueryWasm', 'mcpServer', 'typescript', 'zod'],
        bins: {
          apiIntel: contract.expected.cliVersion,
          apiIntelMcp: contract.expected.mcpVersion,
          shims: ['api-intel', 'api-intel-mcp'],
        },
        initialization: {
          schemaVersion: contract.expected.initializationSchemaVersion,
          previewResult: 'ready',
          writeResult: 'written',
          existingConfigurationExitCode: contract.expected.existingConfigurationExitCode,
          configuration: contract.expected.initialConfiguration,
          absoluteConsumerPathExposed: false,
          headlessGraphGenerated: true,
        },
        doctor: {
          schemaVersion: contract.expected.doctorSchemaVersion,
          result: contract.expected.doctorResult,
          repository: '<repository>',
          runtimeAssetsReady: true,
          nestDeclarationsResolved: true,
          absoluteConsumerPathExposed: false,
        },
        schemas: { rootImport: 'blocked', deepImport: 'blocked' },
        scan: {
          resultState: 'completed',
          schemaVersion: contract.expected.analysisSchemaVersion,
          endpoints: 1,
          handler: contract.expected.endpoint.handler,
          rawSql: contract.expected.rawSql,
          graph: {
            file: contract.expected.graphFile,
            externalScriptOrStylesheetReferences: 0,
            browserPreviewRequested: false,
          },
        },
        mcp: {
          protocolVersion: contract.expected.mcpProtocolVersion,
          tools: contract.expected.mcpTools,
        },
        negatives: {
          missingDependency: {
            exitCode: 0,
            resultState: contract.expected.missingDependency.resultState,
            diagnosticCode: contract.expected.missingDependency.diagnosticCode,
            stackTrace: false,
          },
          invalidTsconfig: {
            exitCode: contract.expected.invalidTsconfig.exitCode,
            messageCategory: 'TypeScript configuration could not be parsed',
            stackTrace: false,
          },
        },
      });
    }
    expect(fixture).toContain("@Controller('orders')");
    expect(fixture).toContain('@Post()');
    expect(fixture).toContain('SELECT id, status FROM order_record');
    expect(missingFixture).toContain("from '@nestjs/common-not-installed'");
    expect(configuration).toContain(
      './node_modules/@fakrulauzaie/api-intel/schemas/api-intel.config.schema.json',
    );
    expect(verifier).toContain("'--ignore-scripts'");
    expect(verifier).toContain("'api-intel-o2-3-'");
  });

  it('documents OD0 as exact-environment package evidence, not clean-source proof', async () => {
    const [guide, surface, configuration, boundary, index, plan, changelog] = await Promise.all([
      readFile(resolve('docs/clean-room-package-installation.md'), 'utf8'),
      readFile(resolve('docs/npm-package-surface.md'), 'utf8'),
      readFile(resolve('docs/project-configuration.md'), 'utf8'),
      readFile(resolve('docs/public-release-boundary.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('CHANGELOG.md'), 'utf8'),
    ]);

    expect(guide).toContain('Gate OD0 remains the source-archive proof.');
    expect(guide).toMatch(/O5\.3 separately passed the exact published\s+package/u);
    expect(surface).toContain('[published release verification]');
    expect(configuration).toContain('isolated npm and pnpm consumers');
    expect(boundary).toContain('passed npm and pnpm probes');
    expect(index).toContain('[Clean-room package installation]');
    expect(plan).toMatch(/### Phase O2\.3[\s\S]*?Status: complete/u);
    expect(plan).toContain('Gate OD0 passes for this exact environment.');
    expect(changelog).toContain('isolated npm and pnpm consumers');
  });
});
