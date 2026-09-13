import { z } from 'zod';
import { ciEvaluationSummarySchema } from '../ci-evaluation/schemas.js';
import {
  CI_ANNOTATION_CATEGORIES,
  CI_ANNOTATION_LEVELS,
  CI_EVALUATION_OUTCOMES,
  CI_EVIDENCE_SIDES,
} from '../ci-evaluation/model.js';
import { repositoryRelativePathSchema, stableIdSchema } from '../model/schemas.js';
import {
  CI_COMMENT_ARTIFACT_KINDS,
  CI_COMMENT_HARD_MAX_ARTIFACT_LINKS,
  CI_COMMENT_HARD_MAX_ITEMS,
  CI_COMMENT_MAX_MARKDOWN_BYTES,
  CI_COMMENT_MIN_MARKDOWN_BYTES,
  CI_COMMENT_PROVIDERS,
  CI_COMMENT_SCHEMA_VERSION,
  CI_COMMENT_UPSERT_KEY,
  CI_COMMENT_UPSERT_MARKER,
  type CiCommentDocument,
} from './model.js';
import { isNormalizedCiCommentHttpsUrl } from './presentation.js';

function byteBoundedString(maximum: number) {
  return z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value) <= maximum, `Must not exceed ${maximum} bytes.`);
}

const count = z.number().int().nonnegative();
const httpsUrl = z
  .string()
  .refine(isNormalizedCiCommentHttpsUrl, 'Expected a normalized credential-free HTTPS URL.');

export const ciCommentDocumentSchema: z.ZodType<CiCommentDocument> = z
  .object({
    schemaVersion: z.literal(CI_COMMENT_SCHEMA_VERSION),
    commentId: stableIdSchema,
    upsert: z
      .object({
        key: z.literal(CI_COMMENT_UPSERT_KEY),
        marker: z.literal(CI_COMMENT_UPSERT_MARKER),
      })
      .strict(),
    evaluationId: stableIdSchema,
    outcome: z.enum(CI_EVALUATION_OUTCOMES),
    run: z
      .object({
        provider: z.enum(CI_COMMENT_PROVIDERS),
        id: byteBoundedString(128),
        url: httpsUrl,
      })
      .strict(),
    candidate: z
      .object({ analysisId: stableIdSchema, repositoryRevision: byteBoundedString(256).nullable() })
      .strict(),
    summary: ciEvaluationSummarySchema,
    findings: z
      .array(
        z
          .object({
            sourceAnnotationId: stableIdSchema,
            category: z.enum(CI_ANNOTATION_CATEGORIES),
            level: z.enum(CI_ANNOTATION_LEVELS),
            title: byteBoundedString(160),
            message: byteBoundedString(768),
            location: z
              .object({
                side: z.enum(CI_EVIDENCE_SIDES),
                path: repositoryRelativePathSchema,
                startLine: z.number().int().positive(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(CI_COMMENT_HARD_MAX_ITEMS),
    artifactLinks: z
      .array(
        z
          .object({
            kind: z.enum(CI_COMMENT_ARTIFACT_KINDS),
            label: byteBoundedString(160),
            url: httpsUrl,
          })
          .strict(),
      )
      .min(1)
      .max(CI_COMMENT_HARD_MAX_ARTIFACT_LINKS),
    limits: z
      .object({
        maxItems: z.number().int().min(1).max(CI_COMMENT_HARD_MAX_ITEMS),
        maxArtifactLinks: z.number().int().min(1).max(CI_COMMENT_HARD_MAX_ARTIFACT_LINKS),
        maxMarkdownBytes: z
          .number()
          .int()
          .min(CI_COMMENT_MIN_MARKDOWN_BYTES)
          .max(CI_COMMENT_MAX_MARKDOWN_BYTES),
        candidateItems: count,
        includedItems: count.max(CI_COMMENT_HARD_MAX_ITEMS),
        omittedItems: count,
        candidateArtifactLinks: count,
        includedArtifactLinks: count.max(CI_COMMENT_HARD_MAX_ARTIFACT_LINKS),
        omittedArtifactLinks: count,
        renderedMarkdownBytes: count.max(CI_COMMENT_MAX_MARKDOWN_BYTES),
      })
      .strict(),
  })
  .strict();
