import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { apiIntelConfigurationJsonSchema } from '../dist/config/project-config-schema.js';

const destination = resolve('schemas/api-intel.config.schema.json');
const prettierConfig = (await resolveConfig(destination)) ?? {};
const expected = await format(JSON.stringify(apiIntelConfigurationJsonSchema()), {
  ...prettierConfig,
  parser: 'json',
});
const retained = await readFile(destination, 'utf8');

if (retained !== expected) {
  throw new Error(
    'Configuration schema is stale. Run `node scripts/generate-config-schema.mjs`, review the diff, and retry.',
  );
}

process.stdout.write('Configuration schema matches the runtime configuration contract.\n');
