import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase P3.1 GitHub pull-request gate documentation', () => {
  it('freezes the read-only workflow, pins, limits, outputs, and honesty boundary', async () => {
    const [
      plan,
      guide,
      validation,
      workflow,
      metadata,
      fixture,
      architecture,
      model,
      index,
      readme,
    ] = await Promise.all([
      readFile(
        resolve('backend_api_intelligence_platform_expansion_implementation_plan.md'),
        'utf8',
      ),
      readFile(resolve('docs/github-action.md'), 'utf8'),
      readFile(resolve('docs/benchmarks/phase-p3-1-github-action.md'), 'utf8'),
      readFile(resolve('docs/examples/github/api-intel-pull-request.yml'), 'utf8'),
      readFile(resolve('action.yml'), 'utf8'),
      readFile(resolve('test/fixtures/github-action/p3-1.expected.json'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
    ]);
    const expected = JSON.parse(fixture) as {
      limits: { annotations: number; summaryBytes: number };
      pinnedActions: Record<string, string>;
      artifactFiles: string[];
    };

    expect(plan).toMatch(/### Phase P3\.1[\s\S]*?Status: complete and hosted-validated/u);
    expect(guide).toContain('ordinary `pull_request`');
    expect(guide).toContain('`pull_request_target` is rejected');
    expect(guide).toContain('configuration always come from the trusted baseline');
    expect(guide).toContain('bind each analyzed Git `HEAD` to the exact PR base/head');
    expect(guide).toContain('never retried enabled');
    expect(guide).toContain('does not call the GitHub API');
    expect(guide).toContain('`cytoscape.min.js`');
    expect(guide).toContain('`f5e60a39231f11cc28cbb75c3772032cb38880d5`');
    expect(validation).toContain("Cannot find module 'cytoscape/dist/cytoscape.min.js'");
    expect(validation).toContain('GitLab-hosted validation was not part of this GitHub run');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('baseline-revision: ${{ github.event.pull_request.base.sha }}');
    expect(workflow).toContain('candidate-revision: ${{ github.event.pull_request.head.sha }}');
    expect(workflow).not.toContain('pull_request_target:');
    for (const pin of Object.values(expected.pinnedActions)) {
      expect(`${workflow}\n${metadata}`).toContain(pin);
    }
    for (const file of expected.artifactFiles) expect(guide).toContain(file);
    expect(metadata).toMatch(new RegExp(`default: ['"]${expected.limits.annotations}['"]`, 'u'));
    expect(guide).toContain(`${expected.limits.summaryBytes / 1_024} KiB`);
    expect(architecture).toContain('GitHub pull-request adapter boundary');
    expect(model).toContain('GitHub CI projection and artifact manifest');
    expect(index).toContain('GitHub pull-request gate');
    expect(readme).toContain('[GitHub Pull-Request Gate](docs/github-action.md)');
  });
});
