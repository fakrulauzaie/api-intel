import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (typeof value !== 'object' || value === null) return keys;
  for (const [key, item] of Object.entries(value)) {
    keys.add(key);
    collectKeys(item, keys);
  }
  return keys;
}

describe('Phase O1.3 community, security, and maintenance contract', () => {
  it('publishes honest support, security, conduct, governance, and maintenance boundaries', async () => {
    const [
      readme,
      security,
      contributing,
      conduct,
      support,
      governance,
      maintainers,
      changelog,
      compatibility,
    ] = await Promise.all(
      [
        'README.md',
        'SECURITY.md',
        'CONTRIBUTING.md',
        'CODE_OF_CONDUCT.md',
        'SUPPORT.md',
        'GOVERNANCE.md',
        'MAINTAINERS.md',
        'CHANGELOG.md',
        'docs/compatibility-and-support.md',
      ].map((path) => readFile(resolve(path), 'utf8')),
    );
    if (security === undefined || conduct === undefined) {
      throw new Error('Security and conduct documents are required.');
    }

    expect(readme).toContain('## Community and support');
    expect(security).toContain('GitHub Private Vulnerability Reporting');
    expect(security).toContain('best-effort targets, not an SLA');
    expect(security).not.toMatch(/mailto:/u);
    const prepublicationChannels =
      /the\s+channel is not active/u.test(security) &&
      /A private conduct-reporting channel\s+has not yet been configured/u.test(conduct) &&
      conduct.includes('release blocker');
    const activeChannels =
      security.includes('https://github.com/fakrulauzaie/api-intel/security/advisories/new') &&
      conduct.includes('fakrulauzaie@gmail.com') &&
      !/channel is not active|has not yet been configured/iu.test(`${security}\n${conduct}`);
    expect(prepublicationChannels || activeChannels).toBe(true);
    expect(support).toMatch(/Support is best\s+effort/u);
    expect(support).toMatch(/latest\s+published prerelease/u);
    expect(contributing).toContain('inbound equals outbound');
    expect(contributing).toContain('Developer Certificate of Origin 1.1');
    expect(contributing).toContain('Every `Co-authored-by` identity');
    expect(governance).toContain('single-maintainer project');
    expect(governance).toContain('final decision maker and release authority');
    expect(maintainers).toContain('`@fakrulauzaie`');
    expect(changelog).toContain('## Unreleased');
    expect(changelog).toContain('Internal development snapshot');
    for (const label of ['supported', 'verified', 'unverified', 'unsupported']) {
      expect(compatibility).toContain(`**${label}:**`);
    }
    expect(compatibility).toContain('No public version is supported before the first alpha');
  });

  it('defines a strict source-free diagnostic manifest without sensitive field classes', async () => {
    const [guide, schemaText, exampleText] = await Promise.all([
      readFile(resolve('docs/support-diagnostic-manifest.md'), 'utf8'),
      readFile(resolve('schemas/support-diagnostic-manifest.schema.json'), 'utf8'),
      readFile(resolve('templates/support-diagnostic-manifest.example.json'), 'utf8'),
    ]);
    const schema = JSON.parse(schemaText) as {
      readonly additionalProperties?: boolean;
      readonly properties?: Readonly<Record<string, { readonly additionalProperties?: boolean }>>;
    };
    const example = JSON.parse(exampleText) as {
      readonly privacy?: Readonly<Record<string, boolean>>;
    };
    const keys = collectKeys(example);

    expect(schema.additionalProperties).toBe(false);
    const strictObjects = Object.values(schema.properties ?? {}).filter((property) =>
      Object.hasOwn(property, 'additionalProperties'),
    );
    expect(strictObjects.every(({ additionalProperties }) => additionalProperties === false)).toBe(
      true,
    );
    expect(example.privacy).toEqual({
      sourceIncluded: false,
      pathsIncluded: false,
      identifiersIncluded: false,
      snippetsIncluded: false,
      freeFormTextIncluded: false,
      reviewedByReporter: true,
    });
    for (const forbidden of [
      'repositoryPath',
      'repositoryRevision',
      'analysisId',
      'source',
      'snippet',
      'message',
      'subjectId',
      'evidenceIds',
      'notes',
    ]) {
      expect(keys.has(forbidden), `Example contains forbidden key ${forbidden}`).toBe(false);
    }
    expect(guide).toContain('Never attach the source');
    expect(guide).toContain('not a confidentiality guarantee');
  });

  it('installs bounded issue/PR intake and a least-privilege DCO workflow', async () => {
    const issueDirectory = resolve('.github/ISSUE_TEMPLATE');
    const issueFiles = (await readdir(issueDirectory)).sort();
    expect(issueFiles).toEqual([
      'analysis-accuracy.yml',
      'bug.yml',
      'config.yml',
      'feature.yml',
      'framework-support.yml',
    ]);
    const [config, workflow, pullRequest, codeowners, packageText] = await Promise.all([
      readFile(resolve(issueDirectory, 'config.yml'), 'utf8'),
      readFile(resolve('.github/workflows/dco.yml'), 'utf8'),
      readFile(resolve('.github/pull_request_template.md'), 'utf8'),
      readFile(resolve('.github/CODEOWNERS'), 'utf8'),
      readFile(resolve('package.json'), 'utf8'),
    ]);
    const forms = await Promise.all(
      issueFiles
        .filter((path) => path !== 'config.yml')
        .map((path) => readFile(resolve(issueDirectory, path), 'utf8')),
    );
    const packageJson = JSON.parse(packageText) as {
      readonly scripts?: Readonly<Record<string, string>>;
    };

    expect(config).toContain('blank_issues_enabled: false');
    expect(forms.every((form) => /synthetic/iu.test(form))).toBe(true);
    expect(workflow).toContain('pull_request:');
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).toMatch(/permissions:\s+contents: read/u);
    expect(workflow).not.toMatch(/uses:/u);
    expect(workflow).toContain('node scripts/check-dco.mjs --range');
    expect(pullRequest).toContain('`mustNotInfer`');
    expect(pullRequest).toContain('Every commit carries a matching `Signed-off-by`');
    expect(codeowners.trim()).toBe('* @fakrulauzaie');
    expect(packageJson.scripts?.['contrib:check-dco']).toBe('node scripts/check-dco.mjs');
  });

  it('indexes internal plans as history and records O1.3 without claiming OT0 passed', async () => {
    const [history, index, plan] = await Promise.all([
      readFile(resolve('docs/implementation-history.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
    ]);
    expect(history).toContain('Status: historical and non-normative');
    expect(history.match(/implementation_plan\.md\)/gu)).toHaveLength(8);
    expect(index).toContain('Implementation-plan history index');
    expect(plan).toMatch(
      /### Phase O1\.3[\s\S]*?Status: implementation complete; operational private-channel activation remains an\s+O5\.2 publication prerequisite/u,
    );
    expect(plan).toContain('OT0 remains open');
    expect(plan).toMatch(/No external repository, channel, account,\s+or publication was created/u);
  });
});
