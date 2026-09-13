import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const npmCliPattern = /(?:^|[\\/])npm(?:-cli)?\.js$/iu;

export function resolveNpmCliPath() {
  const inherited = process.env.npm_execpath;
  const executableDirectory = dirname(process.execPath);
  const candidates = [
    inherited && npmCliPattern.test(inherited) ? inherited : null,
    resolve(executableDirectory, 'node_modules/npm/bin/npm-cli.js'),
    resolve(executableDirectory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error(
    'Cannot resolve the npm CLI from npm_execpath or the colocated Node.js installation.',
  );
}
