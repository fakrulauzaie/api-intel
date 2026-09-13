import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { doctorCommand } from '../../../src/cli/commands/doctor.js';

describe('Phase O4.1 doctor documentation', () => {
  it('keeps the public synopsis and honesty boundary aligned with the command', async () => {
    const [guide, workflow, readme, index] = await Promise.all([
      readFile(resolve('docs/doctor.md'), 'utf8'),
      readFile(resolve('docs/cli-workflow.md'), 'utf8'),
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('docs/README.md'), 'utf8'),
    ]);
    expect(doctorCommand.usage).toContain('api-intel doctor [repository]');
    expect(workflow).toContain('The CLI has thirteen complete commands');
    expect(workflow).toContain(doctorCommand.usage.split(' [--config')[0]);
    expect(guide).toContain('does not install');
    expect(guide).toContain('execute target modules');
    expect(guide).toContain('A package name in `package.json`');
    expect(guide).toContain('`DOCTOR_OUTPUT_METADATA_ONLY`');
    expect(guide).toContain('`DOCTOR_OUTPUT_PROBE_CLEANUP_FAILED`');
    expect(readme).toContain('pnpm run cli -- doctor .');
    expect(index).toContain('[Doctor and capability preflight](doctor.md)');
  });
});
