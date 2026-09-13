import { runGitHubAction } from '../dist/github-action/index-library.js';
import { hashContent } from '../dist/model/hashing.js';

async function testLocalAction() {
  console.log('--- Test 1: Testing pull_request_target Rejection ---');
  try {
    await runGitHubAction({
      workspace: process.cwd(),
      eventName: 'pull_request_target', // Unsafe trigger
      baselineDirectory: 'baseline',
      baselineRevision: '0000000000000000000000000000000000000000',
      candidateDirectory: 'candidate',
      candidateRevision: '1111111111111111111111111111111111111111',
      configurationPath: 'baseline/api-intel.config.json',
      outputDirectory: '.api-intel-ci-results',
      baselinePackageManager: 'pnpm',
      baselinePackageManagerVersion: '11.19.0',
      baselineLockfilePath: 'pnpm-lock.yaml',
      candidatePackageManager: 'pnpm',
      candidatePackageManagerVersion: '11.19.0',
      candidateLockfilePath: 'pnpm-lock.yaml',
      maxAnnotations: 50,
      engineDistributionFingerprint: hashContent('test-distribution'),
      processEnvironment: {},
    });
    console.error('FAILED: Unsafe event was not rejected!');
  } catch (error) {
    console.log(`✔ SUCCESS: Rejected with exit code ${error.exitCode} (${error.message})`);
  }
}

testLocalAction().catch(console.error);
