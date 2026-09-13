import { z } from 'zod';
import { ASSERTION_STATUSES } from '../model/assertions.js';
import { CLASS_ROLES, HTTP_METHODS } from '../model/entities.js';
import { isNormalizedRepositoryRelativePath } from '../model/paths.js';
import {
  QUERY_ARTIFACT_KINDS,
  QUERY_ARTIFACT_RESULT_STATES,
  QUERY_SCHEMA_VERSION,
  QUERY_SELECTOR_STATES,
  QUERY_SYMBOL_KINDS,
} from './model.js';

export const ABSOLUTE_QUERY_RESULT_LIMIT = 1_000;

const boundedString = (maximum: number) => z.string().min(1).max(maximum);
export const queryArtifactNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const canonicalIdSchema = boundedString(256);
export const queryLimitSchema = z.number().int().positive().max(ABSOLUTE_QUERY_RESULT_LIMIT);
const sourcePositionSchema = z
  .object({ line: z.number().int().positive(), column: z.number().int().positive() })
  .strict();

export const endpointSelectorSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('canonical_id'), canonicalId: canonicalIdSchema }).strict(),
  z
    .object({
      by: z.literal('route'),
      httpMethod: z.enum(HTTP_METHODS),
      path: boundedString(4_096),
    })
    .strict(),
]);

export const endpointResolutionRequestSchema = z
  .object({
    artifactName: queryArtifactNameSchema,
    selector: endpointSelectorSchema,
    limit: queryLimitSchema.optional(),
  })
  .strict();

export const symbolSelectorSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('canonical_id'), canonicalId: canonicalIdSchema }).strict(),
  z
    .object({
      by: z.literal('declaration'),
      sourcePath: boundedString(4_096).refine(isNormalizedRepositoryRelativePath, {
        message: 'Expected a normalized repository-relative path.',
      }),
      qualifiedName: boundedString(1_024),
      kind: z.enum(QUERY_SYMBOL_KINDS).optional(),
      location: sourcePositionSchema.optional(),
    })
    .strict(),
]);

export const symbolResolutionRequestSchema = z
  .object({
    artifactName: queryArtifactNameSchema,
    selector: symbolSelectorSchema,
    limit: queryLimitSchema.optional(),
  })
  .strict();

export const queryArtifactDescriptorSchema = z
  .object({
    name: queryArtifactNameSchema,
    kind: z.enum(QUERY_ARTIFACT_KINDS),
    documentId: z.string().regex(/^query_document:[0-9a-f]{64}$/u),
    canonicalDocumentId: canonicalIdSchema.nullable(),
    schemaVersion: boundedString(64),
    resultState: z.enum(QUERY_ARTIFACT_RESULT_STATES),
  })
  .strict();

export const queryLimitSummarySchema = z
  .object({
    requested: queryLimitSchema.nullable(),
    applied: queryLimitSchema,
    totalMatches: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    omitted: z.number().int().nonnegative(),
  })
  .strict();

export const queryResponseMetadataSchema = z
  .object({
    querySchemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    artifact: queryArtifactDescriptorSchema,
    limits: queryLimitSummarySchema,
    diagnosticIds: z.array(canonicalIdSchema),
    evidenceIds: z.array(canonicalIdSchema),
  })
  .strict();

function isSortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0);
}

interface CommonResponseShape {
  readonly state: (typeof QUERY_SELECTOR_STATES)[number];
  readonly metadata: {
    readonly limits: {
      readonly applied: number;
      readonly totalMatches: number;
      readonly returned: number;
      readonly omitted: number;
    };
    readonly diagnosticIds: readonly string[];
    readonly evidenceIds: readonly string[];
  };
  readonly matches: readonly {
    readonly canonicalId: string;
    readonly diagnosticIds: readonly string[];
    readonly evidenceIds: readonly string[];
  }[];
}

