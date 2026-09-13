import { z } from 'zod';
import { semanticKeySchema } from '../comparison/schemas.js';
import {
  DIRECT_GUARD_STATES,
  EFFECTIVE_GUARD_STATES,
  GLOBAL_GUARD_STATES,
  TABLE_ACCESS_DIRECTIONS,
  TRACE_CAUSAL_CLASSES,
} from '../model/analysis.js';
import { ASSERTION_PREDICATES, ASSERTION_STATUSES } from '../model/assertions.js';
import { HTTP_METHODS } from '../model/entities.js';
import {
  JOB_QUEUE_TECHNOLOGIES,
  MICROSERVICE_MESSAGE_MODES,
  MICROSERVICE_PATTERN_KINDS,
} from '../model/interactions.js';
import {
  RESOURCE_KINDS,
  RESOURCE_OPERATIONS,
  RESOURCE_TECHNOLOGIES,
} from '../model/resource-access.js';
import {
  POLICY_OUTCOMES,
  POLICY_REASON_CODES,
  POLICY_RULE_IDS,
  POLICY_SEVERITIES,
} from '../policy/model.js';
import { policyResultSchema } from '../policy/schemas.js';
import {
  SYSTEM_CORRELATABLE_INTERACTION_KINDS,
  SYSTEM_CORRELATION_STATES,
  systemInteractionContractKey,
} from '../system-analysis/model.js';
import {
  jobQueueContractSchema,
  microserviceContractSchema,
  systemInteractionEndpointSchema,
} from '../system-analysis/schemas.js';
import { QUERY_DIFF_FAMILIES, QUERY_IMPACT_FAMILIES } from './operations-model.js';
import { QUERY_SCHEMA_VERSION, QUERY_SELECTOR_STATES } from './model.js';
import {
  endpointQueryMatchSchema,
  endpointSelectorSchema,
  queryArtifactDescriptorSchema,
  queryArtifactNameSchema,
  queryLimitSchema,
  queryLimitSummarySchema,
  symbolQueryMatchSchema,
  symbolSelectorSchema,
} from './schemas.js';

const boundedString = (maximum: number) => z.string().min(1).max(maximum);
const canonicalIdSchema = boundedString(256);
const cursorSchema = boundedString(16_384);
const sortedUniqueIds = z
  .array(canonicalIdSchema)
  .refine(
    (values) =>
      values.every((value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0),
    { message: 'Values must be sorted and unique.' },
  );

const queryPageSummarySchema = z
  .object({
    cursor: cursorSchema.nullable(),
    nextCursor: cursorSchema.nullable(),
    totalItems: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  })
  .strict();

const queryOperationMetadataSchema = z
  .object({
    querySchemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    artifacts: z.array(queryArtifactDescriptorSchema).min(1).max(2),
    resultArtifact: queryArtifactDescriptorSchema.nullable(),
    limits: queryLimitSummarySchema,
    page: queryPageSummarySchema,
    diagnosticIds: sortedUniqueIds,
    evidenceIds: sortedUniqueIds,
  })
  .strict()
  .superRefine((metadata, context) => {
    if (
      metadata.page.skipped + metadata.limits.totalMatches !== metadata.page.totalItems ||
      metadata.limits.returned + metadata.limits.omitted !== metadata.limits.totalMatches ||
      metadata.page.remaining !== metadata.limits.omitted
    ) {
      context.addIssue({
        code: 'custom',
        path: ['page'],
        message: 'Page and limit counts are inconsistent.',
      });
    }
    const names = metadata.artifacts.map(({ name }) => name);
    if (names.some((name, index) => index > 0 && names[index - 1]!.localeCompare(name) >= 0)) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts'],
        message: 'Source artifacts must be sorted and unique by name.',
      });
    }
  });

const httpMethodsFilterSchema = z
  .array(z.enum(HTTP_METHODS))
  .min(1)
  .refine((values) => new Set(values).size === values.length, { message: 'Duplicate method.' });
const endpointListFiltersSchema = z
  .object({
    httpMethods: httpMethodsFilterSchema.optional(),
    pathPrefix: boundedString(4_096).optional(),
    hasDiagnostics: z.boolean().optional(),
  })
  .strict();

export const listEndpointsRequestSchema = z
  .object({
    artifactName: queryArtifactNameSchema,
    filters: endpointListFiltersSchema.optional(),
    cursor: cursorSchema.optional(),
    limit: queryLimitSchema.optional(),
  })
  .strict();

