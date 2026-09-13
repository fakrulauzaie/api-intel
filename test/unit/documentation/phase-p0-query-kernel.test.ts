import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Milestone P0 vendor-neutral query kernel documentation', () => {
  it('documents the completed selectors, operations, and Gate PK0 boundary', async () => {
    const [plan, guide, architecture, model, index] = await Promise.all([
      readFile(
        resolve('backend_api_intelligence_platform_expansion_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('docs/query-kernel.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
    ]);

    expect(plan).toMatch(/### Phase P0\.1[\s\S]*?Status: complete/u);
    expect(plan).toMatch(/### Phase P0\.2[\s\S]*?Status: complete/u);
    expect(plan).toMatch(/Gate PK0 is frozen/u);
    expect(guide).toContain('`not_found`, `resolved`, or `ambiguous`');
    expect(guide).toMatch(/no repository scan, target import or execution/u);
    expect(guide).toContain('`getSymbolDependents` is current-snapshot reverse reachability');
    expect(guide).toContain('`findDistributedCandidates` requires both');
    expect(guide).toMatch(/`unknown` is never rewritten as\s+`fail`/u);
    expect(architecture).toContain('Vendor-neutral query boundary');
    expect(model).toContain('Query response contract');
    expect(index).toContain('Vendor-neutral query kernel');
  });
});
