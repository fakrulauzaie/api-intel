import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSystemStitchingGateManifest } from '../../helpers/system-stitching-gate-manifest.js';

const supportedLabels = [
  'core-alpha candidate',
  'hosted-validated preview',
  'locally verified preview',
  'mock-verified preview',
] as const;

describe('Phase O4.3 public documentation and fixtures', () => {
  it('keeps the public front door concise and puts positioning and proof stops first', async () => {
    const readme = await readFile(resolve('README.md'), 'utf8');
    const positioning = readme.indexOf('Evidence-backed blast radius for legacy NestJS systems.');
    const proofBoundary = readme.indexOf('reports exactly where proof stops');
    const firstFeatureTable = readme.indexOf('## What it can prove');

    expect(positioning).toBeGreaterThanOrEqual(0);
    expect(proofBoundary).toBeGreaterThan(positioning);
    expect(firstFeatureTable).toBeGreaterThan(proofBoundary);
    expect(readme.split(/\r?\n/u).length).toBeLessThanOrEqual(240);
    expect(readme).toContain('api-intel scan . --with-graph --open');
    expect(readme).toContain('![A supported endpoint path');
    expect(readme).not.toContain('runtime-validated');
    expect(readme).not.toMatch(/npm (?:install|i) @fakrulauzaie\/api-intel/u);
  });

  it('tracks the public visual and synthetic examples as project-owned material', async () => {
    const [visual, provenance, fixtureReadme, expectedText, gateText] = await Promise.all([
      readFile(resolve('docs/assets/evidence-path.svg'), 'utf8'),
      readFile(resolve('docs/legal/fixture-provenance.md'), 'utf8'),
      readFile(resolve('docs/examples/synthetic-legacy-system/README.md'), 'utf8'),
      readFile(resolve('docs/examples/synthetic-legacy-system/expected-summary.json'), 'utf8'),
      readFile(resolve('test/fixtures/system-stitching/gate.expected.json'), 'utf8'),
    ]);
    const publicExpected = JSON.parse(expectedText) as {
      readonly artifactKind: string;
      readonly schemaVersion: string;
      readonly sourceCase: unknown;
    };
    const gate = parseSystemStitchingGateManifest(JSON.parse(gateText) as unknown);
    const sourceCase = gate.cases.find(
      ({ caseId }) => caseId === 'microservices-multi-service-declared-realm',
    );

    expect(visual).toContain('<title id="title">api-intel evidence path example</title>');
    expect(visual).toContain('proof stops here');
    expect(provenance).toContain('`docs/assets/evidence-path.svg`');
    expect(provenance).toContain('not private output, a browser screenshot');
    expect(fixtureReadme).toContain('Refactoring story');
    expect(fixtureReadme).toContain('must not imply broker');
    expect(publicExpected).toEqual({
      artifactKind: 'public-synthetic-system-expectation',
      schemaVersion: '1.0.0',
      sourceCase,
    });
    await stat(resolve('example-nestjs-app/expected/analysis.json'));
  });

  it('publishes exact support labels, limitations, and source-free reproduction rules', async () => {
    const [readme, compatibility, limitations, support, reproduction, schemaText, packageText] =
      await Promise.all([
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/compatibility-and-support.md'), 'utf8'),
        readFile(resolve('docs/current-limitations.md'), 'utf8'),
        readFile(resolve('SUPPORT.md'), 'utf8'),
        readFile(resolve('docs/minimal-reproduction.md'), 'utf8'),
        readFile(resolve('schemas/support-diagnostic-manifest.schema.json'), 'utf8'),
        readFile(resolve('package.json'), 'utf8'),
      ]);
    const schema = JSON.parse(schemaText) as { readonly $schema?: string };
    const packageJson = JSON.parse(packageText) as {
      readonly exports?: Readonly<Record<string, string>>;
    };

    for (const label of supportedLabels) {
      expect(readme).toContain(label);
      expect(compatibility).toContain(label);
    }
    expect(compatibility).toContain('no named-browser support claim');
    expect(limitations).toMatch(/absence of behavior outside the documented static\s+patterns/u);
    expect(support).toContain('[source-free reproduction workflow]');
    expect(reproduction).toContain('Do **not** attach `analysis.json`');
    expect(reproduction).toContain(
      '@fakrulauzaie/api-intel/schemas/support-diagnostic-manifest.schema.json',
    );
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(packageJson.exports?.['./schemas/support-diagnostic-manifest.schema.json']).toBe(
      './schemas/support-diagnostic-manifest.schema.json',
    );
  });

  it('defines every required contribution-fixture class and clean-checkout gate', async () => {
    const [guide, contributing] = await Promise.all([
      readFile(resolve('docs/contributor-fixtures.md'), 'utf8'),
      readFile(resolve('CONTRIBUTING.md'), 'utf8'),
    ]);
    for (const fixtureClass of [
      'Positive',
      'Close-negative',
      'Diagnostic',
      'Evidence',
      'Compatibility',
      'Performance',
    ]) {
      expect(guide).toMatch(new RegExp(`\\| ${fixtureClass}\\s+\\|`, 'u'));
    }
    for (const command of [
      'pnpm install --frozen-lockfile --ignore-scripts',
      'pnpm run format:check',
      'pnpm run lint',
      'pnpm run typecheck',
      'pnpm run build',
      'pnpm run schema:check',
      'pnpm run compatibility:check',
      'pnpm run test',
      'pnpm run audit:public',
    ]) {
      expect(guide).toContain(command);
    }
    expect(contributing).toContain('[contributor fixture contract]');
    expect(guide).toContain('Write the expected semantic manifest before extractor code');
  });

  it('uses only installed public commands in the first-use guide', async () => {
    const guidePath = resolve('docs/first-use-workflow.md');
    const guide = await readFile(guidePath, 'utf8');
    const fencedCommands = [...guide.matchAll(/```text\s+([\s\S]*?)```/gu)]
      .flatMap((match) => match[1]!.split(/\r?\n/u))
      .map((line) => line.trim())
      .filter((line) => line.startsWith('api-intel '));
    const commandNames = new Set([
      'doctor',
      'init',
      'scan',
      'endpoints',
      'trace',
      'diff',
      'impact',
      'graph',
      'check',
    ]);

    expect(fencedCommands.length).toBeGreaterThan(8);
    for (const command of fencedCommands) {
      expect(commandNames.has(command.split(/\s+/u)[1]!)).toBe(true);
    }
    expect(guide).not.toMatch(/```text[\s\S]*?pnpm run cli --[\s\S]*?```/u);
    expect(dirname(guidePath)).toBe(resolve('docs'));
  });
});
