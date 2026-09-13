import { z } from 'zod';
import { stableIdSchema } from '../model/schemas.js';
import {
  CI_COMMENT_PUBLICATION_OUTCOMES,
  CI_COMMENT_PUBLISHER_MAX_PAGES,
  CI_COMMENT_PUBLISHER_PROVIDERS,
  CI_COMMENT_PUBLISHER_SCHEMA_VERSION,
  type CiCommentPublicationResult,
} from './model.js';

export const ciCommentPublicationResultSchema: z.ZodType<CiCommentPublicationResult> = z
  .object({
    schemaVersion: z.literal(CI_COMMENT_PUBLISHER_SCHEMA_VERSION),
    provider: z.enum(CI_COMMENT_PUBLISHER_PROVIDERS),
    outcome: z.enum(CI_COMMENT_PUBLICATION_OUTCOMES),
    evaluationId: stableIdSchema,
    commentDocumentId: stableIdSchema,
    targetKey: z.string().min(1).max(512),
    providerCommentId: z.number().int().positive().nullable(),
    providerStatus: z.number().int().min(100).max(599),
    pagesScanned: z.number().int().min(0).max(CI_COMMENT_PUBLISHER_MAX_PAGES),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.outcome !== 'permission_unavailable' && result.providerCommentId === null) {
      context.addIssue({
        code: 'custom',
        path: ['providerCommentId'],
        message: 'Successful publication outcomes require a provider comment ID.',
      });
    }
    if (result.outcome === 'permission_unavailable' && result.providerCommentId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['providerCommentId'],
        message: 'Permission-unavailable outcomes must not claim a comment ID.',
      });
    }
  });

export function assertValidCiCommentPublicationResult(input: unknown): CiCommentPublicationResult {
  return ciCommentPublicationResultSchema.parse(input);
}
