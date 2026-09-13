import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase P3.2 GitLab merge-request gate documentation', () => {
  it('freezes the component, native report, artifacts, trust boundary, and support status', async () => {
    const [
      plan,
      guide,
      example,
      component,
      container,
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
      readFile(resolve('docs/gitlab-ci.md'), 'utf8'),
      readFile(resolve('docs/examples/gitlab/api-intel-merge-request.yml'), 'utf8'),
      readFile(resolve('templates/api-intel/template.yml'), 'utf8'),
      readFile(resolve('packaging/gitlab/Dockerfile'), 'utf8'),
      readFile(resolve('test/fixtures/gitlab-ci/p3-2.expected.json'), 'utf8'),
      readFile(resolve('docs/architecture.md'), 'utf8'),
      readFile(resolve('docs/model-contract.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
    ]);
    const expected = JSON.parse(fixture) as {
      pipelineSource: string;
      minimumGitLabVersion: string;
      baselineVariable: string;
      candidateVariable: string;
      limits: { findings: number; summaryBytes: number };
      evaluationArtifactFiles: string[];
      publicationFiles: string[];
    };

    expect(plan).toMatch(
      /### Phase P3\.2[\s\S]*?Status: implementation complete; GitLab\.com release validation deferred/u,
    );
    expect(guide).toContain(`GitLab ${expected.minimumGitLabVersion}+`);
    expect(guide).toContain("the merge request's **diff base**");
    expect(guide).toContain('does not create merge-request notes');
    expect(guide).toContain('never publish guessed findings');
    expect(guide).toContain('Hosted GitLab.com release validation is explicitly deferred');
    expect(guide).toContain('Cytoscape browser assets');
    expect(guide).toContain('not evidence for GitLab image');
    expect(component).toContain(`'$CI_PIPELINE_SOURCE == "${expected.pipelineSource}"'`);
    expect(component).toContain(expected.baselineVariable);
    expect(component).toContain(expected.candidateVariable);
    expect(component).toContain('artifacts:\n    when: always');
    expect(component).toContain('reports:\n      codequality:');
    expect(component).toContain(`default: ${expected.limits.findings}`);
    expect(component).toContain('regex: ^.+@sha256:[a-f0-9]{64}$');
    expect(component).not.toContain('CI_JOB_TOKEN');
    expect(component).not.toContain('CI_API_V4_URL');
    expect(component).not.toContain('curl ');
    expect(example).toContain('@COMPONENT_COMMIT_SHA');
    expect(example).toContain('@sha256:IMAGE_MANIFEST_DIGEST');
    expect(container).toContain('ARG NODE_IMAGE');
    expect(container).toContain('COPY gitlab-dist/ /opt/api-intel/gitlab-dist/');
    for (const file of [...expected.evaluationArtifactFiles, ...expected.publicationFiles]) {
      expect(guide).toContain(file);
    }
    expect(guide).toContain(`${expected.limits.summaryBytes / 1_024} KiB`);
    expect(architecture).toContain('GitLab merge-request adapter boundary');
    expect(model).toContain('GitLab CI projection and artifact manifest');
    expect(index).toContain('GitLab merge-request gate');
    expect(readme).toContain('[GitLab Merge-Request Gate](docs/gitlab-ci.md)');
  });
});
