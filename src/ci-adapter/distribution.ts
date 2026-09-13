import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { hashContent } from '../model/hashing.js';
import { canonicalStringify } from '../model/ordering.js';

export async function fingerprintCiDistribution(directory: string): Promise<string> {
  const root = resolve(directory);
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error('CI distribution must contain only regular files and directories.');
    }
  }
  files.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
  const records = await Promise.all(
    files.map(async (path) => ({
      path: relative(root, path).replaceAll('\\', '/'),
      contentHash: hashContent(await readFile(path)),
    })),
  );
  return hashContent(canonicalStringify(records));
}
