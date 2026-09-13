import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phases P4.1-P4.2 differential system-impact documentation', () => {
  it('freezes comparison, conditional propagation, and CI acquisition boundaries', async () => {
    const [plan, guide, architecture, model, index, readme] = await Promise.all([
      readFile(
        resolve('backend_api_intelligence_platform_expansion_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('docs/system-impact.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
    ]);

    expect(plan).toMatch(/### Phase P4\.1[\s\S]*?Status: complete/u);
    expect(plan).toMatch(/### Phase P4\.2[\s\S]*?Status: complete/u);
    expect(guide).toContain('`available`');
    expect(guide).toContain('`not_present`');
    expect(guide).toContain('`missing`');
    expect(guide).toContain('`incompatible`');
    expect(guide).toContain('Queue/pattern-text-only producer/consumer matching');
    expect(guide).toContain('"phase_p4_1_contract_only"');
    expect(guide).toContain('"distributed_conditional"');
    expect(guide).toContain('target-only, ambiguous, and unmatched');
    expect(guide).toContain('renderOfflineSystemImpactReport');
    expect(architecture).toContain('Phase P4.2 is a second pure boundary');
    expect(model).toContain('## Differential system-impact contract');
    expect(index).toContain('Differential system impact');
    expect(readme).toContain('[Differential System Impact](docs/system-impact.md)');
  });
});
