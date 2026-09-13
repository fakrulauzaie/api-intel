import { randomUUID } from 'node:crypto';
import { link, lstat, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  PROJECT_CONFIGURATION_VERSION,
  projectConfigurationV4Schema,
} from './config/project-config-schema.js';
import {
  DOCTOR_CHECK_CODES,
  runDoctor,
  type DoctorCheckCode,
  type DoctorDocument,
} from './doctor/index.js';
import { canonicalStringify } from './model/ordering.js';
import { TOOL_VERSION } from './version.js';

export const INITIALIZATION_SCHEMA_VERSION = '1.0.0' as const;
export const PROJECT_CONFIGURATION_FILE = 'api-intel.config.json' as const;

const initializationResultSchema = z.enum([
  'ready',
  'written',
  'blocked',
  'existing_configuration',
]);

const initializationNoticeSchema = z
  .object({
    code: z.enum([
      'INIT_MINIMAL_CONFIGURATION',
      'INIT_SCHEMA_REFERENCE_OMITTED',
      'INIT_OPTIONAL_ANALYSIS_NOT_INFERRED',
      'INIT_PROOF_GAPS_PRESENT',
      'INIT_PREFLIGHT_BLOCKED',
      'INIT_NESTJS_NOT_PROVEN',
      'INIT_EXISTING_CONFIGURATION',
      'INIT_WRITTEN',
      'INIT_WRITE_FAILED',
    ]),
    summary: z.string(),
  })
  .strict();

export const initializationDocumentSchema = z
  .object({
    schemaVersion: z.literal(INITIALIZATION_SCHEMA_VERSION),
    tool: z.object({ name: z.literal('api-intel'), version: z.string() }).strict(),
    result: initializationResultSchema,
    repository: z.literal('<repository>'),
    destination: z.literal(PROJECT_CONFIGURATION_FILE),
    write: z.object({ requested: z.boolean(), performed: z.boolean() }).strict(),
    configuration: projectConfigurationV4Schema,
    configurationText: z.string(),
    preflight: z
      .object({
        result: z.enum(['pass', 'warning', 'failure']),
        blockingCheckCodes: z.array(z.enum(DOCTOR_CHECK_CODES)),
        warningCheckCodes: z.array(z.enum(DOCTOR_CHECK_CODES)),
        recognizedPackages: z.array(z.string()),
        nestjsDeclarationsProven: z.boolean(),
      })
      .strict(),
    notices: z.array(initializationNoticeSchema),
    nextCommands: z
      .object({
        interactive: z.literal('api-intel scan . --with-graph --open'),
        headless: z.literal('api-intel scan . --with-graph'),
        preflight: z.literal('api-intel doctor .'),
      })
      .strict(),
  })
  .strict();

export type InitializationDocument = z.infer<typeof initializationDocumentSchema>;

export interface InitializeProjectOptions {
  readonly repositoryRoot: string;
  readonly tsconfigPath?: string;
  readonly write?: boolean;
  readonly signal?: AbortSignal;
}

const MINIMAL_CONFIGURATION = projectConfigurationV4Schema.parse({
  version: PROJECT_CONFIGURATION_VERSION,
});
const MINIMAL_CONFIGURATION_TEXT = canonicalStringify(MINIMAL_CONFIGURATION);
const PROOF_GAP_WARNING_CODES = new Set<DoctorCheckCode>([
  'DOCTOR_TYPESCRIPT_SEMANTIC_WARNINGS',
  'DOCTOR_NESTJS_DECLARATIONS_NOT_OBSERVED',
  'DOCTOR_FRAMEWORK_VERSIONS_UNVERIFIED',
]);

function orderedCodes(document: DoctorDocument, status: 'failure' | 'warning'): DoctorCheckCode[] {
  return document.checks
    .filter((check) => check.status === status)
    .map(({ code }) => code)
    .sort();
}

