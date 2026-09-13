import { z } from 'zod';
import { CI_EVALUATION_OUTCOMES } from '../ci-evaluation/model.js';
import {
  contentHashSchema,
  repositoryRelativePathSchema,
  stableIdSchema,
} from '../model/schemas.js';
import {
  GITLAB_CI_ADAPTER_VERSION,
  GITLAB_CI_ARTIFACT_SCHEMA_VERSION,
  GITLAB_CI_MAX_FINDINGS,
  GITLAB_CI_MAX_SUMMARY_BYTES,
  GITLAB_CODE_QUALITY_SEVERITIES,
  type GitLabCiArtifactManifest,
  type GitLabCiProjection,
} from './model.js';

const count = z.number().int().nonnegative();
const digestPinnedImage = z.string().regex(/^.+@sha256:[a-f0-9]{64}$/u);

export const gitLabCodeQualityFindingSchema = z
  .object({
    description: z.string().min(1).max(2_048),
    check_name: z.string().min(1).max(255),
    fingerprint: contentHashSchema,
    severity: z.enum(GITLAB_CODE_QUALITY_SEVERITIES),
    location: z
      .object({
        path: repositoryRelativePathSchema.refine(
          (path) => !path.startsWith('./'),
          'GitLab Code Quality paths must not start with ./.',
        ),
        lines: z.object({ begin: z.number().int().positive() }).strict(),
      })
      .strict(),
  })
  .strict();

export const gitLabCiProjectionSchema: z.ZodType<GitLabCiProjection> = z
  .object({
    adapterVersion: z.literal(GITLAB_CI_ADAPTER_VERSION),
    executionImage: digestPinnedImage,
    evaluationId: stableIdSchema,
    outcome: z.enum(CI_EVALUATION_OUTCOMES),
    summaryMarkdown: z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.byteLength(value) <= GITLAB_CI_MAX_SUMMARY_BYTES,
        'GitLab summary exceeds its byte limit.',
      ),
    findings: z.array(gitLabCodeQualityFindingSchema).max(GITLAB_CI_MAX_FINDINGS),
    findingCount: count.max(GITLAB_CI_MAX_FINDINGS),
    omittedFindingCount: count,
  })
  .strict()
  .refine(
    ({ findings, findingCount }) => findings.length === findingCount,
    'Published finding count does not match the finding collection.',
  );

const artifactFileSchema = z
  .object({
    path: repositoryRelativePathSchema,
    bytes: count,
    contentHash: contentHashSchema,
  })
  .strict();

export const gitLabCiArtifactManifestSchema: z.ZodType<GitLabCiArtifactManifest> = z
  .object({
    schemaVersion: z.literal(GITLAB_CI_ARTIFACT_SCHEMA_VERSION),
    adapterVersion: z.literal(GITLAB_CI_ADAPTER_VERSION),
    executionImage: digestPinnedImage,
    evaluationId: stableIdSchema,
    outcome: z.enum(CI_EVALUATION_OUTCOMES),
    codeQuality: z
      .object({ published: count.max(GITLAB_CI_MAX_FINDINGS), omitted: count })
      .strict(),
    files: z.array(artifactFileSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    const paths = manifest.files.map(({ path }) => path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'Artifact paths must be unique.',
      });
    }
    if (paths.includes('manifest.json')) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'The artifact manifest must not include itself.',
      });
    }
    if (paths.some((path, index) => index > 0 && paths[index - 1]!.localeCompare(path) > 0)) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'Artifact paths must use deterministic lexical ordering.',
      });
    }
  });

export function assertValidGitLabCiProjection(input: unknown): GitLabCiProjection {
  return gitLabCiProjectionSchema.parse(input);
}

export function assertValidGitLabCiArtifactManifest(input: unknown): GitLabCiArtifactManifest {
  return gitLabCiArtifactManifestSchema.parse(input);
}
