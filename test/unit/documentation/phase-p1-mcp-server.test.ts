import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase P1 local MCP documentation', () => {
  it('documents explicit artifacts, Gate MK0 hardening, and multiple local hosts', async () => {
    const [plan, guide, architecture, model, index, readme, cli, evaluation] = await Promise.all([
      readFile(
        resolve('backend_api_intelligence_platform_expansion_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('docs/mcp-server.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
      readFile(resolve('docs/benchmarks/phase-p1-3-mcp-evaluation.md'), 'utf8'),
    ]);

    expect(plan).toMatch(/### Phase P1\.1[\s\S]*?Status: complete/u);
    expect(plan).toMatch(/P1\.2[\s\S]*?Status: complete/u);
    expect(plan).toMatch(/P1\.3[\s\S]*?Status: complete/u);
    expect(guide).toContain('Every tool returns its strict P0 response as structured content');
    expect(guide).toContain('The server exposes no whole-document resource');
    expect(guide).toMatch(/stdout is reserved for MCP protocol\s+frames/u);
    expect(guide).toContain('reads and parses each canonical file once');
    expect(guide).toContain('--policy <name>=<policy-results.json>');
    expect(guide).toContain('--before <name>=<analysis.json> --after <name>=<analysis.json>');
    expect(guide).toContain('The complete canonical serialization of a successful tool result');
    expect(guide).toContain('Each tool yields to the protocol dispatcher');
    expect(guide).toContain('### VS Code');
    expect(guide).toContain('### Cursor');
    expect(guide).toContain('Gate MK0 is closed');
    expect(architecture).toContain('Local MCP startup boundary');
    expect(architecture).toContain('Phase P1.3 adds an adapter-level 512 KiB ceiling');
    expect(model).toContain('MCP startup registry contract');
    expect(model).toContain('independently as `1.2.0`');
    expect(index).toContain('Local artifact MCP server');
    expect(readme).toContain('[Local Artifact MCP Server](docs/mcp-server.md)');
    expect(cli).toContain('not a fourteenth source/report command');
    expect(evaluation).toContain('not a live');
    expect(evaluation).toContain('| `artifactGrounded`');
  });
});
