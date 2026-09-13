import { z } from 'zod';
import { CI_EVALUATION_OUTCOMES } from '../ci-evaluation/model.js';
import {
  contentHashSchema,
  repositoryRelativePathSchema,
  stableIdSchema,
} from '../model/schemas.js';
import {
  GITHUB_ACTION_ADAPTER_VERSION,
  GITHUB_ACTION_ARTIFACT_SCHEMA_VERSION,
  GITHUB_ACTION_MAX_ANNOTATIONS,
  GITHUB_ACTION_MAX_SUMMARY_BYTES,
  GITHUB_ANNOTATION_LEVELS,
  type GitHubActionArtifactManifest,
  type GitHubCiProjection,
} from './model.js';

const count = z.number().int().nonnegative();
const coordinate = z.number().int().positive().nullable();

export const githubAnnotationProjectionSchema = z
  .object({
    level: z.enum(GITHUB_ANNOTATION_LEVELS),
    title: z.string().min(1).max(128),
    message: z.string().min(1).max(1_024),
    path: repositoryRelativePathSchema.nullable(),
    startLine: coordinate,
    endLine: coordinate,
    startColumn: coordinate,
    endColumn: coordinate,
    sourceAnnotationId: stableIdSchema,
  })
  .strict()
  .superRefine((annotation, context) => {
    const coordinates = [
      annotation.startLine,
      annotation.endLine,
      annotation.startColumn,
      annotation.endColumn,
    ];
    if (annotation.path === null && coordinates.some((value) => value !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'Job-level annotations must not retain file coordinates.',
      });
    }
    if (
      annotation.path !== null &&
      (annotation.startLine === null || annotation.endLine === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['startLine'],
        message: 'File annotations require a complete line range.',
      });
    }
    if (
      annotation.startLine !== null &&
      annotation.endLine !== null &&
      annotation.endLine < annotation.startLine
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endLine'],
        message: 'Annotation end line must not precede its start line.',
      });
    }
  });

export const githubCiProjectionSchema: z.ZodType<GitHubCiProjection> = z
  .object({
    adapterVersion: z.literal(GITHUB_ACTION_ADAPTER_VERSION),
    evaluationId: stableIdSchema,
    outcome: z.enum(CI_EVALUATION_OUTCOMES),
    summaryMarkdown: z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.byteLength(value) <= GITHUB_ACTION_MAX_SUMMARY_BYTES,
        'GitHub summary exceeds its byte limit.',
      ),
    annotations: z.array(githubAnnotationProjectionSchema).max(GITHUB_ACTION_MAX_ANNOTATIONS),
    annotationCount: count.max(GITHUB_ACTION_MAX_ANNOTATIONS),
    omittedAnnotationCount: count,
  })
  .strict()
  .refine(
    ({ annotations, annotationCount }) => annotations.length === annotationCount,
    'Published annotation count does not match the annotation collection.',
  );

const artifactFileSchema = z
  .object({
    path: repositoryRelativePathSchema,
    bytes: count,
    contentHash: contentHashSchema,
  })
  .strict();

export const githubActionArtifactManifestSchema: z.ZodType<GitHubActionArtifactManifest> = z
  .object({
    schemaVersion: z.literal(GITHUB_ACTION_ARTIFACT_SCHEMA_VERSION),
    adapterVersion: z.literal(GITHUB_ACTION_ADAPTER_VERSION),
    evaluationId: stableIdSchema,
    outcome: z.enum(CI_EVALUATION_OUTCOMES),
    annotations: z
      .object({ published: count.max(GITHUB_ACTION_MAX_ANNOTATIONS), omitted: count })
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

export function assertValidGitHubCiProjection(input: unknown): GitHubCiProjection {
  return githubCiProjectionSchema.parse(input);
}

export function assertValidGitHubActionArtifactManifest(
  input: unknown,
): GitHubActionArtifactManifest {
  return githubActionArtifactManifestSchema.parse(input);
}
