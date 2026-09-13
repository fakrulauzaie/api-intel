import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase P5.1 sanitized CI comment documentation', () => {
  it('freezes the pure projection, safety limits, upsert, and publisher boundaries', async () => {
    const [plan, guide, evaluation, architecture, model, index, readme] = await Promise.all([
      readFile(
        resolve('backend_api_intelligence_platform_expansion_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('docs/ci-comment.md'), 'utf8'),
      readFile(resolve('docs/ci-evaluation.md'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
    ]);

    expect(plan).toMatch(/### Phase P5\.1[\s\S]*?Status: complete/u);
    expect(guide).toContain('`CiCommentDocument`');
    expect(guide).toMatch(/60,000 rendered\s+Markdown bytes/u);
    expect(guide).toMatch(/credential-free absolute HTTPS\s+URLs/u);
    expect(guide).toContain('`validateCiCommentAgainstEvaluation()`');
    expect(guide).toContain('<!-- api-intel:ci-evaluation:v1 -->');
    expect(guide).toContain('Possession of the marker does not authorize an update');
    expect(evaluation).toContain('Optional sanitized comment projection');
    expect(architecture).toContain('Sanitized CI comment boundary');
    expect(model).toContain('## Sanitized CI comment contract');
    expect(index).toContain('Sanitized CI comment contract');
    expect(readme).toContain('[Sanitized CI Comment Contract](docs/ci-comment.md)');
  });
});