function addCommonResponseIssues(response: CommonResponseShape, context: z.core.$RefinementCtx) {
  const expectedState =
    response.metadata.limits.totalMatches === 0
      ? 'not_found'
      : response.metadata.limits.totalMatches === 1
        ? 'resolved'
        : 'ambiguous';
  if (response.state !== expectedState) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: `Expected ${expectedState} for the declared total match count.`,
    });
  }
  if (
    response.metadata.limits.returned !== response.matches.length ||
    response.metadata.limits.returned > response.metadata.limits.applied ||
    response.metadata.limits.omitted !==
      response.metadata.limits.totalMatches - response.metadata.limits.returned
  ) {
    context.addIssue({
      code: 'custom',
      path: ['metadata', 'limits'],
      message: 'Returned, omitted, total, and applied counts are inconsistent.',
    });
  }
  if (!isSortedUnique(response.matches.map(({ canonicalId }) => canonicalId))) {
    context.addIssue({
      code: 'custom',
      path: ['matches'],
      message: 'Matches must be uniquely ordered by canonical ID.',
    });
  }
  for (const [field, actual] of [
    ['diagnosticIds', response.metadata.diagnosticIds],
    ['evidenceIds', response.metadata.evidenceIds],
  ] as const) {
    const expected = [...new Set(response.matches.flatMap((match) => match[field]))].sort();
    if (!isSortedUnique(actual) || JSON.stringify(actual) !== JSON.stringify(expected)) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', field],
        message: `${field} must be the ordered union of returned match references.`,
      });
    }
  }
}

export const endpointHandlerReferenceSchema = z
  .object({
    assertionId: canonicalIdSchema,
    methodId: canonicalIdSchema.nullable(),
    status: z.enum(ASSERTION_STATUSES),
    evidenceIds: z.array(canonicalIdSchema),
  })
  .strict();

export const endpointQueryMatchSchema = z
  .object({
    canonicalId: canonicalIdSchema,
    httpMethod: z.enum(HTTP_METHODS),
    path: boundedString(4_096),
    handlers: z.array(endpointHandlerReferenceSchema),
    diagnosticIds: z.array(canonicalIdSchema),
    evidenceIds: z.array(canonicalIdSchema),
  })
  .strict();

export const endpointResolutionResponseSchema = z
  .object({
    schemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    state: z.enum(QUERY_SELECTOR_STATES),
    selector: endpointSelectorSchema,
    metadata: queryResponseMetadataSchema,
    matches: z.array(endpointQueryMatchSchema),
  })
  .strict()
  .superRefine(addCommonResponseIssues);

const querySourceRangeSchema = sourcePositionSchema
  .extend({ endLine: z.number().int().positive(), endColumn: z.number().int().positive() })
  .strict();

const symbolMatchBase = {
  canonicalId: canonicalIdSchema,
  sourceFileId: canonicalIdSchema,
  sourcePath: boundedString(4_096),
  qualifiedName: boundedString(1_024),
  displayName: boundedString(1_024),
  declarationEvidenceId: canonicalIdSchema,
  declaration: querySourceRangeSchema,
  diagnosticIds: z.array(canonicalIdSchema),
  evidenceIds: z.array(canonicalIdSchema),
} as const;

export const symbolQueryMatchSchema = z.discriminatedUnion('kind', [
  z
    .object({ ...symbolMatchBase, kind: z.literal('class'), roles: z.array(z.enum(CLASS_ROLES)) })
    .strict(),
  z
    .object({
      ...symbolMatchBase,
      kind: z.literal('method'),
      classId: canonicalIdSchema,
      signature: boundedString(4_096),
    })
    .strict(),
]);

export const symbolResolutionResponseSchema = z
  .object({
    schemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    state: z.enum(QUERY_SELECTOR_STATES),
    selector: symbolSelectorSchema,
    metadata: queryResponseMetadataSchema,
    matches: z.array(symbolQueryMatchSchema),
  })
  .strict()
  .superRefine(addCommonResponseIssues);
