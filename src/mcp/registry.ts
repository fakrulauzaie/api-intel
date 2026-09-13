import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AnalysisIntegrityError, assertValidAnalysisDocument } from '../evidence/validate.js';
import type { AnalysisDocument } from '../model/analysis.js';
import type { PolicyResultsDocument } from '../policy/model.js';
import {
  assertValidPolicyResultsDocument,
  PolicyResultsIntegrityError,
} from '../policy/validate.js';
import { createQueryKernel, type QueryArtifactInput } from '../query/index.js';
import {
  assertValidSystemAnalysisDocument,
  SystemAnalysisIntegrityError,
  type SystemAnalysisDocument,
} from '../system-analysis/index.js';
import type { McpArtifactRegistry, McpArtifactSpec } from './model.js';
import {
  DEFAULT_MCP_ARTIFACT_MAX_BYTES,
  DEFAULT_MCP_ARTIFACT_MAX_COUNT,
  MCP_RUNTIME_METADATA,
  McpStartupError,
} from './model.js';
import { createMcpResourceIndex } from './resources.js';

export interface McpRegistryLoadDependencies {
  readonly canonicalizePath: (path: string) => Promise<string>;
  readonly fileSize: (path: string) => Promise<number>;
  readonly readTextFile: (path: string, signal?: AbortSignal) => Promise<string>;
}