function baseDocument(
  doctor: DoctorDocument,
): Omit<InitializationDocument, 'notices' | 'result' | 'write'> {
  const recognizedPackages = doctor.capabilities.recognizedFrameworks
    .map(({ packageName }) => packageName)
    .sort();
  return {
    schemaVersion: INITIALIZATION_SCHEMA_VERSION,
    tool: { name: 'api-intel', version: TOOL_VERSION },
    repository: '<repository>',
    destination: PROJECT_CONFIGURATION_FILE,
    configuration: MINIMAL_CONFIGURATION,
    configurationText: MINIMAL_CONFIGURATION_TEXT,
    preflight: {
      result: doctor.result,
      blockingCheckCodes: orderedCodes(doctor, 'failure'),
      warningCheckCodes: orderedCodes(doctor, 'warning'),
      recognizedPackages,
      nestjsDeclarationsProven: doctor.checks.some(
        ({ code, status }) => code === 'DOCTOR_NESTJS_DECLARATIONS_RESOLVED' && status === 'pass',
      ),
    },
    nextCommands: {
      interactive: 'api-intel scan . --with-graph --open',
      headless: 'api-intel scan . --with-graph',
      preflight: 'api-intel doctor .',
    },
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function writeNewConfiguration(
  path: string,
  signal?: AbortSignal,
): Promise<'written' | 'exists'> {
  signal?.throwIfAborted();
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(MINIMAL_CONFIGURATION_TEXT, 'utf8');
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  try {
    await link(temporaryPath, path);
    return 'written';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function initializeProject(
  options: InitializeProjectOptions,
): Promise<InitializationDocument> {
  const repositoryRoot = resolve(options.repositoryRoot);
  const writeRequested = options.write === true;
  const doctor = await runDoctor({
    repositoryRoot,
    configurationDisabled: true,
    ...(options.tsconfigPath === undefined ? {} : { tsconfigPath: options.tsconfigPath }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const common = baseDocument(doctor);
  const warnings = common.preflight.warningCheckCodes;
  const proofGapWarnings = warnings.filter((code) => PROOF_GAP_WARNING_CODES.has(code));
  const standardNotices: InitializationDocument['notices'] = [
    {
      code: 'INIT_MINIMAL_CONFIGURATION',
      summary: 'The candidate file contains only the current strict configuration version.',
    },
    {
      code: 'INIT_SCHEMA_REFERENCE_OMITTED',
      summary:
        'No schema URL or node_modules location was guessed; editors may associate the shipped schema explicitly.',
    },
    {
      code: 'INIT_OPTIONAL_ANALYSIS_NOT_INFERRED',
      summary:
        'Raw SQL dialects, authorization extensions, policies, output paths, and report defaults remain explicit choices.',
    },
    ...(proofGapWarnings.length === 0
      ? []
      : [
          {
            code: 'INIT_PROOF_GAPS_PRESENT' as const,
            summary: `Preflight retained ${proofGapWarnings.length} analysis proof-gap warning(s); review their codes before relying on coverage.`,
          },
        ]),
  ];

  const destination = join(repositoryRoot, PROJECT_CONFIGURATION_FILE);
  if (await pathExists(destination)) {
    return initializationDocumentSchema.parse({
      ...common,
      result: 'existing_configuration',
      write: { requested: writeRequested, performed: false },
      notices: [
        ...standardNotices,
        {
          code: 'INIT_EXISTING_CONFIGURATION',
          summary: 'An existing configuration was left untouched; init has no overwrite mode.',
        },
      ],
    });
  }

  if (common.preflight.blockingCheckCodes.length > 0) {
    return initializationDocumentSchema.parse({
      ...common,
      result: 'blocked',
      write: { requested: writeRequested, performed: false },
      notices: [
        ...standardNotices,
        {
          code: 'INIT_PREFLIGHT_BLOCKED',
          summary: 'Initialization stopped because doctor reported one or more failure checks.',
        },
      ],
    });
  }

  if (!common.preflight.nestjsDeclarationsProven) {
    return initializationDocumentSchema.parse({
      ...common,
      result: 'blocked',
      write: { requested: writeRequested, performed: false },
      notices: [
        ...standardNotices,
        {
          code: 'INIT_NESTJS_NOT_PROVEN',
          summary:
            'Initialization stopped because TypeScript did not prove a NestJS declaration import.',
        },
      ],
    });
  }

  if (!writeRequested) {
    return initializationDocumentSchema.parse({
      ...common,
      result: 'ready',
      write: { requested: false, performed: false },
      notices: standardNotices,
    });
  }

  try {
    const result = await writeNewConfiguration(destination, options.signal);
    return initializationDocumentSchema.parse({
      ...common,
      result: result === 'written' ? 'written' : 'existing_configuration',
      write: { requested: true, performed: result === 'written' },
      notices: [
        ...standardNotices,
        result === 'written'
          ? {
              code: 'INIT_WRITTEN',
              summary:
                'The minimal configuration was created with exclusive no-overwrite semantics.',
            }
          : {
              code: 'INIT_EXISTING_CONFIGURATION',
              summary:
                'A concurrent configuration creation won the race; that file was left untouched.',
            },
      ],
    });
  } catch {
    options.signal?.throwIfAborted();
    return initializationDocumentSchema.parse({
      ...common,
      result: 'blocked',
      write: { requested: true, performed: false },
      notices: [
        ...standardNotices,
        {
          code: 'INIT_WRITE_FAILED',
          summary: 'The configuration could not be created safely; no overwrite was attempted.',
        },
      ],
    });
  }
}

export function renderInitializationJson(document: InitializationDocument): string {
  return canonicalStringify(document).trimEnd();
}

export function renderInitializationText(document: InitializationDocument): string {
  const lines = [
    `api-intel init: ${document.result}`,
    'Repository: <repository>',
    `Destination: ${document.destination}`,
    `Write requested: ${document.write.requested ? 'yes' : 'no'}`,
    `Write performed: ${document.write.performed ? 'yes' : 'no'}`,
    '',
    'Configuration preview:',
    document.configurationText.trimEnd(),
    '',
    'Preflight:',
    `- NestJS declarations proven: ${document.preflight.nestjsDeclarationsProven ? 'yes' : 'no'}`,
    `- Blocking checks: ${document.preflight.blockingCheckCodes.join(', ') || 'none'}`,
    `- Warning checks: ${document.preflight.warningCheckCodes.join(', ') || 'none'}`,
    '',
    'Notices:',
    ...document.notices.map(({ code, summary }) => `- ${code}: ${summary}`),
    '',
    'Next commands:',
    `- Interactive: ${document.nextCommands.interactive}`,
    `- Headless: ${document.nextCommands.headless}`,
  ];
  return lines.join('\n');
}