export const listEndpointsResponseSchema = z
  .object({
    schemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    filters: endpointListFiltersSchema,
    metadata: queryOperationMetadataSchema,
    endpoints: z.array(endpointQueryMatchSchema),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.metadata.limits.returned !== response.endpoints.length) {
      context.addIssue({ code: 'custom', path: ['endpoints'], message: 'Returned count differs.' });
    }
    const ids = response.endpoints.map(({ canonicalId }) => canonicalId);
    if (ids.some((id, index) => index > 0 && ids[index - 1]!.localeCompare(id) >= 0)) {
      context.addIssue({
        code: 'custom',
        path: ['endpoints'],
        message: 'Endpoints are not ordered.',
      });
    }
  });

export const endpointTraceQueryRequestSchema = z
  .object({
    artifactName: queryArtifactNameSchema,
    selector: endpointSelectorSchema,
    limit: queryLimitSchema.optional(),
  })
  .strict();

function boundedCollection<T extends z.ZodType>(item: T) {
  return z
    .object({
      total: z.number().int().nonnegative(),
      returned: z.number().int().nonnegative(),
      omitted: z.number().int().nonnegative(),
      items: z.array(item),
    })
    .strict()
    .superRefine((collection, context) => {
      if (
        collection.returned !== collection.items.length ||
        collection.omitted !== collection.total - collection.returned
      ) {
        context.addIssue({ code: 'custom', message: 'Collection counts are inconsistent.' });
      }
    });
}

const traceGuardSchema = z
  .object({
    guardId: canonicalIdSchema,
    name: boundedString(1_024),
    scope: z.enum(['application_global', 'controller', 'method']),
    status: z.enum(ASSERTION_STATUSES),
    evidenceIds: sortedUniqueIds,
  })
  .strict();
const traceStepSchema = z
  .object({
    fromId: canonicalIdSchema,
    relation: z.enum(ASSERTION_PREDICATES),
    toId: canonicalIdSchema.nullable(),
    status: z.enum(ASSERTION_STATUSES),
    ruleId: boundedString(512),
    evidenceIds: sortedUniqueIds,
  })
  .strict();
const traceTerminalSchema = z
  .object({
    methodId: canonicalIdSchema,
    direction: z.enum(TABLE_ACCESS_DIRECTIONS),
    tableId: canonicalIdSchema,
    tableName: boundedString(1_024),
    causalClass: z.enum(TRACE_CAUSAL_CLASSES).optional(),
  })
  .strict();
const resourceTerminalSchema = z
  .object({
    methodId: canonicalIdSchema,
    resourceAccessId: canonicalIdSchema,
    resourceKind: z.enum(RESOURCE_KINDS),
    operation: z.enum(RESOURCE_OPERATIONS),
    technology: z.enum(RESOURCE_TECHNOLOGIES),
    target: z.unknown(),
    selector: z.unknown().nullable(),
    causalClass: z.enum(TRACE_CAUSAL_CLASSES),
  })
  .strict();
const traceProjectionSchema = z
  .object({
    endpoint: endpointQueryMatchSchema,
    directGuardState: z.enum(DIRECT_GUARD_STATES),
    globalGuardState: z.enum(GLOBAL_GUARD_STATES),
    effectiveGuardState: z.enum(EFFECTIVE_GUARD_STATES),
    guards: boundedCollection(traceGuardSchema),
    steps: boundedCollection(traceStepSchema),
    terminals: boundedCollection(traceTerminalSchema),
    resourceTerminals: boundedCollection(resourceTerminalSchema),
    diagnosticIds: boundedCollection(canonicalIdSchema),
    causalSummary: z
      .object({
        completeness: z
          .object({
            state: z.enum(['complete', 'incomplete']),
            diagnosticCodes: z.array(boundedString(256)),
          })
          .strict(),
        outboundInteractionIds: boundedCollection(canonicalIdSchema),
        localInteractionIds: boundedCollection(canonicalIdSchema),
        distributedInteractionIds: boundedCollection(canonicalIdSchema),
        jobQueueBranchIds: boundedCollection(canonicalIdSchema),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const endpointTraceQueryResponseSchema = z
  .object({
    schemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    state: z.enum([...QUERY_SELECTOR_STATES, 'analysis_failure']),
    selector: endpointSelectorSchema,
    metadata: queryOperationMetadataSchema,
    matches: z.array(endpointQueryMatchSchema),
    trace: traceProjectionSchema.nullable(),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      (response.state === 'resolved') !==
      (response.trace !== null && response.matches.length === 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['trace'],
        message: 'Resolved traces require one match.',
      });
    }
    if (response.state === 'not_found' && response.matches.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['matches'],
        message: 'Not-found traces have no matches.',
      });
    }
  });

