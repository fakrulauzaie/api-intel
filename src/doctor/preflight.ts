import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rmdir, stat, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import {
  DEFAULT_ANALYSIS_CONFIGURATION,
  DEFAULT_INTERACTION_TRAVERSAL_CONFIGURATION,
} from '../config/analysis-config.js';
import {
  loadProjectConfigurationForScan,
  type LoadedProjectConfiguration,
} from '../config/project-config.js';
import { locateCytoscapeBrowserSource } from '../graph-report/html.js';
import { canonicalStringify } from '../model/ordering.js';
import { inventoryRepository, type RepositoryInventory } from '../scanner/inventory.js';
import { loadTypeScriptProject, type TypeScriptProject } from '../ts-index/program.js';
import { TOOL_VERSION } from '../version.js';
import {
  DOCTOR_SCHEMA_VERSION,
  doctorResult,
  type DoctorCapabilitySummary,
  type DoctorCheck,
  type DoctorCheckCode,
  type DoctorConfigurationSummary,
  type DoctorDocument,
  type DoctorExtractorCapability,
  type DoctorFramework,
} from './model.js';
import { doctorDocumentSchema } from './schemas.js';

const require = createRequire(import.meta.url);

const RECOGNIZED_PACKAGES = [
  '@nestjs/axios',
  '@nestjs/bull',
  '@nestjs/bullmq',
  '@nestjs/common',
  '@nestjs/config',
  '@nestjs/core',
  '@nestjs/event-emitter',
  '@nestjs/microservices',
  '@nestjs/typeorm',
  'axios',
  'bullmq',
  'ioredis',
  'redlock',
  'typeorm',
  'undici',
] as const;

const RECOGNIZED_PACKAGE_SET = new Set<string>(RECOGNIZED_PACKAGES);

const VERIFIED_PACKAGE_VERSIONS = new Map<string, string>([
  ['@nestjs/common', '11.2.1'],
  ['@nestjs/core', '11.2.1'],
  ['@nestjs/typeorm', '11.0.3'],
  ['typeorm', '1.1.0'],
]);

const EXPECTED_FAMILIES = [
  { id: 'bullmq_job_queues', packages: ['@nestjs/bullmq', '@nestjs/bull', 'bullmq'] },
  { id: 'in_process_events', packages: ['@nestjs/event-emitter'] },
  { id: 'nestjs_microservices', packages: ['@nestjs/microservices'] },
  { id: 'outbound_http_clients', packages: ['@nestjs/axios', 'axios', 'undici'] },
  { id: 'redis_and_redlock', packages: ['ioredis', 'redlock'] },
  { id: 'typeorm_persistence', packages: ['@nestjs/typeorm', 'typeorm'] },
] as const;

export interface DoctorOptions {
  readonly repositoryRoot: string;
  readonly tsconfigPath?: string;
  readonly explicitConfigurationPath?: string;
  readonly configurationDisabled?: boolean;
  readonly outputDirectory?: string;
  readonly probeOutput?: boolean;
  readonly signal?: AbortSignal;
}

function check(
  code: DoctorCheckCode,
  status: DoctorCheck['status'],
  summary: string,
  remediation: string | null = null,
  facts: DoctorCheck['facts'] = {},
): DoctorCheck {
  return { code, status, summary, remediation, facts };
}

function safeRelativePath(repositoryRoot: string, path: string): string {
  const candidate = resolve(path);
  const relativePath = relative(resolve(repositoryRoot), candidate);
  if (
    relativePath === '' ||
    (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
  ) {
    return relativePath === '' ? '.' : relativePath.replaceAll('\\', '/');
  }
  return '<external-path>';
}

function packageNameFromSpecifier(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
}

function packageRootFromDeclaration(declarationPath: string, packageName: string): string | null {
  const normalized = resolve(declarationPath).replaceAll('\\', '/');
  const marker = `/node_modules/${packageName}/`;
  const index = normalized.toLowerCase().lastIndexOf(marker.toLowerCase());
  return index < 0 ? null : normalized.slice(0, index + marker.length - 1);
}

async function packageVersionFromDeclarations(
  declarationPaths: readonly string[],
  packageName: string,
): Promise<string | null> {
  for (const declarationPath of declarationPaths) {
    const packageRoot = packageRootFromDeclaration(declarationPath, packageName);
    if (packageRoot === null) continue;
    try {
      const value = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
        version?: unknown;
      };
      if (typeof value.version === 'string') return value.version;
    } catch {
      // A TypeScript-resolved declaration still proves identity; version evidence is optional.
    }
  }
  return null;
}

