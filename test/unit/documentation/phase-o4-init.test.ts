import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initCommand } from '../../../src/cli/commands/init.js';

describe('Phase O4.2 first-use documentation', () => {
  it('keeps the write boundary and golden interactive/headless paths explicit', async () => {
    const [guide, workflow, configuration, readme, index, plan] = await Promise.all([
      readFile(resolve('docs/first-use-workflow.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
      readFile(resolve('docs/project-configuration.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
    ]);

    expect(initCommand.usage).toBe(
      'api-intel init [repository] [--tsconfig <path>] [--write] [--format text|json]',
    );
    expect(workflow).toContain('The CLI has thirteen complete commands');
    expect(workflow).toContain(initCommand.usage);
    expect(guide).toContain('api-intel init . --write');
    expect(guide).toContain('api-intel scan . --with-graph --open');
    expect(guide).toContain('api-intel scan . --with-graph');
    expect(guide).toContain('There is deliberately no overwrite option');
    expect(guide).toContain('`completed_with_gaps` is not `completed`');
    expect(guide).toMatch(/does not prove that an\s+unreported runtime effect is absent/u);
    expect(configuration).toContain('`api-intel init .` previews');
    expect(readme).toContain('[First Evidence-Backed Trace](docs/first-use-workflow.md)');
    expect(index).toContain('[First evidence-backed trace](first-use-workflow.md)');
    expect(plan).toMatch(/### Phase O4\.2[\s\S]*?Status: complete/u);
  });
});
