import { buildProviderDistribution } from './provider-distribution.mjs';

await buildProviderDistribution({
  arguments_: process.argv.slice(2),
  defaultName: 'action-dist',
  entrypoint: 'src/github-action/index.ts',
  label: 'GitHub Action',
});
