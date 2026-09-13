import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { queryArtifactNameSchema } from '../query/index.js';
import type { McpArtifactRegistry, McpResourceProjection } from './model.js';

export const MCP_RESOURCE_TEMPLATES = [
  'api-intel://artifact/{artifactName}/evidence/{evidenceId}',
  'api-intel://artifact/{artifactName}/record/{recordId}',
] as const;

function contents(resource: McpResourceProjection) {
  return {
    contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }],
  };
}

function matchingCompletions(values: readonly string[], prefix: string): string[] {
  return values.filter((value) => value.startsWith(prefix));
}

function decodedVariable(value: unknown, kind: 'artifact' | 'record'): string {
  const encoded = String(value);
  if (encoded.length > 768) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Invalid resource selector.');
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Invalid resource selector.');
  }
  const valid =
    kind === 'artifact'
      ? queryArtifactNameSchema.safeParse(decoded).success
      : decoded.length >= 1 && decoded.length <= 256;
  if (!valid) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Invalid resource selector.');
  }
  return decoded;
}

export function registerMcpResources(server: McpServer, registry: McpArtifactRegistry): void {
  const index = registry.resourceIndex;
  server.registerResource(
    'artifact-registry-summary',
    index.summaryUri,
    {
      title: 'API Intelligence artifact registry',
      description: 'Bounded descriptors and explicit startup roles for the immutable registry.',
      mimeType: 'application/json',
    },
    () => contents(index.artifactSummary()),
  );

  server.registerResource(
    'canonical-evidence-record',
    new ResourceTemplate(MCP_RESOURCE_TEMPLATES[0], {
      list: undefined,
      complete: {
        artifactName: (prefix) => matchingCompletions(index.artifactNames, prefix),
      },
    }),
    {
      title: 'Canonical evidence record',
      description: 'One exact evidence record from a named analysis artifact.',
      mimeType: 'application/json',
    },
    (uri, variables) => {
      const artifactName = decodedVariable(variables.artifactName, 'artifact');
      const evidenceId = decodedVariable(variables.evidenceId, 'record');
      const resource = index.evidence(artifactName, evidenceId);
      if (resource === null) throw new ResourceNotFoundError(uri.href);
      return contents(resource);
    },
  );

  server.registerResource(
    'canonical-record',
    new ResourceTemplate(MCP_RESOURCE_TEMPLATES[1], {
      list: undefined,
      complete: {
        artifactName: (prefix) => matchingCompletions(index.artifactNames, prefix),
      },
    }),
    {
      title: 'Canonical artifact record',
      description: 'One exact canonical top-level record from a named validated artifact.',
      mimeType: 'application/json',
    },
    (uri, variables) => {
      const artifactName = decodedVariable(variables.artifactName, 'artifact');
      const recordId = decodedVariable(variables.recordId, 'record');
      const resource = index.record(artifactName, recordId);
      if (resource === null) throw new ResourceNotFoundError(uri.href);
      return contents(resource);
    },
  );
}
