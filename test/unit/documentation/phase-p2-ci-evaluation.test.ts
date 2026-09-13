import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase P2.1 CI evaluation documentation', () => {
  it('documents the portable contract, outcome taxonomy, and non-goals', async () => {
    const [plan, guide, architecture, model, index, readme] = await Promise.all([
      readFile(
        resolve('backend_api_intelligence_platform_expansion_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('docs/ci-evaluation.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
    ]);

    expect(plan).toMatch(/### Phase P2\.1[\s\S]*?Status: complete/u);
    expect(guide).toContain('CI evaluation schema 1.0.0');
    expect(guide).toContain('`incompatible_baseline`');
    expect(guide).toContain('neutral JSONL');
    expect(guide).toMatch(/does\s+not check out repositories/u);
    expect(architecture).toContain('Vendor-neutral CI evaluation boundary');
    expect(model).toContain('CI evaluation contract');
    expect(index).toContain('Vendor-neutral CI evaluation');
    expect(readme).toContain('[Vendor-Neutral CI Evaluation](docs/ci-evaluation.md)');
  });
});
