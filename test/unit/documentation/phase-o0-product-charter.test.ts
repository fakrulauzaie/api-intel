import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PRIMARY_POSITIONING = 'Evidence-backed blast radius for legacy NestJS systems.';
const PROOF_CLAIM =
  'api-intel proves supported static paths to potential side-effect operations and reports exactly where proof stops.';

const HISTORICAL_DOC_DIRECTORIES = new Set(['adr', 'benchmarks', 'examples', 'spikes']);
const HISTORICAL_DOC_FILES = new Set(['distributed-gate-d0.md', 'real-repository-validation.md']);

const PUBLIC_NON_MARKDOWN_SURFACES = [
  'package.json',
  'action.yml',
  'packaging/gitlab/Dockerfile',
  'src/cli/index.ts',
  'src/impact/markdown.ts',
  'src/ci-evaluation/markdown.ts',
  'src/ci-comment/render.ts',
  'src/github-action/project.ts',
  'src/gitlab-ci/project.ts',
  'src/graph-report/app-script.ts',
  'src/system-report/html.ts',
] as const;

const PROHIBITED_ASSERTIVE_CLAIMS = [
  /\b100%\s+(?:accurate|complete|coverage)\b/iu,
  /\b(?:complete|true|actual|exhaustive)\s+runtime\s+behavio(?:u)?r\b/iu,
  /\bexhaustive\s+(?:blast\s+radius|impact(?:\s+analysis)?)\b/iu,
  /\bguarantee(?:d|s)?\s+(?:broker\s+)?delivery\b/iu,
  /\bguarantee(?:d|s)?\s+side\s+effects?\b/iu,
  /\b(?:finds?|identifies?|reports?|proves?)\s+dead\s+code\b/iu,
  /\bprevents?\s+architecture\s+degradation\s+forever\b/iu,
] as const;

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim();
}

function normalizeMarkdownProse(value: string): string {
  return normalizeWhitespace(value.replaceAll(/^>\s?/gmu, '').replaceAll('**', ''));
}

async function currentMarkdownFiles(
  directory: string,
  relativeSegments: readonly string[] = [],
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (relativeSegments.length === 0 && HISTORICAL_DOC_DIRECTORIES.has(entry.name)) {
          return [];
        }
        return currentMarkdownFiles(path, [...relativeSegments, entry.name]);
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) return [];
      if (HISTORICAL_DOC_FILES.has(entry.name) || entry.name === 'product-charter.md') return [];
      return [path];
    }),
  );
  return nested.flat().sort();
}

describe('Phase O0.1 product positioning and claims contract', () => {
  it('freezes the approved positioning, proof claim, users, workflow, and evidence boundary', async () => {
    const [charter, readme, index, plan] = await Promise.all([
      readFile(resolve('docs/product-charter.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
      readFile(
        resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
        'utf8',
      ),
    ]);

    const normalizedCharter = normalizeMarkdownProse(charter);
    expect(normalizedCharter).toContain(PRIMARY_POSITIONING);
    expect(normalizedCharter).toContain(PROOF_CLAIM);
    for (const heading of [
      '## User, problem, and primary job',
      '## Evidence model',
      '## Standard terminology',
      '## Claims ledger',
      '## Non-goals for the current product horizon',
      '## Proof-stop contract',
      '## Current claim-surface audit',
    ]) {
      expect(charter, `Product charter is missing ${heading}`).toContain(heading);
    }
    expect(charter).toContain(
      'scan -> inspect -> refactor -> diff -> impact -> check -> retain in CI',
    );
    expect(charter).toContain('Historical ADRs, benchmarks,');

    expect(normalizeMarkdownProse(readme)).toContain(PRIMARY_POSITIONING);
    expect(normalizeMarkdownProse(readme)).toContain(PROOF_CLAIM);
    expect(readme).toContain('schema-validated');
    expect(readme).not.toContain('runtime-validated');
    expect(index).toContain('[Product charter and claims ledger](product-charter.md)');
    expect(plan).toMatch(/### Phase O0\.1[\s\S]*?Status: complete/u);
  });

  it('defines every required proof term without changing canonical enum vocabulary', async () => {
    const charter = await readFile(resolve('docs/product-charter.md'), 'utf8');
    const normalizedCharter = normalizeWhitespace(charter);
    for (const term of [
      'proven',
      'potential',
      'conditional',
      'ambiguous',
      'unsupported',
      'missing',
      'out_of_repository',
    ]) {
      expect(normalizedCharter, `Product charter is missing the ${term} term`).toContain(
        `| \`${term}\` |`,
      );
    }
    for (const existingState of [
      'resolved',
      'distributed_conditional',
      'external_or_unobserved',
      'incompatible',
    ]) {
      expect(charter, `Product charter omits model mapping ${existingState}`).toContain(
        `\`${existingState}\``,
      );
    }
    expect(normalizedCharter).toContain(
      'Existing canonical enum names remain unchanged in Phase O0.1',
    );
  });

  it('gives every prohibited claim an approved replacement and audits public surfaces', async () => {
    const charter = await readFile(resolve('docs/product-charter.md'), 'utf8');
    const normalizedCharter = normalizeWhitespace(charter);
    for (const prohibited of [
      '“Complete,” “true,” or “actual runtime behavior.”',
      '“100% accurate,” “100% coverage,” or “finds every path.”',
      '“Exhaustive blast radius” or “complete impact.”',
      '“Guaranteed broker delivery,” “guaranteed handler execution,” or “guaranteed side effects.”',
      '“Dead code” from zero supported-root reach.',
      '“Prevents architecture degradation forever.”',
      'Broad backend, framework, ORM, security, compliance, or audit coverage.',
      '“Knip for backend architectures” as the formal category.',
    ]) {
      expect(normalizedCharter, `Claims ledger omits ${prohibited}`).toContain(`| ${prohibited} |`);
    }

    for (const auditedSurface of [
      '`README.md` opening',
      '`docs/README.md`',
      '`package.json` description',
      '`src/cli/index.ts` help header',
      '`action.yml` description',
      'OCI image description',
      'Living feature/reference docs',
      'Generated Markdown/HTML notices',
      'ADRs, benchmarks, spikes, validation records, and implementation plans',
    ]) {
      expect(charter, `Claim-surface audit omits ${auditedSurface}`).toContain(auditedSurface);
    }
  });

  it('rejects unqualified completeness and runtime-truth claims from current public surfaces', async () => {
    const surfacePaths = [
      resolve('README.md'),
      ...(await currentMarkdownFiles(resolve('docs'))),
      ...PUBLIC_NON_MARKDOWN_SURFACES.map((path) => resolve(path)),
    ];
    const violations: string[] = [];

    for (const path of surfacePaths) {
      const contents = await readFile(path, 'utf8');
      for (const pattern of PROHIBITED_ASSERTIVE_CLAIMS) {
        const match = pattern.exec(contents);
        if (match) {
          violations.push(
            `${relative(process.cwd(), path)} matched ${pattern.source}: ${JSON.stringify(match[0])}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
