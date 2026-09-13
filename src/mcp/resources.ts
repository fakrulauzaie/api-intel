import { canonicalStringify } from '../model/ordering.js';
import type { QueryArtifactInput } from '../query/index.js';
import { describeQueryArtifact } from '../query/index.js';
import type { McpArtifactRoles, McpResourceIndex, McpResourceProjection } from './model.js';
import {
  DEFAULT_MCP_RESOURCE_MAX_BYTES,
  MCP_RESOURCE_SCHEMA_VERSION,
  MCP_RUNTIME_METADATA,
  McpStartupError,
} from './model.js';

const SUMMARY_URI = 'api-intel://registry/artifacts' as const;

interface IndexedRecord {
  readonly artifact: QueryArtifactInput;
  readonly collection: string;
  readonly record: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resourceProjection(
  uri: string,
  body: unknown,
  maximumBytes: number,
): McpResourceProjection {
  const text = canonicalStringify(body);
  const size = Buffer.byteLength(text, 'utf8');
  if (size > maximumBytes) {
    throw new Error(
      `MCP resource projection exceeds the ${maximumBytes}-byte limit (${size} bytes).`,
    );
  }
  return Object.freeze({ uri, mimeType: 'application/json', text });
}

function recordCollections(document: unknown): readonly [string, readonly unknown[]][] {
  if (!isRecord(document)) return [];
  return Object.entries(document)
    .filter((entry): entry is [string, readonly unknown[]] => Array.isArray(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right));
}

export function createMcpResourceIndex(input: {
  readonly artifacts: readonly QueryArtifactInput[];
  readonly roles: McpArtifactRoles;
  readonly maxResourceBytes?: number | undefined;
}): McpResourceIndex {
  const maximumBytes = input.maxResourceBytes ?? DEFAULT_MCP_RESOURCE_MAX_BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new McpStartupError(
      'INVALID_ARGUMENTS',
      'Resource projection byte limit must be a positive integer.',
    );
  }

  const descriptors = input.artifacts
    .map(describeQueryArtifact)
    .sort((left, right) => left.name.localeCompare(right.name));
  const descriptorByName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
  const evidenceByKey = new Map<string, IndexedRecord>();
  const recordsByKey = new Map<string, IndexedRecord>();

  for (const artifact of input.artifacts) {
    for (const [collection, values] of recordCollections(artifact.document)) {
      for (const value of values) {
        if (!isRecord(value) || typeof value.id !== 'string') continue;
        const entry = Object.freeze({ artifact, collection, record: value });
        const key = `${artifact.name}\u0000${value.id}`;
        const target = collection === 'evidence' ? evidenceByKey : recordsByKey;
        if (target.has(key)) {
          throw new McpStartupError(
            'ARTIFACT_SCHEMA_INVALID',
            `Artifact ${artifact.name} contains duplicate resource ID ${value.id}.`,
          );
        }
        target.set(key, entry);
      }
    }
  }

  const artifactNames = Object.freeze(descriptors.map(({ name }) => name));
  const envelope = (entry: IndexedRecord, uri: string, field: 'evidence' | 'record') =>
    resourceProjection(
      uri,
      {
        schemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
        artifact: descriptorByName.get(entry.artifact.name),
        collection: entry.collection,
        [field]: entry.record,
      },
      maximumBytes,
    );

  return Object.freeze({
    summaryUri: SUMMARY_URI,
    artifactNames,
    artifactSummary() {
      return resourceProjection(
        SUMMARY_URI,
        {
          schemaVersion: MCP_RESOURCE_SCHEMA_VERSION,
          runtime: MCP_RUNTIME_METADATA,
          roles: input.roles,
          artifacts: descriptors,
        },
        maximumBytes,
      );
    },
    evidence(artifactName: string, evidenceId: string) {
      const entry = evidenceByKey.get(`${artifactName}\u0000${evidenceId}`);
      if (entry === undefined) return null;
      const uri = `api-intel://artifact/${encodeURIComponent(artifactName)}/evidence/${encodeURIComponent(evidenceId)}`;
      return envelope(entry, uri, 'evidence');
    },
    record(artifactName: string, recordId: string) {
      const entry = recordsByKey.get(`${artifactName}\u0000${recordId}`);
      if (entry === undefined) return null;
      const uri = `api-intel://artifact/${encodeURIComponent(artifactName)}/record/${encodeURIComponent(recordId)}`;
      return envelope(entry, uri, 'record');
    },
  });
}
