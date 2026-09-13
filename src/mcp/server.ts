import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { McpArtifactRegistry, McpProcessIo } from './model.js';
import { MCP_RUNTIME_METADATA } from './model.js';
import { registerMcpResources } from './resource-server.js';
import { registerMcpTools } from './tools.js';

export interface ArtifactMcpServerOptions {
  readonly maxToolResponseBytes?: number | undefined;
}

export function createArtifactMcpServer(
  registry: McpArtifactRegistry,
  options: ArtifactMcpServerOptions = {},
): McpServer {
  const server = new McpServer(MCP_RUNTIME_METADATA.server);
  registerMcpTools(server, registry, options);
  registerMcpResources(server, registry);
  return server;
}

export function serveArtifactMcpServer(
  registry: McpArtifactRegistry,
  io: Pick<McpProcessIo, 'writeError'>,
): StdioServerHandle {
  return serveStdio(() => createArtifactMcpServer(registry), {
    onerror(error) {
      io.writeError(`MCP transport error: ${error.message}`);
    },
  });
}
