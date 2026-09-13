import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase P2.2 reproducible CI scan documentation', () => {
  it('documents Gate CK0 provenance, isolation, and execution boundaries', async () => {
    const [plan, guide, evaluation, architecture, model, index, readme] = await Promise.all([
      readFile(
        resolve('backend_api_intelligence_platform_expansion_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('docs/ci-reproducible-scans.md'), 'utf8'),
      readFile(resolve('docs/ci-evaluation.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
    ]);

    expect(plan).toMatch(/### Phase P2\.2[\s\S]*?Status: complete/u);
    expect(guide).toContain('Gate CK0 is closed at the contract/preflight layer');
    expect(guide).toContain('pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile');
    expect(guide).toMatch(/repository-controlled\s+pnpm hook code/u);
    expect(guide).toContain('npm ci --ignore-scripts');
    expect(guide).toMatch(/must not retry with scripts or\s+pnpmfile hooks enabled/u);
    expect(guide).toContain('read but never write the trusted baseline cache');
    expect(guide).toContain('trusted prebuilt baseline artifact still records');
    expect(guide).toContain('`incompatible_baseline`');
    expect(evaluation).toContain('CiScanRecipeManifest');
    expect(architecture).toContain('Reproducible CI scan boundary');
    expect(model).toContain('CI reproducible-scan recipe contract');
    expect(index).toContain('Reproducible CI scan recipe');
    expect(readme).toContain('[Reproducible CI Scan Recipe](docs/ci-reproducible-scans.md)');
  });
});
