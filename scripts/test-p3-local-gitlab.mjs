import { runGitLabCi } from '../dist/gitlab-ci/index-library.js';
import { hashContent } from '../dist/model/hashing.js';

async function testLocalGitLab() {
  console.log('--- Test 1: Testing non-merge-request pipeline Rejection ---');
  try {
    await runGitLabCi({
      workspace: process.cwd(),
      pipelineSource: 'push', // Unsafe trigger for GitLab MR adapter
      executionImage:
        'ghcr.io/fakrulauzaie/api-intel@sha256:bb9a0a56abb61f2da8f14780e7640b1f819e4c7d59648bc5d83df87c7ade6b8b',
      projectDirectory: process.cwd(),
      publicationDirectory: '.api-intel-gitlab',
      baselineDirectory: 'baseline',
      baselineRevision: '0000000000000000000000000000000000000000',
      candidateDirectory: 'candidate',
      candidateRevision: '1111111111111111111111111111111111111111',
      configurationPath: 'baseline/api-intel.config.json',
      outputDirectory: 'results',
      baselinePackageManager: 'pnpm',
      baselinePackageManagerVersion: '11.19.0',
      baselineLockfilePath: 'pnpm-lock.yaml',
      candidatePackageManager: 'pnpm',
      candidatePackageManagerVersion: '11.19.0',
      candidateLockfilePath: 'pnpm-lock.yaml',
      maxFindings: 500,
      engineDistributionFingerprint: hashContent('test-distribution'),
      processEnvironment: {},
    });
    console.error('FAILED: Unsafe event was not rejected!');
  } catch (error) {
    console.log(`✔ SUCCESS: Rejected with exit code ${error.exitCode} (${error.message})`);
  }
}

testLocalGitLab().catch(console.error);
