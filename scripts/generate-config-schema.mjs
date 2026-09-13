import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { apiIntelConfigurationJsonSchema } from '../dist/config/project-config-schema.js';

const destination = resolve('schemas/api-intel.config.schema.json');
const prettierConfig = (await resolveConfig(destination)) ?? {};
const contents = await format(JSON.stringify(apiIntelConfigurationJsonSchema()), {
  ...prettierConfig,
  parser: 'json',
});
await writeFile(destination, contents);
process.stdout.write(`Wrote ${destination}\n`);
