import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI_COMMANDS = [
  'doctor',
  'init',
  'scan',
  'diff',
  'impact',
  'check',
  'openapi',
  'controls',
  'graph',
  'stitch',
  'endpoints',
  'trace',
  'report',
] as const;

const MCP_TOOLS = [
  'list_endpoints',
  'get_endpoint_trace',
  'resolve_symbol',
  'get_symbol_dependents',
  'compare_analyses',
  'get_change_impact',
  'find_distributed_candidates',
  'get_policy_results',
] as const;

function registeredMcpTools(source: string): string[] {
  return [...source.matchAll(/server\.registerTool\(\s*'([^']+)'/gu)]
    .map((match) => match[1]!)
    .sort();
}

describe('Phase O0.2 public identity and alpha surface contract', () => {
  it('freezes the selected identity and permits only the audited staged-public manifest state', async () => {
    const [boundary, packageText, index, plan] = await Promise.all([
      readFile(resolve('docs/public-release-boundary.md'), 'utf8'),
      readFile(resolve('package.json'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
    ]);
    const packageJson = JSON.parse(packageText) as {
      readonly name?: string;
      readonly private?: boolean;
      readonly license?: string;
      readonly bin?: Readonly<Record<string, string>>;
    };

    for (const selected of [
      '**Backend API Intelligence Engine**',
      '**Deterministic NestJS change intelligence**',
      '`api-intel`',
      '`@fakrulauzaie/api-intel`',
      'None adopted for alpha',
      'Apache-2.0; project-owned source authorized by owner',
    ]) {
      expect(boundary, `Public identity contract omits ${selected}`).toContain(selected);
    }
    expect(boundary).toContain('Exact external publication action authorized: yes');
    expect(boundary).toContain('E404 Not Found');
    expect(boundary).toContain('Availability can change at any time.');
    expect(packageJson).toMatchObject({
      name: '@fakrulauzaie/api-intel',
      license: 'Apache-2.0',
      bin: {
        'api-intel': 'dist/cli/index.js',
        'api-intel-mcp': 'dist/mcp/index.js',
      },
    });
    expect(packageJson.private === true || !Object.hasOwn(packageJson, 'private')).toBe(true);
    expect(index).toContain(
      '[Public identity and alpha surface contract](public-release-boundary.md)',
    );
    expect(plan).toMatch(/### Phase O0\.2[\s\S]*?Status: complete/u);
    expect(plan).toContain('Gate result (2026-09-09): passed.');
  });

  it('keeps the initial package CLI-first and freezes its finite command/tool names', async () => {
    const [boundary, cliSource, mcpSource] = await Promise.all([
      readFile(resolve('docs/public-release-boundary.md'), 'utf8'),
      readFile(resolve('src/cli/index.ts'), 'utf8'),
      readFile(resolve('src/mcp/tools.ts'), 'utf8'),
    ]);

    const sourceCommandOrder = [...cliSource.matchAll(/^\s{2}(\w+)Command,$/gmu)].map((match) =>
      match[1] === 'openApi' ? 'openapi' : match[1]!,
    );
    expect(sourceCommandOrder).toEqual(CLI_COMMANDS);
    expect(registeredMcpTools(mcpSource)).toEqual([...MCP_TOOLS].sort());
    for (const name of [...CLI_COMMANDS, ...MCP_TOOLS]) {
      expect(boundary, `Public boundary omits ${name}`).toMatch(new RegExp(`^${name}$`, 'mu'));
    }
    expect(boundary).toMatch(/no\s+supported JavaScript\/TypeScript import surface/u);
    expect(boundary).toContain('query-kernel imports');
  });

  it('assigns evidence-specific labels without upgrading deferred surfaces', async () => {
    const boundary = await readFile(resolve('docs/public-release-boundary.md'), 'utf8');

    for (const label of [
      '**core-alpha candidate**',
      '**hosted-validated preview**',
      '**locally verified preview**',
      '**mock-verified preview**',
      '**deferred**',
    ]) {
      expect(boundary, `Surface contract omits ${label}`).toContain(label);
    }
    expect(boundary).toContain('GitLab-hosted execution/catalog publication remains deferred.');
    expect(boundary).toContain('No real hosted comment mutation is claimed.');
    expect(boundary).toContain('O3.2 intentionally retains no named browser claim');
    expect(boundary).toContain('No universal MCP-host compatibility claim.');
  });

  it('separates maturity, package, schema, adapter, and compatibility versions', async () => {
    const [boundary, packageText, fixtureLockText, githubEvidence] = await Promise.all([
      readFile(resolve('docs/public-release-boundary.md'), 'utf8'),
      readFile(resolve('package.json'), 'utf8'),
      readFile(resolve('example-nestjs-app/package-lock.json'), 'utf8'),
      readFile(resolve('docs/benchmarks/phase-p3-1-github-action.md'), 'utf8'),
    ]);
    const packageJson = JSON.parse(packageText) as {
      readonly engines?: { readonly node?: string };
      readonly packageManager?: string;
      readonly dependencies?: { readonly typescript?: string };
    };
    const fixtureLock = JSON.parse(fixtureLockText) as {
      readonly packages?: Readonly<Record<string, { readonly version?: string }>>;
    };

    for (const channel of ['`internal`', '`alpha`', '`beta`', '`stable`', '`preview`']) {
      expect(boundary, `Maturity table omits ${channel}`).toContain(`| ${channel}`);
    }
    for (const domain of [
      'npm package semantic version',
      'analysis document schema version',
      'project configuration version',
      'MCP server/resource/tool contract versions',
      'distribution fingerprints',
    ]) {
      expect(boundary, `Version contract omits ${domain}`).toContain(domain);
    }
    expect(packageJson.engines?.node).toBe('>=22.13 <25');
    expect(packageJson.packageManager).toBe('pnpm@11.19.0');
    expect(packageJson.dependencies?.typescript).toBe('5.9.3');
    expect(boundary).toContain('Node.js 22.13.1; pnpm 11.19.0');
    expect(boundary).toContain('Node.js 22.14.0; pnpm 11.19.0');
    expect(githubEvidence).toContain('Runner: GitHub-hosted `ubuntu-24.04`');
    expect(fixtureLock.packages?.['node_modules/@nestjs/common']?.version).toBe('11.2.1');
    expect(fixtureLock.packages?.['node_modules/@nestjs/typeorm']?.version).toBe('11.0.3');
    expect(fixtureLock.packages?.['node_modules/typeorm']?.version).toBe('1.1.0');
    expect(fixtureLock.packages?.['node_modules/typescript']?.version).toBe('5.9.3');
    expect(boundary).toContain('Generated declaration stubs prove semantic rules');
    expect(boundary).toContain('When a version is not named above, say `unverified`');
  });

  it('records the cleared credential prerequisite without copying a secret', async () => {
    const [boundary, plan] = await Promise.all([
      readFile(resolve('docs/public-release-boundary.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
    ]);

    expect(boundary).toContain(
      'local Git remote previously contained an embedded GitHub credential',
    );
    expect(boundary).toMatch(/secret\s+value is intentionally omitted/u);
    expect(boundary).toMatch(/credential-free\s+HTTPS remote/u);
    expect(plan).toContain('Credential prerequisite cleared on 2026-09-09');
    expect(boundary).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/u);
    expect(plan).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/u);
  });
});