async function recognizeFrameworks(
  inventory: RepositoryInventory,
  project: TypeScriptProject,
): Promise<DoctorFramework[]> {
  const declarationsByPackage = new Map<string, Set<string>>();
  for (const source of inventory.sourceFiles) {
    const sourceFile = project.program.getSourceFile(source.absolutePath);
    if (sourceFile === undefined) continue;
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const moduleSpecifier = statement.moduleSpecifier;
      if (moduleSpecifier === undefined || !ts.isStringLiteralLike(moduleSpecifier)) continue;
      const packageName = packageNameFromSpecifier(moduleSpecifier.text);
      if (!RECOGNIZED_PACKAGE_SET.has(packageName)) continue;
      const symbol = project.checker.getSymbolAtLocation(moduleSpecifier);
      const declarationPaths = (symbol?.declarations ?? []).map(
        (declaration) => declaration.getSourceFile().fileName,
      );
      if (declarationPaths.length === 0) continue;
      const paths = declarationsByPackage.get(packageName) ?? new Set<string>();
      for (const declarationPath of declarationPaths) paths.add(declarationPath);
      declarationsByPackage.set(packageName, paths);
    }
  }

  const frameworks: DoctorFramework[] = [];
  for (const [packageName, paths] of [...declarationsByPackage].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const version = await packageVersionFromDeclarations([...paths].sort(), packageName);
    frameworks.push({
      packageName,
      version,
      declarationResolution: 'typescript_resolved',
      compatibility:
        version !== null && VERIFIED_PACKAGE_VERSIONS.get(packageName) === version
          ? 'verified'
          : 'unverified',
    });
  }
  return frameworks;
}

function configurationSummary(
  repositoryRoot: string,
  configuration: LoadedProjectConfiguration | undefined,
  invalid: boolean,
): DoctorConfigurationSummary {
  const interactions =
    configuration?.analysis.interactions ?? DEFAULT_INTERACTION_TRAVERSAL_CONFIGURATION;
  return {
    source: invalid ? 'invalid' : (configuration?.sourceKind ?? 'none'),
    fileVersion: configuration?.fileVersion ?? null,
    path: configuration === undefined ? null : safeRelativePath(repositoryRoot, configuration.path),
    maxCallDepth:
      configuration?.analysis.maxCallDepth ?? DEFAULT_ANALYSIS_CONFIGURATION.maxCallDepth,
    rawSqlDialect: configuration?.analysis.rawSqlDialect ?? null,
    maxInteractionHops: interactions.maxInteractionHops,
    maxFanOutPerInteraction: interactions.maxFanOutPerInteraction,
    maxInteractionTraceStates: interactions.maxInteractionTraceStates,
  };
}

function extractorCapabilities(
  frameworks: readonly DoctorFramework[],
  configuration: DoctorConfigurationSummary,
): DoctorExtractorCapability[] {
  const observed = new Set(frameworks.map(({ packageName }) => packageName));
  const packages = (...names: string[]): string[] =>
    names.filter((name) => observed.has(name)).sort();
  return [
    {
      id: 'nestjs_endpoints_guards_contracts',
      enabled: true,
      activation: 'always',
      observedPackages: packages('@nestjs/common', '@nestjs/core'),
    },
    {
      id: 'call_graph_and_request_lineage',
      enabled: true,
      activation: 'always',
      observedPackages: packages('@nestjs/common'),
    },
    {
      id: 'typeorm_persistence_and_query_builder',
      enabled: true,
      activation: 'always',
      observedPackages: packages('@nestjs/typeorm', 'typeorm'),
    },
    {
      id: 'outbound_http',
      enabled: true,
      activation: 'always',
      observedPackages: packages('@nestjs/axios', 'axios', 'undici'),
    },
    {
      id: 'in_process_events',
      enabled: true,
      activation: 'always',
      observedPackages: packages('@nestjs/event-emitter'),
    },
    {
      id: 'bullmq_job_queues',
      enabled: true,
      activation: 'always',
      observedPackages: packages('@nestjs/bullmq', '@nestjs/bull', 'bullmq'),
    },
    {
      id: 'nestjs_microservices',
      enabled: true,
      activation: 'always',
      observedPackages: packages('@nestjs/microservices'),
    },
    {
      id: 'redis_and_verified_lock_sections',
      enabled: true,
      activation: 'always',
      observedPackages: packages('ioredis', 'redlock'),
    },
    {
      id: 'postgresql_raw_sql',
      enabled: configuration.rawSqlDialect !== null,
      activation: 'configuration',
      observedPackages: packages('typeorm'),
    },
  ];
}

