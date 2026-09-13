import { buildProviderDistribution } from './provider-distribution.mjs';

await buildProviderDistribution({
  arguments_: process.argv.slice(2),
  defaultName: 'gitlab-dist',
  entrypoint: 'src/gitlab-ci/index.ts',
  label: 'GitLab CI',
});
