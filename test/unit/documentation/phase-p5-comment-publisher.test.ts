import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase P5.2 privileged comment publisher documentation', () => {
  it('freezes separation, trusted source binding, bounded upsert, and fallback semantics', async () => {
    const [plan, guide, comment, architecture, model, github, gitlab, index, readme] =
      await Promise.all([
        readFile(
          resolve('backend_api_intelligence_platform_expansion_implementation_plan.md'),
          'utf8',
        ),
        readFile(resolve('docs/ci-comment-publisher.md'), 'utf8'),
        readFile(resolve('docs/ci-comment.md'), 'utf8'),
        readFile(resolve('docs/architecture.md'), 'utf8'),
        readFile(resolve('docs/model-contract.md'), 'utf8'),
        readFile(resolve('docs/github-action.md'), 'utf8'),
        readFile(resolve('docs/gitlab-ci.md'), 'utf8'),
        readFile(resolve('docs/README.md'), 'utf8'),
        readFile(resolve('README.md'), 'utf8'),
      ]);

    expect(plan).toMatch(/### Phase P5\.2[\s\S]*?Status: complete/u);
    expect(guide).toContain('never checks out, imports, installs, or executes candidate content');
    expect(guide).toContain('expectedBaselineRevision');
    expect(guide).toContain('expectedCandidateRevision');
    expect(guide).toContain('AMBIGUOUS_UPSERT_TARGET');
    expect(guide).toContain('1 MiB per JSON response');
    expect(guide).toContain('`permission_unavailable`');
    expect(guide).toMatch(/does\s+not yet claim a real hosted comment mutation/u);
    expect(comment).toContain('[Optional CI Comment Publisher](ci-comment-publisher.md)');
    expect(architecture).toContain('## Privileged CI comment boundary');
    expect(model).toContain('## CI comment publication result');
    expect(github).toContain('never add its write token');
    expect(gitlab).toContain('never expose that token');
    expect(index).toContain('Optional CI comment publisher');
    expect(readme).toContain('[Optional CI Comment Publisher](docs/ci-comment-publisher.md)');
  });
});
