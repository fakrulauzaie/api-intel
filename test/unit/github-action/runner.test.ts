import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  GITHUB_ACTION_PROCESS_EXIT_CODES,
  fingerprintGitHubActionDistribution,
  main,
  runGitHubAction,
  targetProcessEnvironment,
} from '../../../src/github-action/index-library.js';

const execFileAsync = promisify(execFile);

describe('Phase P3.1 GitHub action runner boundary', () => {
  it('passes only a small non-secret environment allowlist to target package managers', () => {
    const projected = targetProcessEnvironment({
      PATH: '/tools',
      HOME: '/home/runner',
      CI: 'true',
      HTTP_PROXY: 'http://proxy.invalid',
      GITHUB_TOKEN: 'secret',
      ACTIONS_RUNTIME_TOKEN: 'runtime-secret',
      AWS_SECRET_ACCESS_KEY: 'cloud-secret',
      INPUT_CONFIGURATION: 'candidate-controlled',
    });
    expect(projected).toEqual({
      PATH: '/tools',
      HOME: '/home/runner',
      CI: 'true',
      HTTP_PROXY: 'http://proxy.invalid',
    });
  });

  it('rejects pull_request_target before touching a checkout or invoking a tool', async () => {
    await expect(
      runGitHubAction({
        workspace: 'does-not-exist',
        eventName: 'pull_request_target',
        baselineDirectory: 'baseline',
        baselineRevision: '0000000000000000000000000000000000000000',
        candidateDirectory: 'candidate',
        candidateRevision: '1111111111111111111111111111111111111111',
        configurationPath: 'baseline/api-intel.config.json',
        outputDirectory: 'output',
        baselinePackageManager: 'pnpm',
        baselinePackageManagerVersion: '11.19.0',
        baselineLockfilePath: 'pnpm-lock.yaml',
        candidatePackageManager: 'pnpm',
        candidatePackageManagerVersion: '11.19.0',
        candidateLockfilePath: 'pnpm-lock.yaml',
        maxAnnotations: 50,
        engineDistributionFingerprint:
          'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        processEnvironment: {},
      }),
    ).rejects.toMatchObject({
      exitCode: GITHUB_ACTION_PROCESS_EXIT_CODES.invalid_input,
    });
  });

  it('requires exact declared PR revisions before inspecting the workspace', async () => {
    await expect(
      runGitHubAction({
        workspace: 'does-not-exist',
        eventName: 'pull_request',
        baselineDirectory: 'baseline',
        baselineRevision: 'main',
        candidateDirectory: 'candidate',
        candidateRevision: '1111111111111111111111111111111111111111',
        configurationPath: 'baseline/api-intel.config.json',
        outputDirectory: 'output',
        baselinePackageManager: 'pnpm',
        baselinePackageManagerVersion: '11.19.0',
        baselineLockfilePath: 'pnpm-lock.yaml',
        candidatePackageManager: 'pnpm',
        candidatePackageManagerVersion: '11.19.0',
        candidateLockfilePath: 'pnpm-lock.yaml',
        maxAnnotations: 50,
        engineDistributionFingerprint:
          'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        processEnvironment: {},
      }),
    ).rejects.toMatchObject({
      exitCode: GITHUB_ACTION_PROCESS_EXIT_CODES.invalid_input,
      message: expect.stringContaining('Baseline revision'),
    });
  });

  it('records a stable process outcome so a later composite step can upload before failing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'api-intel-p3-main-'));
    const outputPath = join(directory, 'output.txt');
    const summaryPath = join(directory, 'summary.md');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await main({
      GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_WORKSPACE: directory,
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    });
    expect(await readFile(outputPath, 'utf8')).toContain('outcome=invalid_input');
    expect(await readFile(outputPath, 'utf8')).toContain('process-exit-code=10');
    expect(await readFile(summaryPath, 'utf8')).toContain('analysis action failed');
    expect(write).toHaveBeenCalledWith(expect.stringContaining('::error title='));
  });

  it('ships a generated ESM action bundle and provider metadata without provider API access', async () => {
    const [
      metadata,
      bundlePackage,
      bundle,
      wasm,
      cytoscapeAsset,
      pinnedCytoscapeAsset,
      distributionEntries,
      runner,
      firstFingerprint,
    ] = await Promise.all([
      readFile(resolve('action.yml'), 'utf8'),
      readFile(resolve('action-dist/package.json'), 'utf8'),
      readFile(resolve('action-dist/index.js'), 'utf8'),
      readFile(resolve('action-dist/libpg-query.wasm')),
      readFile(resolve('action-dist/cytoscape.min.js')),
      readFile(resolve('node_modules/cytoscape/dist/cytoscape.min.js')),
      readdir(resolve('action-dist'), { recursive: true }),
      readFile(resolve('src/github-action/runner.ts'), 'utf8'),
      fingerprintGitHubActionDistribution(resolve('action-dist')),
    ]);
    expect(metadata).toContain('using: composite');
    expect(metadata).toContain('node "$GITHUB_ACTION_PATH/action-dist/index.js"');
    expect(metadata).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    expect(JSON.parse(bundlePackage)).toEqual({ type: 'module' });
    expect(bundle.length).toBeGreaterThan(1_000);
    expect(wasm.byteLength).toBeGreaterThan(1_000_000);
    expect(cytoscapeAsset.byteLength).toBeGreaterThan(100_000);
    expect(cytoscapeAsset.equals(pinnedCytoscapeAsset)).toBe(true);
    expect(distributionEntries.filter((path) => path.endsWith('cytoscape.min.js'))).toEqual([
      'cytoscape.min.js',
    ]);
    expect(firstFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(await fingerprintGitHubActionDistribution(resolve('action-dist'))).toBe(
      firstFingerprint,
    );
    for (const source of [metadata, runner]) {
      expect(source).not.toContain('pull-requests: write');
      expect(source).not.toContain('GITHUB_TOKEN');
      expect(source).not.toContain('octokit');
      expect(source).not.toContain('github.rest');
    }
  });

  it('executes the complete checked-in code and WASM distribution', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'api-intel-p3-bundle-'));
    const outputPath = join(directory, 'output.txt');
    const summaryPath = join(directory, 'summary.md');
    const result = await execFileAsync(process.execPath, [resolve('action-dist/index.js')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_WORKSPACE: process.cwd(),
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        INPUT_BASELINE_REVISION: '0000000000000000000000000000000000000000',
        INPUT_CANDIDATE_REVISION: '1111111111111111111111111111111111111111',
      },
      windowsHide: true,
    });
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('::error title=API Intelligence action failed::');
    expect(await readFile(outputPath, 'utf8')).toContain('outcome=invalid_input');
    expect(await readFile(summaryPath, 'utf8')).toContain('runs only for the pull_request event');
  });
});
