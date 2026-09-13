import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const shaRangePattern = /^[0-9a-f]{7,64}\.\.[0-9a-f]{7,64}$/iu;
const trailerPattern = /^(Signed-off-by|Co-authored-by):\s*(.+?)\s*<([^<>\r\n]+)>\s*$/gimu;

function usage() {
  return 'Usage: node scripts/check-dco.mjs --range <base-commit>..<head-commit>';
}

function normalizeName(value) {
  return value.normalize('NFKC').trim().replaceAll(/\s+/gu, ' ');
}

function normalizeEmail(value) {
  return value.normalize('NFKC').trim().toLowerCase();
}

function identityKey(name, email) {
  return `${normalizeName(name)}\0${normalizeEmail(email)}`;
}

async function git(args, cwd = process.cwd()) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

function parseTrailers(message) {
  const signoffs = new Set();
  const coAuthors = new Map();
  for (const match of message.matchAll(trailerPattern)) {
    const [, kind, name, email] = match;
    if (kind === undefined || name === undefined || email === undefined) continue;
    const key = identityKey(name, email);
    if (kind.toLowerCase() === 'signed-off-by') signoffs.add(key);
    else coAuthors.set(key, { name: normalizeName(name), email: normalizeEmail(email) });
  }
  return { signoffs, coAuthors };
}

async function checkCommit(commit) {
  const details = await git(['show', '-s', '--format=%an%x00%ae%x00%B', commit]);
  const [authorName = '', authorEmail = '', ...messageParts] = details.split('\0');
  const message = messageParts.join('\0');
  const author = {
    name: normalizeName(authorName),
    email: normalizeEmail(authorEmail),
  };
  const { signoffs, coAuthors } = parseTrailers(message);
  const missing = [author, ...coAuthors.values()].filter(
    ({ name, email }) => !signoffs.has(identityKey(name, email)),
  );
  return missing;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

const rangeIndex = args.indexOf('--range');
const range = rangeIndex >= 0 ? args[rangeIndex + 1] : undefined;
if (args.length !== 2 || rangeIndex !== 0 || range === undefined || !shaRangePattern.test(range)) {
  process.stderr.write(`${usage()}\n`);
  process.exit(2);
}

const commits = (await git(['rev-list', '--reverse', range]))
  .split(/\r?\n/u)
  .filter((commit) => commit.length > 0);
if (commits.length === 0) {
  process.stderr.write(`No commits found in ${range}.\n`);
  process.exit(2);
}

const failures = [];
for (const commit of commits) {
  const missing = await checkCommit(commit);
  if (missing.length > 0) failures.push({ commit, missing });
}

if (failures.length > 0) {
  for (const { commit, missing } of failures) {
    const identities = missing.map(({ name, email }) => `${name} <${email}>`).join(', ');
    process.stderr.write(
      `${commit.slice(0, 12)}: missing matching DCO sign-off for ${identities}.\n`,
    );
  }
  process.stderr.write(
    'Amend your own commits with `git commit -s` and update the pull request.\n',
  );
  process.exit(1);
}

process.stdout.write(`DCO sign-off verified for ${commits.length} commit(s).\n`);
