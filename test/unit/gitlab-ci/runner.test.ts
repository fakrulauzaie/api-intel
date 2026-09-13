import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GITLAB_CI_PROCESS_EXIT_CODES,
  runGitLabCi,
  writeGitLabFailureArtifacts,
} from '../../../src/gitlab-ci/index-library.js';

function bundledExit(environment: NodeJS.ProcessEnv): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve('gitlab-dist/index.js')], {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (value: Buffer) => stdout.push(value));
    child.stderr.on('data', (value: Buffer) => stderr.push(value));
    child.once('error', reject);
    child.once('exit', (code) => {
      resolvePromise({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function boundaryInput(overrides: Partial<Parameters<typeof runGitLabCi>[0]> = {}) {
  return {
    workspace: 'does-not-exist',
    pipelineSource: 'push',
    executionImage:
      'registry.example.com/api-intel@sha256:0000000000000000000000000000000000000000000000000000000000000000',
    projectDirectory: 'does-not-exist',
    publicationDirectory: '.api-intel-gitlab',
    baselineDirectory: 'baseline',
    baselineRevision: '0000000000000000000000000000000000000000',
    candidateDirectory: 'candidate',
    candidateRevision: '1111111111111111111111111111111111111111',
    configurationPath: 'baseline/api-intel.config.json',
    outputDirectory: 'results',
    baselinePackageManager: 'pnpm' as const,
    baselinePackageManagerVersion: '11.19.0',
    baselineLockfilePath: 'pnpm-lock.yaml',
    candidatePackageManager: 'pnpm' as const,
    candidatePackageManagerVersion: '11.19.0',
    candidateLockfilePath: 'pnpm-lock.yaml',
    maxFindings: 500,
    engineDistributionFingerprint:
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    processEnvironment: {},
    ...overrides,
  };
}

describe('Phase P3.2 GitLab CI runner boundary', () => {
  it('rejects non-merge-request pipelines before touching a checkout or project', async () => {
    await expect(runGitLabCi(boundaryInput())).rejects.toMatchObject({
      exitCode: GITLAB_CI_PROCESS_EXIT_CODES.invalid_input,
      message: expect.stringContaining('merge_request_event'),
    });
  });

  it('refuses a publication directory already supplied by candidate content', async () => {
    const project = await mkdtemp(join(tmpdir(), 'api-intel-p3-gitlab-project-'));
    await mkdir(join(project, '.api-intel-gitlab'));
    await expect(
      runGitLabCi(
        boundaryInput({
          pipelineSource: 'merge_request_event',
          projectDirectory: project,
        }),
      ),
    ).rejects.toMatchObject({
      exitCode: GITLAB_CI_PROCESS_EXIT_CODES.invalid_input,
      message: expect.stringContaining('must not already exist'),
    });
  });

  it('rejects a mutable execution image before inspecting the workspace', async () => {
    await expect(
      runGitLabCi(
        boundaryInput({
          pipelineSource: 'merge_request_event',
          executionImage: 'registry.example.com/api-intel:latest',
        }),
      ),
    ).rejects.toMatchObject({
      exitCode: GITLAB_CI_PROCESS_EXIT_CODES.invalid_input,
      message: expect.stringContaining('sha256 manifest digest'),
    });
  });

  it('publishes a valid empty Code Quality report for process failures', async () => {
    const project = await mkdtemp(join(tmpdir(), 'api-intel-p3-gitlab-failure-'));
    const root = await writeGitLabFailureArtifacts({
      projectDirectory: project,
      publicationDirectory: '.api-intel-gitlab',
      outcome: 'invalid_input',
      exitCode: 10,
      message: 'bad\ninput',
    });
    expect(await readFile(join(root, 'gl-code-quality-report.json'), 'utf8')).toBe('[]\n');
    expect(await readFile(join(root, 'gitlab-summary.md'), 'utf8')).toContain('bad input');
    expect(JSON.parse(await readFile(join(root, 'process-result.json'), 'utf8'))).toMatchObject({
      outcome: 'invalid_input',
      processExitCode: 10,
      evaluationId: null,
    });
  });

  it('ships and executes the complete checked-in code and WASM distribution', async () => {
    const project = await mkdtemp(join(tmpdir(), 'api-intel-p3-gitlab-bundle-'));
    const [
      component,
      bundlePackage,
      bundle,
      wasm,
      cytoscapeAsset,
      pinnedCytoscapeAsset,
      distributionEntries,
    ] = await Promise.all([
      readFile(resolve('templates/api-intel/template.yml'), 'utf8'),
      readFile(resolve('gitlab-dist/package.json'), 'utf8'),
      readFile(resolve('gitlab-dist/index.js'), 'utf8'),
      readFile(resolve('gitlab-dist/libpg-query.wasm')),
      readFile(resolve('gitlab-dist/cytoscape.min.js')),
      readFile(resolve('node_modules/cytoscape/dist/cytoscape.min.js')),
      readdir(resolve('gitlab-dist'), { recursive: true }),
    ]);
    expect(component).toContain('spec:\n  inputs:');
    expect(component).toContain('codequality: .api-intel-gitlab/gl-code-quality-report.json');
    expect(component).toContain('CI_MERGE_REQUEST_DIFF_BASE_SHA');
    expect(component).toContain("GIT_DEPTH: '0'");
    expect(component).not.toContain('CI_JOB_TOKEN');
    expect(component).not.toContain('CI_API_V4_URL');
    expect(component).not.toContain('curl ');
    expect(JSON.parse(bundlePackage)).toEqual({ type: 'module' });
    expect(bundle.length).toBeGreaterThan(1_000);
    expect(wasm.byteLength).toBeGreaterThan(1_000_000);
    expect(cytoscapeAsset.byteLength).toBeGreaterThan(100_000);
    expect(cytoscapeAsset.equals(pinnedCytoscapeAsset)).toBe(true);
    expect(distributionEntries.filter((path) => path.endsWith('cytoscape.min.js'))).toEqual([
      'cytoscape.min.js',
    ]);

    const result = await bundledExit({
      ...process.env,
      CI_PIPELINE_SOURCE: 'push',
      CI_PROJECT_DIR: project,
      CI_JOB_IMAGE:
        'registry.example.com/api-intel@sha256:0000000000000000000000000000000000000000000000000000000000000000',
      CI_COMMIT_SHA: '1111111111111111111111111111111111111111',
      CI_MERGE_REQUEST_DIFF_BASE_SHA: '0000000000000000000000000000000000000000',
      INPUT_WORKSPACE: project,
    });
    expect(result.code).toBe(10);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('runs only in a merge_request_event pipeline');
    expect(
      await readFile(join(project, '.api-intel-gitlab/gl-code-quality-report.json'), 'utf8'),
    ).toBe('[]\n');
  });
});
