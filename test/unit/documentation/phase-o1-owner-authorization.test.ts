import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Phase O1 owner publication authorization', () => {
  it('records a scoped owner attestation without clearing external material or mutations', async () => {
    const [authorization, readme, index, redistribution, fixtures, strategy, plan] =
      await Promise.all([
        readFile(resolve('docs/legal/ownership-and-publication-authorization.md'), 'utf8'),
        readFile(resolve('README.md'), 'utf8'),
        readFile(resolve('docs/README.md'), 'utf8'),
        readFile(resolve('docs/legal/redistribution-audit.md'), 'utf8'),
        readFile(resolve('docs/legal/fixture-provenance.md'), 'utf8'),
        readFile(resolve('docs/public-repository-strategy.md'), 'utf8'),
        readFile(
          resolve('backend_api_intelligence_open_source_productization_implementation_plan.md'),
          'utf8',
        ),
      ]);

    expect(authorization).toContain('Status: owner attestation recorded');
    expect(authorization).toContain('authorized for public release under Apache License 2.0');
    expect(authorization).toContain(
      'testing permission does **not** grant redistribution permission',
    );
    expect(authorization).toMatch(/Unknown provenance is a\s+blocking state/u);
    expect(authorization).toContain('does not itself authorize an external mutation');
    expect(readme).toContain(
      '[owner attestation](docs/legal/ownership-and-publication-authorization.md)',
    );
    expect(index).toContain(
      '[Ownership and publication authorization](legal/ownership-and-publication-authorization.md)',
    );
    expect(redistribution).toContain('project-owner authorization recorded');
    expect(fixtures).toContain('development testing only');
    expect(strategy).toContain('organization-derived material');
    expect(plan).toContain('Owner authorization note (2026-09-10)');
    expect(plan).toContain('project-owner/IP authorization is');
  });
});