function capabilitySummary(
  frameworks: readonly DoctorFramework[],
  configuration: DoctorConfigurationSummary,
): DoctorCapabilitySummary {
  const observed = new Set(frameworks.map(({ packageName }) => packageName));
  return {
    extractors: extractorCapabilities(frameworks, configuration),
    recognizedFrameworks: frameworks,
    expectedUnavailableFamilies: EXPECTED_FAMILIES.filter(({ packages }) =>
      packages.every((packageName) => !observed.has(packageName)),
    ).map(({ id }) => id),
    configuration,
  };
}

function nodeRuntimeCheck(): DoctorCheck {
  const [majorText, minorText] = process.versions.node.split('.');
  const major = Number(majorText);
  const minor = Number(minorText);
  const supported = (major === 22 && minor >= 13) || major === 23 || major === 24;
  return supported
    ? check(
        'DOCTOR_NODE_RUNTIME_SUPPORTED',
        'pass',
        'Node.js is inside the declared engine range.',
        null,
        {
          nodeVersion: process.versions.node,
          supportedRange: '>=22.13 <25',
        },
      )
    : check(
        'DOCTOR_NODE_RUNTIME_UNSUPPORTED',
        'failure',
        'Node.js is outside the declared engine range.',
        'Run api-intel with Node.js >=22.13 and <25.',
        { nodeVersion: process.versions.node, supportedRange: '>=22.13 <25' },
      );
}

async function runtimeAssetCheck(): Promise<DoctorCheck> {
  const probes = [
    '@modelcontextprotocol/server',
    'libpg-query/wasm/index.js',
    'libpg-query/wasm/libpg-query.wasm',
    'typescript',
    'zod',
  ];
  const missing: string[] = [];
  for (const probe of probes) {
    try {
      require.resolve(probe);
    } catch {
      missing.push(probe);
    }
  }
  try {
    await locateCytoscapeBrowserSource();
  } catch {
    missing.push('cytoscape/dist/cytoscape.min.js');
  }
  return missing.length === 0
    ? check(
        'DOCTOR_RUNTIME_ASSETS_READY',
        'pass',
        'All required api-intel runtime assets resolve.',
        null,
        {
          assetCount: probes.length + 1,
        },
      )
    : check(
        'DOCTOR_RUNTIME_ASSETS_MISSING',
        'failure',
        'One or more required api-intel runtime assets cannot be resolved.',
        'Reinstall the exact api-intel package from a trusted distribution and rerun doctor.',
        { missingAssets: missing.sort().join(', ') },
      );
}

async function nearestExistingDirectory(path: string): Promise<string | null> {
  let candidate = resolve(path);
  while (true) {
    try {
      const metadata = await stat(candidate);
      return metadata.isDirectory() ? candidate : null;
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return null;
      candidate = parent;
    }
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
  );
}

