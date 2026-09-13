#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseMcpArguments, renderMcpHelp } from './arguments.js';
import type { McpEntryResult, McpProcessIo } from './model.js';
import { MCP_EXIT_CODE, MCP_RUNTIME_METADATA, McpStartupError } from './model.js';
import { loadMcpArtifactRegistry } from './registry.js';
import { serveArtifactMcpServer } from './server.js';

const processIo: McpProcessIo = {
  writeOut(message) {
    process.stdout.write(`${message}\n`);
  },
  writeError(message) {
    process.stderr.write(`${message}\n`);
  },
};

export interface McpEntryDependencies {
  readonly startServer: typeof serveArtifactMcpServer;
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  if (entryPath === undefined) return false;

  const resolvedEntryPath = resolve(entryPath);
  if (pathToFileURL(resolvedEntryPath).href === import.meta.url) return true;

  try {
    // POSIX package-manager bins preserve the node_modules/.bin symlink in
    // argv[1], whereas import.meta.url identifies the installed package file.
    return realpathSync(resolvedEntryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

export async function runMcpEntry(
  args: readonly string[] = process.argv.slice(2),
  io: McpProcessIo = processIo,
  dependencies: McpEntryDependencies = { startServer: serveArtifactMcpServer },
): Promise<McpEntryResult> {
  try {
    const parsed = parseMcpArguments(args);
    if (parsed.mode === 'help') {
      io.writeOut(renderMcpHelp());
      return { exitCode: MCP_EXIT_CODE.success, serverStarted: false, handle: null };
    }
    if (parsed.mode === 'version') {
      io.writeOut(MCP_RUNTIME_METADATA.server.version);
      return { exitCode: MCP_EXIT_CODE.success, serverStarted: false, handle: null };
    }
    const registry = await loadMcpArtifactRegistry({
      artifacts: parsed.artifacts,
      ...(io.signal === undefined ? {} : { signal: io.signal }),
    });
    io.writeError(
      `${MCP_RUNTIME_METADATA.server.name} ${MCP_RUNTIME_METADATA.server.version}: loaded ${registry.artifacts.length} validated artifact(s); serving stdio.`,
    );
    const handle = dependencies.startServer(registry, io);
    return { exitCode: MCP_EXIT_CODE.success, serverStarted: true, handle };
  } catch (error) {
    if (io.signal?.aborted === true) throw error;
    if (error instanceof McpStartupError) {
      io.writeError(`${error.code}: ${error.message}`);
      io.writeError('Run "api-intel-mcp --help" for usage.');
      return { exitCode: MCP_EXIT_CODE.usageError, serverStarted: false, handle: null };
    }
    const detail = error instanceof Error ? error.message : 'Unexpected internal error.';
    io.writeError(`INTERNAL_ERROR: ${detail}`);
    return { exitCode: MCP_EXIT_CODE.internalError, serverStarted: false, handle: null };
  }
}

if (isDirectExecution()) {
  const controller = new AbortController();
  const cancel = (): void => controller.abort(new Error('Canceled by user.'));
  process.once('SIGINT', cancel);
  runMcpEntry(process.argv.slice(2), { ...processIo, signal: controller.signal })
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'Unexpected internal error.';
      processIo.writeError(detail);
      process.exitCode = MCP_EXIT_CODE.internalError;
    })
    .finally(() => process.removeListener('SIGINT', cancel));
}