const pairRequestBase = {
  beforeArtifactName: queryArtifactNameSchema,
  afterArtifactName: queryArtifactNameSchema,
  cursor: cursorSchema.optional(),
  limit: queryLimitSchema.optional(),
} as const;

export const compareAnalysesRequestSchema = z
  .object({ ...pairRequestBase, families: z.array(z.enum(QUERY_DIFF_FAMILIES)).min(1).optional() })
  .strict()
  .refine(({ beforeArtifactName, afterArtifactName }) => beforeArtifactName !== afterArtifactName, {
    message: 'Before and after artifact names must differ.',
  });

const semanticChangeSchema = z
  .object({
    key: cursorSchema,
    family: z.enum(QUERY_DIFF_FAMILIES),
    change: boundedString(128),
    label: boundedString(4_096),
    reasonCodes: sortedUniqueIds,
    canonicalIds: sortedUniqueIds,
    evidenceIds: sortedUniqueIds,
  })
  .strict();

const diffSummarySchema = z
  .object({
    endpointsAdded: z.number().int().nonnegative(),
    endpointsRemoved: z.number().int().nonnegative(),
    endpointsModified: z.number().int().nonnegative(),
    assertionStatusChanged: z.number().int().nonnegative(),
    diagnosticsNew: z.number().int().nonnegative(),
    diagnosticsResolved: z.number().int().nonnegative(),
    diagnosticsChanged: z.number().int().nonnegative(),
    ambiguities: z.number().int().nonnegative(),
    interactionsAdded: z.number().int().nonnegative().optional(),
    interactionsRemoved: z.number().int().nonnegative().optional(),
    interactionsModified: z.number().int().nonnegative().optional(),
    interactionHandlersAdded: z.number().int().nonnegative().optional(),
    interactionHandlersRemoved: z.number().int().nonnegative().optional(),
    interactionHandlersModified: z.number().int().nonnegative().optional(),
    jobQueueDispatchesAdded: z.number().int().nonnegative().optional(),
    jobQueueDispatchesRemoved: z.number().int().nonnegative().optional(),
    jobQueueDispatchesModified: z.number().int().nonnegative().optional(),
    jobQueueBranchesAdded: z.number().int().nonnegative().optional(),
    jobQueueBranchesRemoved: z.number().int().nonnegative().optional(),
    jobQueueBranchesModified: z.number().int().nonnegative().optional(),
    jobQueueBranchEffectsAdded: z.number().int().nonnegative().optional(),
    jobQueueBranchEffectsRemoved: z.number().int().nonnegative().optional(),
    jobQueueBranchEffectsModified: z.number().int().nonnegative().optional(),
  })
  .strict();

function addPagedItemIssues(
  metadata: { readonly limits: { readonly returned: number } },
  items: readonly { readonly key: string }[],
  field: string,
  context: z.core.$RefinementCtx,
) {
  if (metadata.limits.returned !== items.length) {
    context.addIssue({ code: 'custom', path: [field], message: 'Returned count differs.' });
  }
  if (items.some(({ key }, index) => index > 0 && items[index - 1]!.key.localeCompare(key) >= 0)) {
    context.addIssue({ code: 'custom', path: [field], message: 'Items are not ordered.' });
  }
}

export const compareAnalysesResponseSchema = z
  .object({
    schemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    beforeArtifact: queryArtifactDescriptorSchema,
    afterArtifact: queryArtifactDescriptorSchema,
    summary: diffSummarySchema,
    metadata: queryOperationMetadataSchema,
    changes: z.array(semanticChangeSchema),
  })
  .strict()
  .superRefine((response, context) =>
    addPagedItemIssues(response.metadata, response.changes, 'changes', context),
  );

export const changeImpactRequestSchema = z
  .object({
    ...pairRequestBase,
    families: z.array(z.enum(QUERY_IMPACT_FAMILIES)).min(1).optional(),
  })
  .strict()
  .refine(({ beforeArtifactName, afterArtifactName }) => beforeArtifactName !== afterArtifactName, {
    message: 'Before and after artifact names must differ.',
  });

const impactItemSchema = z
  .object({
    key: cursorSchema,
    family: z.enum(QUERY_IMPACT_FAMILIES),
    change: boundedString(128),
    label: boundedString(4_096),
    direct: z.boolean().nullable(),
    pathCount: z.number().int().nonnegative(),
    reasonCodes: sortedUniqueIds,
    categories: sortedUniqueIds,
    canonicalIds: sortedUniqueIds,
    evidenceIds: sortedUniqueIds,
  })
  .strict();