const defaultDependencies: McpRegistryLoadDependencies = {
  canonicalizePath: async (path) => realpath(resolve(path)),
  fileSize: async (path) => (await stat(path)).size,
  readTextFile: async (path, signal) =>
    readFile(path, { encoding: 'utf8', ...(signal === undefined ? {} : { signal }) }),
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function validateCompletedAnalysis(input: unknown): AnalysisDocument {
  let analysis: AnalysisDocument;
  try {
    analysis = assertValidAnalysisDocument(input);
  } catch (error) {
    const detail =
      error instanceof AnalysisIntegrityError
        ? `${error.issues.length} integrity issue(s); ${error.issues[0]?.message ?? error.message}`
        : message(error);
    throw new McpStartupError('ARTIFACT_SCHEMA_INVALID', `Invalid analysis artifact: ${detail}`, {
      cause: error,
    });
  }
  if (analysis.resultState !== 'completed' && analysis.resultState !== 'completed_with_gaps') {
    throw new McpStartupError(
      'ANALYSIS_NOT_COMPLETED',
      `Analysis artifact has non-queryable result state ${analysis.resultState}.`,
    );
  }
  return deepFreeze(analysis);
}

function validateSystem(input: unknown): SystemAnalysisDocument {
  try {
    return deepFreeze(assertValidSystemAnalysisDocument(input));
  } catch (error) {
    const detail =
      error instanceof SystemAnalysisIntegrityError
        ? `${error.issues.length} integrity issue(s); ${error.issues[0]?.message ?? error.message}`
        : message(error);
    throw new McpStartupError(
      'ARTIFACT_SCHEMA_INVALID',
      `Invalid system-analysis artifact: ${detail}`,
      { cause: error },
    );
  }
}

function validatePolicy(input: unknown): PolicyResultsDocument {
  try {
    return deepFreeze(assertValidPolicyResultsDocument(input));
  } catch (error) {
    const detail =
      error instanceof PolicyResultsIntegrityError
        ? `${error.issues.length} integrity issue(s); ${error.issues[0]?.message ?? error.message}`
        : message(error);
    throw new McpStartupError('ARTIFACT_SCHEMA_INVALID', `Invalid policy artifact: ${detail}`, {
      cause: error,
    });
  }
}

async function canonicalPath(
  path: string,
  dependencies: McpRegistryLoadDependencies,
): Promise<string> {
  try {
    return await dependencies.canonicalizePath(path);
  } catch (error) {
    throw new McpStartupError('ARTIFACT_STAT_FAILED', `Could not resolve artifact path: ${path}.`, {
      cause: error,
    });
  }
}

export async function loadMcpArtifactRegistry(input: {
  readonly artifacts: readonly McpArtifactSpec[];
  readonly signal?: AbortSignal | undefined;
  readonly maxArtifactBytes?: number | undefined;
  readonly maxArtifactCount?: number | undefined;
  readonly maxResourceBytes?: number | undefined;
  readonly dependencies?: Partial<McpRegistryLoadDependencies> | undefined;
}): Promise<McpArtifactRegistry> {
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const maximumBytes = input.maxArtifactBytes ?? DEFAULT_MCP_ARTIFACT_MAX_BYTES;
  const maximumCount = input.maxArtifactCount ?? DEFAULT_MCP_ARTIFACT_MAX_COUNT;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new McpStartupError(
      'INVALID_ARGUMENTS',
      'Artifact byte limit must be a positive integer.',
    );
  }
  if (!Number.isSafeInteger(maximumCount) || maximumCount < 1) {
    throw new McpStartupError(
      'INVALID_ARGUMENTS',
      'Artifact count limit must be a positive integer.',
    );
  }
  if (input.artifacts.length === 0 || input.artifacts.length > maximumCount) {
    throw new McpStartupError(
      'INVALID_ARGUMENTS',
      `MCP startup requires between 1 and ${maximumCount} artifacts.`,
    );
  }
  const names = new Set<string>();
  for (const artifact of input.artifacts) {
    if (names.has(artifact.name)) {
      throw new McpStartupError(
        'INVALID_ARGUMENTS',
        `Artifact name ${artifact.name} is registered more than once.`,
      );
    }
    names.add(artifact.name);
  }

  const textByPath = new Map<string, string>();
  const jsonByPath = new Map<string, unknown>();
  const analysisByPath = new Map<string, AnalysisDocument>();
  const systemByPath = new Map<string, SystemAnalysisDocument>();
  const policyByPath = new Map<string, PolicyResultsDocument>();
  const queryArtifacts: QueryArtifactInput[] = [];

  const loadJson = async (
    path: string,
  ): Promise<{ readonly path: string; readonly value: unknown }> => {
    const resolvedPath = await canonicalPath(path, dependencies);
    const existing = jsonByPath.get(resolvedPath);
    if (existing !== undefined) return { path: resolvedPath, value: existing };
    let size: number;
    try {
      size = await dependencies.fileSize(resolvedPath);
    } catch (error) {
      throw new McpStartupError(
        'ARTIFACT_STAT_FAILED',
        `Could not inspect artifact: ${resolvedPath}.`,
        { cause: error },
      );
    }
    if (size > maximumBytes) {
      throw new McpStartupError(
        'ARTIFACT_TOO_LARGE',
        `Artifact exceeds the ${maximumBytes}-byte startup limit: ${resolvedPath}.`,
      );
    }
    let text = textByPath.get(resolvedPath);
    if (text === undefined) {
      try {
        text = await dependencies.readTextFile(resolvedPath, input.signal);
      } catch (error) {
        if (input.signal?.aborted === true) throw error;
        throw new McpStartupError(
          'ARTIFACT_READ_FAILED',
          `Could not read artifact: ${resolvedPath}.`,
          { cause: error },
        );
      }
      textByPath.set(resolvedPath, text);
    }
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch (error) {
      throw new McpStartupError('ARTIFACT_JSON_INVALID', `Invalid JSON: ${resolvedPath}.`, {
        cause: error,
      });
    }
    jsonByPath.set(resolvedPath, value);
    return { path: resolvedPath, value };
  };

  for (const artifact of input.artifacts) {
    const loaded = await loadJson(artifact.path);
    if (artifact.role === 'system') {
      let document = systemByPath.get(loaded.path);
      if (document === undefined) {
        document = validateSystem(loaded.value);
        systemByPath.set(loaded.path, document);
      }
      queryArtifacts.push({ name: artifact.name, kind: 'system_analysis', document });
      continue;
    }
    if (artifact.role === 'policy') {
      let document = policyByPath.get(loaded.path);
      if (document === undefined) {
        document = validatePolicy(loaded.value);
        policyByPath.set(loaded.path, document);
      }
      queryArtifacts.push({ name: artifact.name, kind: 'policy', document });
      continue;
    }
    let document = analysisByPath.get(loaded.path);
    if (document === undefined) {
      document = validateCompletedAnalysis(loaded.value);
      analysisByPath.set(loaded.path, document);
    }
    queryArtifacts.push({ name: artifact.name, kind: 'analysis', document });
  }

  const queryKernel = Object.freeze(createQueryKernel({ artifacts: queryArtifacts }));
  const roles = Object.freeze({
    analysisArtifactNames: Object.freeze(
      input.artifacts
        .filter(({ role }) => role === 'analysis')
        .map(({ name }) => name)
        .sort(),
    ),
    systemArtifactNames: Object.freeze(
      input.artifacts
        .filter(({ role }) => role === 'system')
        .map(({ name }) => name)
        .sort(),
    ),
    policyArtifactNames: Object.freeze(
      input.artifacts
        .filter(({ role }) => role === 'policy')
        .map(({ name }) => name)
        .sort(),
    ),
    beforeArtifactName: input.artifacts.find(({ role }) => role === 'before')?.name ?? null,
    afterArtifactName: input.artifacts.find(({ role }) => role === 'after')?.name ?? null,
  });
  const resourceIndex = createMcpResourceIndex({
    artifacts: queryArtifacts,
    roles,
    ...(input.maxResourceBytes === undefined ? {} : { maxResourceBytes: input.maxResourceBytes }),
  });
  return Object.freeze({
    queryKernel,
    artifacts: queryKernel.artifacts,
    roles,
    resourceIndex,
    runtime: MCP_RUNTIME_METADATA,
  });
}
