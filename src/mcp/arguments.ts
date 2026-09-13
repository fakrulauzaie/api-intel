import { parseArgs } from 'node:util';
import { queryArtifactNameSchema } from '../query/index.js';
import type { McpArguments, McpArtifactRole, McpArtifactSpec } from './model.js';
import { MCP_RUNTIME_METADATA, McpStartupError } from './model.js';

export function renderMcpHelp(): string {
  return `${MCP_RUNTIME_METADATA.server.name} ${MCP_RUNTIME_METADATA.server.version}

Read-only MCP server over explicitly supplied canonical api-intel artifacts.

Usage:
  api-intel-mcp --analysis <name>=<analysis.json> [--analysis ...]
                [--system <name>=<system-analysis.json> ...]
                [--policy <name>=<policy-results.json> ...]
                [--before <name>=<analysis.json> --after <name>=<analysis.json>]
  api-intel-mcp --help
  api-intel-mcp --version

Options:
  --analysis  Register a completed analysis artifact. Repeatable.
  --system    Register a validated system-analysis artifact. Repeatable.
  --policy    Register a validated policy-results artifact. Repeatable.
  --before    Register the named baseline analysis for comparison/impact queries.
  --after     Register the named current analysis for comparison/impact queries.

Artifact names must be unique. Before and after must be supplied together.`;
}

function artifactSpec(role: McpArtifactRole, value: string): McpArtifactSpec {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new McpStartupError(
      'INVALID_ARGUMENTS',
      `--${role} must use <artifact-name>=<artifact-json-path>.`,
    );
  }
  const name = value.slice(0, separator);
  if (!queryArtifactNameSchema.safeParse(name).success) {
    throw new McpStartupError('INVALID_ARGUMENTS', `Invalid artifact name: ${name}.`);
  }
  return { role, name, path: value.slice(separator + 1) };
}

function valuesFor(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

export function parseMcpArguments(args: readonly string[]): McpArguments {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: false,
      strict: true,
      options: {
        analysis: { type: 'string', multiple: true },
        system: { type: 'string', multiple: true },
        policy: { type: 'string', multiple: true },
        before: { type: 'string' },
        after: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new McpStartupError(
      'INVALID_ARGUMENTS',
      error instanceof Error ? error.message : 'Invalid MCP server arguments.',
      { cause: error },
    );
  }

  if (parsed.values.help === true || parsed.values.version === true) {
    const hasArtifactArguments =
      parsed.values.analysis !== undefined ||
      parsed.values.system !== undefined ||
      parsed.values.policy !== undefined ||
      parsed.values.before !== undefined ||
      parsed.values.after !== undefined;
    if (hasArtifactArguments || (parsed.values.help === true && parsed.values.version === true)) {
      throw new McpStartupError(
        'INVALID_ARGUMENTS',
        'Help or version must be requested without artifact arguments.',
      );
    }
    return { mode: parsed.values.help === true ? 'help' : 'version' };
  }

  if ((parsed.values.before === undefined) !== (parsed.values.after === undefined)) {
    throw new McpStartupError(
      'INVALID_ARGUMENTS',
      '--before and --after must be supplied together.',
    );
  }

  const artifacts = [
    ...valuesFor(parsed.values.analysis).map((value) => artifactSpec('analysis', value)),
    ...valuesFor(parsed.values.system).map((value) => artifactSpec('system', value)),
    ...valuesFor(parsed.values.policy).map((value) => artifactSpec('policy', value)),
    ...(parsed.values.before === undefined ? [] : [artifactSpec('before', parsed.values.before)]),
    ...(parsed.values.after === undefined ? [] : [artifactSpec('after', parsed.values.after)]),
  ];
  if (artifacts.length === 0) {
    throw new McpStartupError('INVALID_ARGUMENTS', 'At least one artifact is required.');
  }
  const names = new Set<string>();
  for (const artifact of artifacts) {
    if (names.has(artifact.name)) {
      throw new McpStartupError(
        'INVALID_ARGUMENTS',
        `Artifact name ${artifact.name} is registered more than once.`,
      );
    }
    names.add(artifact.name);
  }
  return { mode: 'serve', artifacts };
}