const impactSummarySchema = z
  .object({
    sourceFilesAdded: z.number().int().nonnegative(),
    sourceFilesRemoved: z.number().int().nonnegative(),
    sourceFilesModified: z.number().int().nonnegative(),
    impactedEndpointSlots: z.number().int().nonnegative(),
    directlyChangedEndpointSlots: z.number().int().nonnegative(),
    transitivelyImpactedEndpointSlots: z.number().int().nonnegative(),
    unreachableSourceChanges: z.number().int().nonnegative(),
    reasonsByCategory: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();
export const changeImpactResponseSchema = z
  .object({
    schemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    beforeArtifact: queryArtifactDescriptorSchema,
    afterArtifact: queryArtifactDescriptorSchema,
    summary: impactSummarySchema,
    metadata: queryOperationMetadataSchema,
    impacts: z.array(impactItemSchema),
  })
  .strict()
  .superRefine((response, context) =>
    addPagedItemIssues(response.metadata, response.impacts, 'impacts', context),
  );

export const symbolDependentsRequestSchema = z
  .object({
    artifactName: queryArtifactNameSchema,
    selector: symbolSelectorSchema,
    maxDepth: z.number().int().positive().max(10).optional(),
    maxStates: z.number().int().positive().max(10_000).optional(),
    cursor: cursorSchema.optional(),
    limit: queryLimitSchema.optional(),
  })
  .strict();
const dependentStepSchema = z
  .object({
    assertionId: canonicalIdSchema,
    fromId: canonicalIdSchema,
    predicate: z.enum(['METHOD_CALLS_METHOD', 'ENDPOINT_IMPLEMENTED_BY', 'HANDLER_IMPLEMENTED_BY']),
    toId: canonicalIdSchema,
    status: z.enum(['resolved', 'ambiguous']),
    evidenceIds: sortedUniqueIds,
  })
  .strict();
const dependentPathSchema = z
  .object({
    key: cursorSchema,
    subjectKind: z.enum(['method', 'endpoint', 'interaction_handler']),
    subjectId: canonicalIdSchema,
    displayName: boundedString(4_096),
    depth: z.number().int().positive(),
    certainty: z.enum(['resolved', 'ambiguous']),
    steps: z.array(dependentStepSchema).min(1),
    diagnosticIds: sortedUniqueIds,
    evidenceIds: sortedUniqueIds,
  })
  .strict();
export const symbolDependentsResponseSchema = z
  .object({
    schemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    state: z.enum(QUERY_SELECTOR_STATES),
    selector: symbolSelectorSchema,
    metadata: queryOperationMetadataSchema,
    selectorLimits: queryLimitSummarySchema,
    matches: z.array(symbolQueryMatchSchema),
    seedMethods: boundedCollection(canonicalIdSchema),
    traversal: z
      .object({
        maxDepth: z.number().int().positive(),
        maxStates: z.number().int().positive(),
        visitedStates: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
    dependents: z.array(dependentPathSchema),
  })
  .strict()
  .superRefine((response, context) => {
    const expectedState =
      response.selectorLimits.totalMatches === 0
        ? 'not_found'
        : response.selectorLimits.totalMatches === 1
          ? 'resolved'
          : 'ambiguous';
    if (
      response.state !== expectedState ||
      response.selectorLimits.returned !== response.matches.length ||
      response.selectorLimits.omitted !==
        response.selectorLimits.totalMatches - response.selectorLimits.returned
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selectorLimits'],
        message: 'Symbol selector state and counts are inconsistent.',
      });
    }
  });

const systemContractSchema = z.discriminatedUnion('targetKind', [
  jobQueueContractSchema,
  microserviceContractSchema,
]);
export const distributedCandidatesRequestSchema = z
  .object({
    artifactName: queryArtifactNameSchema,
    kind: z.enum(SYSTEM_CORRELATABLE_INTERACTION_KINDS),
    target: systemContractSchema,
    states: z.array(z.enum(SYSTEM_CORRELATION_STATES)).min(1).optional(),
    cursor: cursorSchema.optional(),
    limit: queryLimitSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.kind !== request.target.targetKind) {
      context.addIssue({
        code: 'custom',
        path: ['target', 'targetKind'],
        message: 'Interaction kind and structural target kind must match.',
      });
    }
  });
const distributedCandidateSchema = z
  .object({
    key: cursorSchema,
    correlationId: canonicalIdSchema,
    state: z.enum(SYSTEM_CORRELATION_STATES),
    contractKey: boundedString(4_096),
    brokerRealmId: canonicalIdSchema.nullable(),
    producer: systemInteractionEndpointSchema.nullable(),
    consumers: z.array(systemInteractionEndpointSchema),
    unmatchedReason: boundedString(128).nullable(),
    ambiguityReason: boundedString(128).nullable(),
    diagnosticIds: sortedUniqueIds,
    canonicalIds: sortedUniqueIds,
  })
  .strict();
export const distributedCandidatesResponseSchema = z
  .object({
    schemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    selectionState: z.enum(QUERY_SELECTOR_STATES),
    kind: z.enum(SYSTEM_CORRELATABLE_INTERACTION_KINDS),
    target: systemContractSchema,
    contractKey: boundedString(4_096),
    metadata: queryOperationMetadataSchema,
    candidates: z.array(distributedCandidateSchema),
  })
  .strict()
  .superRefine((response, context) => {
    const expectedState =
      response.metadata.page.totalItems === 0
        ? 'not_found'
        : response.metadata.page.totalItems === 1
          ? 'resolved'
          : 'ambiguous';
    if (
      response.selectionState !== expectedState ||
      response.kind !== response.target.targetKind ||
      response.contractKey !== systemInteractionContractKey(response.target) ||
      response.metadata.limits.returned !== response.candidates.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Distributed selector identity, state, or counts are inconsistent.',
      });
    }
    if (
      response.candidates.some(
        (candidate) =>
          candidate.contractKey !== response.contractKey ||
          candidate.producer?.kind !== response.kind ||
          candidate.consumers.some(({ kind }) => kind !== response.kind),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'A candidate does not match the required structural contract.',
      });
    }
  });

