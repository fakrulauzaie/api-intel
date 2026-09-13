import { z } from 'zod';
import {
  DOCTOR_CHECK_CODES,
  DOCTOR_CHECK_STATUSES,
  DOCTOR_COMPATIBILITY_STATES,
  DOCTOR_RESULTS,
  DOCTOR_SCHEMA_VERSION,
} from './model.js';

const doctorFactsSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.number(), z.string(), z.null()]),
);

const doctorCheckSchema = z
  .object({
    code: z.enum(DOCTOR_CHECK_CODES),
    status: z.enum(DOCTOR_CHECK_STATUSES),
    summary: z.string(),
    remediation: z.string().nullable(),
    facts: doctorFactsSchema,
  })
  .strict();

const doctorFrameworkSchema = z
  .object({
    packageName: z.string(),
    version: z.string().nullable(),
    declarationResolution: z.literal('typescript_resolved'),
    compatibility: z.enum(DOCTOR_COMPATIBILITY_STATES),
  })
  .strict();

const doctorExtractorCapabilitySchema = z
  .object({
    id: z.string(),
    enabled: z.boolean(),
    activation: z.enum(['always', 'configuration']),
    observedPackages: z.array(z.string()),
  })
  .strict();

const doctorConfigurationSummarySchema = z
  .object({
    source: z.enum(['none', 'discovered', 'explicit', 'invalid']),
    fileVersion: z.number().int().nullable(),
    path: z.string().nullable(),
    maxCallDepth: z.number().int(),
    rawSqlDialect: z.string().nullable(),
    maxInteractionHops: z.number().int(),
    maxFanOutPerInteraction: z.number().int(),
    maxInteractionTraceStates: z.number().int(),
  })
  .strict();

export const doctorDocumentSchema = z
  .object({
    schemaVersion: z.literal(DOCTOR_SCHEMA_VERSION),
    tool: z.object({ name: z.literal('api-intel'), version: z.string() }).strict(),
    result: z.enum(DOCTOR_RESULTS),
    repository: z.literal('<repository>'),
    checks: z.array(doctorCheckSchema),
    capabilities: z
      .object({
        extractors: z.array(doctorExtractorCapabilitySchema),
        recognizedFrameworks: z.array(doctorFrameworkSchema),
        expectedUnavailableFamilies: z.array(z.string()),
        configuration: doctorConfigurationSummarySchema,
      })
      .strict(),
  })
  .strict();
