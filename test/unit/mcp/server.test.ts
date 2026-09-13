import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMcpEntry } from '../../../src/mcp/index.js';
import {
  MCP_RUNTIME_METADATA,
  MCP_SDK_NAME,
  MCP_SDK_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from '../../../src/mcp/model.js';
import { loadMcpArtifactRegistry } from '../../../src/mcp/registry.js';
import { createArtifactMcpServer } from '../../../src/mcp/server.js';
import { serializeCanonicalAnalysis } from '../../../src/model/ordering.js';
import { QUERY_SCHEMA_VERSION } from '../../../src/query/index.js';
import { TOOL_NAME, TOOL_VERSION } from '../../../src/version.js';
import { createMinimalAnalysisDocumentV8 } from '../../helpers/minimal-analysis.js';
import { createTemporaryDirectory, type TemporaryDirectory } from '../../helpers/temp-directory.js';

interface StartupManifest {
  readonly schemaVersion: string;
  readonly server: { readonly name: string; readonly version: string };
  readonly transport: string;
  readonly startupInputs: readonly string[];
  readonly startupGuarantees: readonly string[];
  readonly deferredCapabilities: readonly string[];
}

const temporaryDirectories: TemporaryDirectory[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => directory.cleanup()));
});

async function analysisArtifact(): Promise<string> {
  const directory = await createTemporaryDirectory();
  temporaryDirectories.push(directory);
  const path = join(directory.path, 'analysis.json');
  await writeFile(path, serializeCanonicalAnalysis(createMinimalAnalysisDocumentV8()), 'utf8');
  return path;
}

describe('Phase P1.1 artifact-only MCP server substrate', () => {
  it('keeps independently versioned metadata while the current server advertises P1.2 capabilities', async () => {
    const path = await analysisArtifact();
    const registry = await loadMcpArtifactRegistry({
      artifacts: [{ role: 'analysis', name: 'health', path }],
    });
    const server = createArtifactMcpServer(registry);

    expect(server.server.getCapabilities()).toEqual({
      tools: { listChanged: true },
      resources: { listChanged: true },
      completions: {},
    });
    expect(MCP_RUNTIME_METADATA).toEqual({
      server: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      engine: { name: TOOL_NAME, version: TOOL_VERSION },
      querySchemaVersion: QUERY_SCHEMA_VERSION,
      sdk: { name: MCP_SDK_NAME, version: MCP_SDK_VERSION },
    });
    expect(MCP_RUNTIME_METADATA.querySchemaVersion).toBe(QUERY_SCHEMA_VERSION);
    expect(MCP_SERVER_VERSION).not.toBe(createMinimalAnalysisDocumentV8().schemaVersion);
  });

  it('validates artifacts before starting and keeps startup diagnostics off stdout', async () => {
    const path = await analysisArtifact();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const handle: StdioServerHandle = { close: async () => undefined };
    const startServer = vi.fn(() => handle);
    const result = await runMcpEntry(
      ['--analysis', `health=${path}`],
      {
        writeOut: (message) => stdout.push(message),
        writeError: (message) => stderr.push(message),
      },
      { startServer },
    );

    expect(result).toEqual({ exitCode: 0, serverStarted: true, handle });
    expect(startServer).toHaveBeenCalledOnce();
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      `${MCP_SERVER_NAME} ${MCP_SERVER_VERSION}: loaded 1 validated artifact(s); serving stdio.`,
    ]);
  });

  it('handles help, version, and startup rejection without opening a transport', async () => {
    const outputs: string[] = [];
    const errors: string[] = [];
    const handle: StdioServerHandle = { close: async () => undefined };
    const startServer = vi.fn(() => handle);
    const io = {
      writeOut: (message: string) => outputs.push(message),
      writeError: (message: string) => errors.push(message),
    };

    expect(await runMcpEntry(['--version'], io, { startServer })).toMatchObject({
      exitCode: 0,
      serverStarted: false,
    });
    expect(await runMcpEntry(['--help'], io, { startServer })).toMatchObject({
      exitCode: 0,
      serverStarted: false,
    });
    expect(await runMcpEntry([], io, { startServer })).toMatchObject({
      exitCode: 2,
      serverStarted: false,
    });
    expect(startServer).not.toHaveBeenCalled();
    expect(outputs[0]).toBe(MCP_SERVER_VERSION);
    expect(outputs[1]).toContain('Usage:');
    expect(errors).toEqual([
      'INVALID_ARGUMENTS: At least one artifact is required.',
      'Run "api-intel-mcp --help" for usage.',
    ]);
  });

  it('matches the frozen startup manifest and contains no scanner or target execution path', async () => {
    const manifest = JSON.parse(
      await readFile(resolve('test/fixtures/mcp/p1-1-startup.expected.json'), 'utf8'),
    ) as StartupManifest;
    expect(manifest).toEqual({
      schemaVersion: '1.0.0',
      server: { name: 'api-intel-artifact-server', version: '1.0.0' },
      transport: 'stdio',
      startupInputs: ['after', 'analysis', 'before', 'system'],
      startupGuarantees: [
        'artifact_only',
        'immutable_registry',
        'load_once_per_canonical_path',
        'stderr_diagnostics',
        'stdout_protocol_only',
        'validated_before_serve',
      ],
      deferredCapabilities: ['prompts', 'repository_scanning', 'resources', 'tools'],
    });

    const files = (await readdir(resolve('src/mcp'))).filter((name) => name.endsWith('.ts'));
    const source = (
      await Promise.all(files.map((name) => readFile(resolve('src/mcp', name), 'utf8')))
    ).join('\n');
    expect(source).not.toContain('scanRepository');
    expect(source).not.toMatch(/node:(?:child_process|net|http|https)/u);
    expect(source).not.toMatch(/\b(?:fetch|eval|Function)\s*\(/u);
    expect(source).not.toMatch(/\b(?:writeFile|appendFile|mkdir|rm|unlink)\b/u);
    expect(source).not.toContain('console.log');
  });
});