const policyFiltersSchema = z
  .object({
    ruleIds: z.array(z.enum(POLICY_RULE_IDS)).min(1).optional(),
    outcomes: z.array(z.enum(POLICY_OUTCOMES)).min(1).optional(),
    severities: z.array(z.enum(POLICY_SEVERITIES)).min(1).optional(),
    blocking: z.boolean().optional(),
  })
  .strict();
export const policyResultsRequestSchema = z
  .object({
    artifactName: queryArtifactNameSchema,
    filters: policyFiltersSchema.optional(),
    cursor: cursorSchema.optional(),
    limit: queryLimitSchema.optional(),
  })
  .strict();
const policySummarySchema = z
  .object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    notApplicable: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    blocking: z.number().int().nonnegative(),
  })
  .strict();
const queryPolicyResultSchema = policyResultSchema.extend({ key: cursorSchema }).strict();
export const policyResultsResponseSchema = z
  .object({
    schemaVersion: z.literal(QUERY_SCHEMA_VERSION),
    selectionState: z.enum(QUERY_SELECTOR_STATES),
    filters: policyFiltersSchema,
    sourceSummary: policySummarySchema,
    filteredSummary: policySummarySchema,
    metadata: queryOperationMetadataSchema,
    results: z.array(queryPolicyResultSchema),
  })
  .strict()
  .superRefine((response, context) => {
    const total =
      response.filteredSummary.passed +
      response.filteredSummary.failed +
      response.filteredSummary.unknown +
      response.filteredSummary.notApplicable;
    const expectedState = total === 0 ? 'not_found' : total === 1 ? 'resolved' : 'ambiguous';
    if (
      response.selectionState !== expectedState ||
      total !== response.metadata.page.totalItems ||
      response.metadata.limits.returned !== response.results.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Policy selector state, summary, and page counts are inconsistent.',
      });
    }
    if (
      response.results.some(
        (result) =>
          (response.filters.ruleIds !== undefined &&
            !response.filters.ruleIds.includes(result.ruleId)) ||
          (response.filters.outcomes !== undefined &&
            !response.filters.outcomes.includes(result.outcome)) ||
          (response.filters.severities !== undefined &&
            !response.filters.severities.includes(result.severity)) ||
          (response.filters.blocking !== undefined &&
            response.filters.blocking !== result.blocking),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['results'],
        message: 'A returned policy result does not satisfy the declared filters.',
      });
    }
  });

// Keep these imported literal vocabularies checked even though the schemas above
// reference their enclosing records rather than spelling every field twice.
void semanticKeySchema;
void POLICY_REASON_CODES;
void JOB_QUEUE_TECHNOLOGIES;
void MICROSERVICE_MESSAGE_MODES;
void MICROSERVICE_PATTERN_KINDS;
