import { z } from 'zod';
import {
  contentHashSchema,
  repositoryRelativePathSchema,
  stableIdSchema,
} from '../model/schemas.js';
import {
  CI_PACKAGE_MANAGERS,
  CI_SCAN_RECIPE_SCHEMA_VERSION,
  type CiScanRecipeManifest,
} from './recipe-model.js';

const nonEmptyString = z.string().min(1);
const positiveInteger = z.number().int().positive();
const exactVersion = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u,
    'Expected an exact package-manager version, not a range or tag.',
  );

const toolSchema = z
  .object({ name: nonEmptyString, version: nonEmptyString, typescriptVersion: nonEmptyString })
  .strict();

const analysisProvenanceSchema = z
  .object({
    analysisId: stableIdSchema,
    schemaVersion: nonEmptyString,
    resultState: z.enum(['completed', 'completed_with_gaps']),
    repositoryRevision: nonEmptyString.nullable(),
    tool: toolSchema,
    configurationFingerprint: contentHashSchema,
    artifactFingerprint: contentHashSchema,
    sourceFileCount: z.number().int().nonnegative(),
  })
  .strict();

export const ciDependencyInstallPlanSchema = z
  .object({
    packageManager: z.enum(CI_PACKAGE_MANAGERS),
    packageManagerVersion: exactVersion,
    lockfilePath: repositoryRelativePathSchema,
    lockfileFingerprint: contentHashSchema,
    command: z
      .object({
        executable: z.enum(CI_PACKAGE_MANAGERS),
        arguments: z.array(nonEmptyString),
      })
      .strict(),
    lifecycleScripts: z.literal('disabled'),
    lockfileMode: z.literal('immutable'),
  })
  .strict()
  .superRefine((plan, context) => {
    const expectedLockfile =
      plan.packageManager === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json';
    if (plan.lockfilePath.split('/').at(-1) !== expectedLockfile) {
      context.addIssue({
        code: 'custom',
        path: ['lockfilePath'],
        message: `Expected a ${expectedLockfile} lockfile for ${plan.packageManager}.`,
      });
    }
    const expectedArguments =
      plan.packageManager === 'pnpm'
        ? ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile']
        : ['ci', '--ignore-scripts'];
    if (
      plan.command.executable !== plan.packageManager ||
      plan.command.arguments.length !== expectedArguments.length ||
      plan.command.arguments.some((argument, index) => argument !== expectedArguments[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['command'],
        message: `Expected the fixed ${plan.packageManager} immutable no-scripts install command.`,
      });
    }
  });

export const ciTopologyProvenanceSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('not_applicable'), fingerprint: z.null() }).strict(),
  z.object({ state: z.literal('supplied'), fingerprint: contentHashSchema }).strict(),
]);

const nodePolicySchema = z
  .object({
    declaredRange: nonEmptyString,
    minimum: z
      .object({
        major: positiveInteger,
        minor: z.number().int().nonnegative(),
        patch: z.number().int().nonnegative(),
      })
      .strict(),
    maximumMajorExclusive: positiveInteger,
  })
  .strict()
  .refine(
    ({ minimum, maximumMajorExclusive }) => minimum.major < maximumMajorExclusive,
    'Minimum Node version must precede the exclusive maximum major.',
  )
  .refine(
    ({ declaredRange, minimum, maximumMajorExclusive }) => {
      const minimumParts = [minimum.major, minimum.minor, minimum.patch];
      while (minimumParts.length > 1 && minimumParts.at(-1) === 0) minimumParts.pop();
      return declaredRange === `>=${minimumParts.join('.')} <${maximumMajorExclusive}`;
    },
    {
      path: ['declaredRange'],
      message: 'Declared Node range must exactly describe the structured minimum and maximum.',
    },
  );

const isolatedAcquisitionSchema = z
  .object({
    kind: z.literal('isolated_scan'),
    workspaceIsolationKey: nonEmptyString.max(256),
    dependencies: ciDependencyInstallPlanSchema,
  })
  .strict();

const trustedArtifactAcquisitionSchema = z
  .object({
    kind: z.literal('trusted_artifact'),
    workspaceIsolationKey: z.null(),
    dependencies: ciDependencyInstallPlanSchema,
  })
  .strict();

export const ciScanRecipeManifestSchema: z.ZodType<CiScanRecipeManifest> = z
  .object({
    schemaVersion: z.literal(CI_SCAN_RECIPE_SCHEMA_VERSION),
    recipeId: stableIdSchema,
    evaluationId: stableIdSchema,
    engine: z
      .object({
        name: nonEmptyString,
        version: nonEmptyString,
        distributionFingerprint: contentHashSchema,
        node: nodePolicySchema,
      })
      .strict(),
    projectConfiguration: z
      .object({
        path: repositoryRelativePathSchema,
        contentFingerprint: contentHashSchema,
        effectiveAnalysisFingerprint: contentHashSchema,
      })
      .strict(),
    topology: ciTopologyProvenanceSchema,
    baseline: z
      .object({
        analysis: analysisProvenanceSchema,
        acquisition: z.union([isolatedAcquisitionSchema, trustedArtifactAcquisitionSchema]),
      })
      .strict(),
    candidate: z
      .object({ analysis: analysisProvenanceSchema, acquisition: isolatedAcquisitionSchema })
      .strict(),
    baselineCache: z
      .object({
        key: contentHashSchema,
        policy: z.literal('trusted_writer_candidate_read_only'),
      })
      .strict(),
    trust: z
      .object({
        baseline: z.literal('trusted'),
        candidate: z.literal('untrusted'),
        forkSecrets: z.literal('none'),
        candidateTokenPermission: z.literal('read_only'),
      })
      .strict(),
  })
  .strict();
