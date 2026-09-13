#!/usr/bin/env node
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ncc bundles CommonJS dependencies such as TypeScript into this ESM entry. Supply
// their ordinary Node module-location globals before loading the bundled engine.
const bundleFilename = fileURLToPath(import.meta.url);
Object.assign(globalThis, {
  __filename: bundleFilename,
  __dirname: dirname(bundleFilename),
});
const { main } = await import('./main.js');
process.exitCode = await main();
