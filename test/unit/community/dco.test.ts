import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);

const gitIdentityEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'author@example.test',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'author@example.test',
};

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFile('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: gitIdentityEnvironment,
  });
  return stdout.trim();
}

describe('Phase O1.3 DCO checker', () => {
  it('accepts exact author/co-author sign-offs and rejects a missing co-author sign-off', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'api-intel-dco-'));
    const checker = resolve('scripts/check-dco.mjs');
    try {
      await git(repository, ['init']);
      await writeFile(join(repository, 'fixture.txt'), 'base\n', 'utf8');
      await git(repository, ['add', 'fixture.txt']);
      await git(repository, [
        'commit',
        '-m',
        'base',
        '-m',
        'Signed-off-by: Fixture Author <author@example.test>',
      ]);
      const base = await git(repository, ['rev-parse', 'HEAD']);

      await writeFile(join(repository, 'fixture.txt'), 'valid\n', 'utf8');
      await git(repository, ['add', 'fixture.txt']);
      await git(repository, [
        'commit',
        '-m',
        'valid contribution',
        '-m',
        'Co-authored-by: Fixture Coauthor <coauthor@example.test>\nSigned-off-by: Fixture Author <author@example.test>\nSigned-off-by: Fixture Coauthor <coauthor@example.test>',
      ]);
      const validHead = await git(repository, ['rev-parse', 'HEAD']);
      const valid = await execFile(
        process.execPath,
        [checker, '--range', `${base}..${validHead}`],
        { cwd: repository, encoding: 'utf8' },
      );
      expect(valid.stdout).toContain('DCO sign-off verified for 1 commit(s).');

      await writeFile(join(repository, 'fixture.txt'), 'invalid\n', 'utf8');
      await git(repository, ['add', 'fixture.txt']);
      await git(repository, [
        'commit',
        '-m',
        'missing co-author certification',
        '-m',
        'Co-authored-by: Missing Signoff <missing@example.test>\nSigned-off-by: Fixture Author <author@example.test>',
      ]);
      const invalidHead = await git(repository, ['rev-parse', 'HEAD']);

      await expect(
        execFile(process.execPath, [checker, '--range', `${validHead}..${invalidHead}`], {
          cwd: repository,
          encoding: 'utf8',
        }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          'missing matching DCO sign-off for Missing Signoff <missing@example.test>',
        ),
      });
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('rejects an unbounded or non-SHA revision argument', async () => {
    const checker = resolve('scripts/check-dco.mjs');
    await expect(
      execFile(process.execPath, [checker, '--range', 'main..feature'], {
        cwd: resolve('.'),
        encoding: 'utf8',
      }),
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('Usage:'),
    });
  });
});