async function probeOutputDirectory(outputDirectory: string): Promise<DoctorCheck> {
  const absoluteOutput = resolve(outputDirectory);
  const existingAncestor = await nearestExistingDirectory(absoluteOutput);
  if (existingAncestor === null) {
    return check(
      'DOCTOR_OUTPUT_PROBE_FAILED',
      'failure',
      'No existing output-path ancestor could be inspected.',
      'Choose an output path below an existing writable directory.',
    );
  }

  const missingDirectories: string[] = [];
  let cursor = absoluteOutput;
  while (cursor !== existingAncestor) {
    if (!isContainedPath(existingAncestor, cursor)) {
      return check(
        'DOCTOR_OUTPUT_PROBE_FAILED',
        'failure',
        'The bounded output probe could not validate its target.',
        'Choose a normal local output directory and rerun doctor.',
      );
    }
    missingDirectories.push(cursor);
    cursor = dirname(cursor);
  }

  const probePath = join(absoluteOutput, `.api-intel-doctor-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let writeFailure = false;
  let cleanupFailure = false;
  try {
    await mkdir(absoluteOutput, { recursive: true });
    handle = await open(probePath, 'wx', 0o600);
    await handle.writeFile('api-intel doctor output probe\n', 'utf8');
    await handle.sync();
  } catch {
    writeFailure = true;
  } finally {
    try {
      await handle?.close();
    } catch {
      cleanupFailure = true;
    }
    try {
      await unlink(probePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupFailure = true;
    }
    for (const directory of missingDirectories) {
      try {
        await rmdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupFailure = true;
      }
    }
  }

  if (cleanupFailure) {
    return check(
      'DOCTOR_OUTPUT_PROBE_CLEANUP_FAILED',
      'failure',
      'The explicit output probe could not fully remove its temporary state.',
      'Inspect the configured output directory and remove only .api-intel-doctor-* probe files.',
    );
  }
  if (writeFailure) {
    return check(
      'DOCTOR_OUTPUT_PROBE_FAILED',
      'failure',
      'The explicit create/delete probe could not write the resolved output directory.',
      'Choose a writable output directory or update its permissions.',
    );
  }
  return check(
    'DOCTOR_OUTPUT_PROBE_PASSED',
    'pass',
    'A bounded temporary file was created, flushed, and removed in the output directory.',
    null,
    { cleanupComplete: true },
  );
}

async function outputMetadataCheck(outputDirectory: string): Promise<DoctorCheck> {
  const absoluteOutput = resolve(outputDirectory);
  try {
    const metadata = await stat(absoluteOutput);
    if (!metadata.isDirectory()) {
      return check(
        'DOCTOR_OUTPUT_PATH_NOT_DIRECTORY',
        'failure',
        'The resolved output path exists but is not a directory.',
        'Choose a directory with --output or update project configuration.',
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return check(
        'DOCTOR_OUTPUT_METADATA_UNREADABLE',
        'warning',
        'Output-path metadata could not be inspected without writing.',
        'Review path permissions or rerun with --probe-output for a bounded create/delete test.',
      );
    }
  }
  const ancestor = await nearestExistingDirectory(absoluteOutput);
  if (ancestor === null) {
    return check(
      'DOCTOR_OUTPUT_METADATA_UNREADABLE',
      'warning',
      'No existing output-path ancestor could be inspected.',
      'Choose an output path below an existing directory.',
    );
  }
  try {
    await access(ancestor, constants.W_OK);
    return check(
      'DOCTOR_OUTPUT_METADATA_ONLY',
      'warning',
      'OS metadata indicates a writable output-path ancestor; no create/delete was attempted.',
      'Use --probe-output only when explicit writability proof is required.',
      { createDeleteProven: false },
    );
  } catch {
    return check(
      'DOCTOR_OUTPUT_PERMISSION_UNCONFIRMED',
      'warning',
      'OS metadata does not indicate write permission for the output-path ancestor.',
      'Choose another output path or use --probe-output for a bounded create/delete test.',
      { createDeleteProven: false },
    );
  }
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorDocument> {
  const repositoryRoot = resolve(options.repositoryRoot);
  const checks: DoctorCheck[] = [nodeRuntimeCheck()];
  checks.push(await runtimeAssetCheck());

  let configuration: LoadedProjectConfiguration | undefined;
  let configurationInvalid = false;
  try {
    configuration = await loadProjectConfigurationForScan({
      repositoryRoot,
      ...(options.explicitConfigurationPath === undefined
        ? {}
        : { explicitPath: options.explicitConfigurationPath }),
      ...(options.configurationDisabled === undefined
        ? {}
        : { disabled: options.configurationDisabled }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    checks.push(
      configuration === undefined
        ? check(
            'DOCTOR_CONFIGURATION_DEFAULTS',
            'pass',
            'No project configuration was selected; strict built-in defaults apply.',
          )
        : check(
            'DOCTOR_CONFIGURATION_READY',
            'pass',
            'Project configuration parsed and normalized successfully.',
            null,
            {
              fileVersion: configuration.fileVersion,
              source: configuration.sourceKind,
            },
          ),
    );
  } catch {
    options.signal?.throwIfAborted();
    configurationInvalid = true;
    checks.push(
      check(
        'DOCTOR_CONFIGURATION_INVALID',
        'failure',
        'Project configuration is unreadable, malformed, or outside its strict schema.',
        'Run with --no-config to isolate the problem, or correct the selected api-intel.config.json.',
      ),
    );
  }

  const normalizedConfiguration = configurationSummary(
    repositoryRoot,
    configuration,
    configurationInvalid,
  );
  const outputDirectory =
    options.outputDirectory ?? configuration?.outputDirectory ?? join(repositoryRoot, '.api-intel');

  let inventory: RepositoryInventory | undefined;
  let project: TypeScriptProject | undefined;
  let frameworks: DoctorFramework[] = [];
  try {
    inventory = await inventoryRepository({ repositoryRoot, repositoryRevision: null });
    checks.push(
      inventory.sourceFiles.length > 0
        ? check('DOCTOR_REPOSITORY_READY', 'pass', 'Repository source inventory completed.', null, {
            sourceFiles: inventory.sourceFiles.length,
            skippedEntries: inventory.skippedEntries.length,
          })
        : check(
            'DOCTOR_REPOSITORY_NO_TYPESCRIPT',
            'failure',
            'The safe repository inventory found no TypeScript source files.',
            'Check the repository path, source extensions, exclusions, and source-file size limits.',
          ),
    );
  } catch {
    options.signal?.throwIfAborted();
    checks.push(
      check(
        'DOCTOR_REPOSITORY_UNAVAILABLE',
        'failure',
        'The repository path does not resolve to a readable directory.',
        'Pass an existing readable repository directory.',
      ),
    );
  }

  if (inventory !== undefined && inventory.sourceFiles.length > 0) {
    try {
      project = await loadTypeScriptProject({
        repositoryRoot,
        inventory,
        ...(options.tsconfigPath === undefined ? {} : { tsconfigPath: options.tsconfigPath }),
      });
      checks.push(
        check(
          'DOCTOR_TYPESCRIPT_PROGRAM_READY',
          'pass',
          'TypeScript program inputs resolved without executing target code.',
          null,
          {
            compilerInputs: project.parsedCommandLine.fileNames.length,
            tsconfig: safeRelativePath(repositoryRoot, project.tsconfigPath),
          },
        ),
      );
      const unresolved = project.diagnostics.filter(
        ({ canonicalCode, category }) =>
          canonicalCode === 'TS_IMPORT_UNRESOLVED' && category === 'error',
      );
      const structural = project.diagnostics.filter(
        ({ origin, category }) =>
          category === 'error' &&
          (origin === 'configuration' ||
            origin === 'options' ||
            origin === 'global' ||
            origin === 'syntactic'),
      );
      const other = project.diagnostics.filter(
        (diagnostic) =>
          diagnostic.category === 'error' &&
          !unresolved.includes(diagnostic) &&
          !structural.includes(diagnostic),
      );
      checks.push(
        unresolved.length > 0
          ? check(
              'DOCTOR_TYPESCRIPT_IMPORTS_UNRESOLVED',
              'failure',
              'TypeScript could not resolve one or more imported declarations.',
              'Install the target repository dependencies using its lockfile, or correct tsconfig module resolution.',
              { unresolvedImports: unresolved.length },
            )
          : check(
              'DOCTOR_TYPESCRIPT_IMPORTS_RESOLVED',
              'pass',
              'TypeScript reported no unresolved imported declarations.',
            ),
      );
      checks.push(
        structural.length > 0
          ? check(
              'DOCTOR_TYPESCRIPT_STRUCTURE_INVALID',
              'failure',
              'TypeScript reported configuration, option, global, or syntax errors.',
              'Run the target TypeScript compiler with the selected tsconfig and correct structural errors.',
              { structuralErrors: structural.length },
            )
          : other.length > 0
            ? check(
                'DOCTOR_TYPESCRIPT_SEMANTIC_WARNINGS',
                'warning',
                'The TypeScript program resolved but contains other semantic errors.',
                'Review target compiler diagnostics; scans may complete with proof gaps.',
                { semanticErrors: other.length },
              )
            : check(
                'DOCTOR_TYPESCRIPT_DIAGNOSTICS_CLEAR',
                'pass',
                'TypeScript reported no error diagnostics.',
              ),
      );
      frameworks = await recognizeFrameworks(inventory, project);
      const nestCommon = frameworks.some(({ packageName }) => packageName === '@nestjs/common');
      checks.push(
        nestCommon
          ? check(
              'DOCTOR_NESTJS_DECLARATIONS_RESOLVED',
              'pass',
              'NestJS declarations are proven through TypeScript-resolved imports.',
              null,
              { recognizedPackages: frameworks.length },
            )
          : check(
              'DOCTOR_NESTJS_DECLARATIONS_NOT_OBSERVED',
              'warning',
              'No TypeScript-resolved @nestjs/common import was observed in inventoried source.',
              'Confirm this is a NestJS application and that the selected tsconfig includes its source.',
            ),
      );
      const unverified = frameworks.filter(({ compatibility }) => compatibility === 'unverified');
      checks.push(
        unverified.length === 0
          ? check(
              'DOCTOR_FRAMEWORK_VERSIONS_VERIFIED',
              'pass',
              'Every recognized framework package version is covered by exact retained evidence.',
            )
          : check(
              'DOCTOR_FRAMEWORK_VERSIONS_UNVERIFIED',
              'warning',
              'One or more resolved framework versions lack exact retained compatibility evidence.',
              'Treat results as unverified compatibility and report the smallest reproducible proof gap if encountered.',
              {
                packages: unverified
                  .map(({ packageName }) => packageName)
                  .sort()
                  .join(', '),
              },
            ),
      );
    } catch {
      options.signal?.throwIfAborted();
      checks.push(
        check(
          'DOCTOR_TYPESCRIPT_PROGRAM_FAILED',
          'failure',
          'The selected TypeScript project could not be constructed safely.',
          'Verify --tsconfig points to a single-project config inside the repository and includes only inventoried source.',
        ),
      );
    }
  }

  checks.push(
    options.probeOutput === true
      ? await probeOutputDirectory(outputDirectory)
      : await outputMetadataCheck(outputDirectory),
  );

  const capabilities = capabilitySummary(frameworks, normalizedConfiguration);
  return doctorDocumentSchema.parse({
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    tool: { name: 'api-intel', version: TOOL_VERSION },
    result: doctorResult(checks),
    repository: '<repository>',
    checks,
    capabilities,
  });
}

export function renderDoctorJson(document: DoctorDocument): string {
  return canonicalStringify(document).trimEnd();
}

export function renderDoctorText(document: DoctorDocument): string {
  const lines = [`api-intel doctor: ${document.result}`, 'Repository: <repository>', '', 'Checks:'];
  for (const current of document.checks) {
    lines.push(`[${current.status.toUpperCase()}] ${current.code} - ${current.summary}`);
    if (current.remediation !== null) lines.push(`  Remediation: ${current.remediation}`);
  }
  lines.push('', 'Capabilities:');
  for (const extractor of document.capabilities.extractors) {
    const observation =
      extractor.observedPackages.length === 0
        ? 'no framework declaration observed'
        : `observed ${extractor.observedPackages.join(', ')}`;
    lines.push(`- ${extractor.id}: ${extractor.enabled ? 'enabled' : 'disabled'} (${observation})`);
  }
  lines.push(
    `Recognized frameworks: ${document.capabilities.recognizedFrameworks.length}`,
    `Expected unavailable families: ${document.capabilities.expectedUnavailableFamilies.join(', ') || 'none'}`,
  );
  return lines.join('\n');
}
