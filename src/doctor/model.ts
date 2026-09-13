export const DOCTOR_SCHEMA_VERSION = '1.0.0' as const;

export const DOCTOR_CHECK_STATUSES = ['pass', 'warning', 'failure'] as const;
export type DoctorCheckStatus = (typeof DOCTOR_CHECK_STATUSES)[number];

export const DOCTOR_RESULTS = ['pass', 'warning', 'failure'] as const;
export type DoctorResult = (typeof DOCTOR_RESULTS)[number];

export const DOCTOR_CHECK_CODES = [
  'DOCTOR_NODE_RUNTIME_SUPPORTED',
  'DOCTOR_NODE_RUNTIME_UNSUPPORTED',
  'DOCTOR_RUNTIME_ASSETS_READY',
  'DOCTOR_RUNTIME_ASSETS_MISSING',
  'DOCTOR_CONFIGURATION_DEFAULTS',
  'DOCTOR_CONFIGURATION_READY',
  'DOCTOR_CONFIGURATION_INVALID',
  'DOCTOR_REPOSITORY_READY',
  'DOCTOR_REPOSITORY_NO_TYPESCRIPT',
  'DOCTOR_REPOSITORY_UNAVAILABLE',
  'DOCTOR_TYPESCRIPT_PROGRAM_READY',
  'DOCTOR_TYPESCRIPT_PROGRAM_FAILED',
  'DOCTOR_TYPESCRIPT_IMPORTS_RESOLVED',
  'DOCTOR_TYPESCRIPT_IMPORTS_UNRESOLVED',
  'DOCTOR_TYPESCRIPT_STRUCTURE_INVALID',
  'DOCTOR_TYPESCRIPT_SEMANTIC_WARNINGS',
  'DOCTOR_TYPESCRIPT_DIAGNOSTICS_CLEAR',
  'DOCTOR_NESTJS_DECLARATIONS_RESOLVED',
  'DOCTOR_NESTJS_DECLARATIONS_NOT_OBSERVED',
  'DOCTOR_FRAMEWORK_VERSIONS_VERIFIED',
  'DOCTOR_FRAMEWORK_VERSIONS_UNVERIFIED',
  'DOCTOR_OUTPUT_PATH_NOT_DIRECTORY',
  'DOCTOR_OUTPUT_METADATA_UNREADABLE',
  'DOCTOR_OUTPUT_METADATA_ONLY',
  'DOCTOR_OUTPUT_PERMISSION_UNCONFIRMED',
  'DOCTOR_OUTPUT_PROBE_PASSED',
  'DOCTOR_OUTPUT_PROBE_FAILED',
  'DOCTOR_OUTPUT_PROBE_CLEANUP_FAILED',
] as const;
export type DoctorCheckCode = (typeof DOCTOR_CHECK_CODES)[number];

export interface DoctorCheck {
  readonly code: DoctorCheckCode;
  readonly status: DoctorCheckStatus;
  readonly summary: string;
  readonly remediation: string | null;
  readonly facts: Readonly<Record<string, boolean | number | string | null>>;
}

export const DOCTOR_COMPATIBILITY_STATES = ['verified', 'unverified', 'unsupported'] as const;
export type DoctorCompatibilityState = (typeof DOCTOR_COMPATIBILITY_STATES)[number];

export interface DoctorFramework {
  readonly packageName: string;
  readonly version: string | null;
  readonly declarationResolution: 'typescript_resolved';
  readonly compatibility: DoctorCompatibilityState;
}

export interface DoctorExtractorCapability {
  readonly id: string;
  readonly enabled: boolean;
  readonly activation: 'always' | 'configuration';
  readonly observedPackages: readonly string[];
}

export interface DoctorConfigurationSummary {
  readonly source: 'none' | 'discovered' | 'explicit' | 'invalid';
  readonly fileVersion: number | null;
  readonly path: string | null;
  readonly maxCallDepth: number;
  readonly rawSqlDialect: string | null;
  readonly maxInteractionHops: number;
  readonly maxFanOutPerInteraction: number;
  readonly maxInteractionTraceStates: number;
}

export interface DoctorCapabilitySummary {
  readonly extractors: readonly DoctorExtractorCapability[];
  readonly recognizedFrameworks: readonly DoctorFramework[];
  readonly expectedUnavailableFamilies: readonly string[];
  readonly configuration: DoctorConfigurationSummary;
}

export interface DoctorDocument {
  readonly schemaVersion: typeof DOCTOR_SCHEMA_VERSION;
  readonly tool: { readonly name: 'api-intel'; readonly version: string };
  readonly result: DoctorResult;
  /** Deliberately stable and safe to paste into an issue. */
  readonly repository: '<repository>';
  readonly checks: readonly DoctorCheck[];
  readonly capabilities: DoctorCapabilitySummary;
}

export function doctorResult(checks: readonly DoctorCheck[]): DoctorResult {
  if (checks.some(({ status }) => status === 'failure')) return 'failure';
  if (checks.some(({ status }) => status === 'warning')) return 'warning';
  return 'pass';
}
