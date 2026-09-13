import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { InitializationDocument } from '../../src/initialization.js';
import type { CliIo } from '../../src/cli/types.js';
import { writeFakeNestCommon } from '../helpers/nest-project.js';
import { createTestTypeScriptProject, writeBasicTsconfig } from '../helpers/typescript-project.js';

function captureIo(opened?: string[]): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      writeOut(message) {
        stdout.push(message);
      },
      writeError(message) {
        stderr.push(message);
      },
      ...(opened === undefined
        ? {}
        : {
            async openLocalArtifact(path: string) {
              opened.push(path);
            },
          }),
    },
  };
}

async function prepareRepository(version = '11.2.1') {
  const project = await createTestTypeScriptProject();
  await writeFakeNestCommon(project, version);
  await project.write(
    'src/status.controller.ts',
    [
      "import { Controller, Get } from '@nestjs/common';",
      "@Controller('status')",
      'export class StatusController {',
      "  @Get() check() { return 'ok'; }",
      '}',
    ].join('\n'),
  );
  await writeBasicTsconfig(project);
  return project;
}

describe('Phase O4.2 deterministic initialization', () => {
  it('previews a byte-stable minimal configuration without writing by default', async () => {
    const project = await prepareRepository();
    try {
      const first = captureIo();
      const second = captureIo();
      expect(await runCli(['init', project.path, '--format', 'json'], first.io)).toBe(
        EXIT_CODE.success,
      );
      expect(await runCli(['init', project.path, '--format', 'json'], second.io)).toBe(
        EXIT_CODE.success,
      );
      expect(second.stdout).toEqual(first.stdout);
      expect(first.stdout.join('\n')).not.toContain(project.path);
      const document = JSON.parse(first.stdout[0]!) as InitializationDocument;
      expect(document).toMatchObject({
        schemaVersion: '1.0.0',
        result: 'ready',
        repository: '<repository>',
        destination: 'api-intel.config.json',
        write: { requested: false, performed: false },
        configuration: { version: 4 },
        preflight: { nestjsDeclarationsProven: true },
      });
      expect(document.configurationText).toBe('{\n  "version": 4\n}\n');
      expect(document.preflight.warningCheckCodes).toContain('DOCTOR_OUTPUT_METADATA_ONLY');
      expect(document.notices.map(({ code }) => code)).not.toContain('INIT_PROOF_GAPS_PRESENT');
      await expect(access(join(project.path, 'api-intel.config.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await project.cleanup();
    }
  });

  it('separates analysis proof gaps from ordinary output metadata uncertainty', async () => {
    const project = await prepareRepository('10.0.0');
    try {
      const captured = captureIo();
      expect(await runCli(['init', project.path, '--format', 'json'], captured.io)).toBe(
        EXIT_CODE.success,
      );
      const document = JSON.parse(captured.stdout[0]!) as InitializationDocument;
      expect(document.preflight.warningCheckCodes).toContain(
        'DOCTOR_FRAMEWORK_VERSIONS_UNVERIFIED',
      );
      expect(document.notices.map(({ code }) => code)).toContain('INIT_PROOF_GAPS_PRESENT');
    } finally {
      await project.cleanup();
    }
  });

  it('requires --write, creates exclusively, and never replaces an existing file', async () => {
    const project = await prepareRepository();
    try {
      const write = captureIo();
      expect(await runCli(['init', project.path, '--write', '--format', 'json'], write.io)).toBe(
        EXIT_CODE.success,
      );
      const document = JSON.parse(write.stdout[0]!) as InitializationDocument;
      expect(document).toMatchObject({
        result: 'written',
        write: { requested: true, performed: true },
      });
      const configurationPath = join(project.path, 'api-intel.config.json');
      expect(await readFile(configurationPath, 'utf8')).toBe('{\n  "version": 4\n}\n');

      await project.write('api-intel.config.json', '{\n  "ownerValue": true\n}\n');
      const repeat = captureIo();
      expect(await runCli(['init', project.path, '--write', '--format', 'json'], repeat.io)).toBe(
        EXIT_CODE.invalidConfiguration,
      );
      expect(await readFile(configurationPath, 'utf8')).toBe('{\n  "ownerValue": true\n}\n');
      expect(JSON.parse(repeat.stdout[0]!)).toMatchObject({
        result: 'existing_configuration',
        write: { requested: true, performed: false },
      });
    } finally {
      await project.cleanup();
    }
  });

  it('refuses to write when NestJS declarations are not proven', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await project.write('src/plain.ts', 'export const value = 1;\n');
      await writeBasicTsconfig(project);
      const captured = captureIo();
      expect(await runCli(['init', project.path, '--write', '--format', 'json'], captured.io)).toBe(
        EXIT_CODE.analysisFailure,
      );
      const document = JSON.parse(captured.stdout[0]!) as InitializationDocument;
      expect(document).toMatchObject({
        result: 'blocked',
        write: { requested: true, performed: false },
        preflight: { nestjsDeclarationsProven: false },
      });
      expect(document.notices.map(({ code }) => code)).toContain('INIT_NESTJS_NOT_PROVEN');
      await expect(access(join(project.path, 'api-intel.config.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await project.cleanup();
    }
  });

  it('reaches endpoint evidence and the offline graph through the documented first-use path', async () => {
    const project = await prepareRepository();
    try {
      expect(await runCli(['init', project.path, '--write'], captureIo().io)).toBe(
        EXIT_CODE.success,
      );

      const opened: string[] = [];
      const scan = captureIo(opened);
      expect(await runCli(['scan', project.path, '--with-graph', '--open'], scan.io)).toBe(
        EXIT_CODE.success,
      );
      const analysis = join(project.path, '.api-intel', 'analysis.json');
      const graph = join(project.path, '.api-intel', 'api-intel-graph.html');
      expect(opened).toEqual([graph]);
      await expect(access(analysis)).resolves.toBeUndefined();
      await expect(access(graph)).resolves.toBeUndefined();

      const endpoints = captureIo();
      expect(await runCli(['endpoints', analysis], endpoints.io)).toBe(EXIT_CODE.success);
      expect(endpoints.stdout.join('\n')).toContain('| GET | `/status` | StatusController.check |');

      const trace = captureIo();
      expect(
        await runCli(['trace', analysis, '--method', 'GET', '--path', '/status'], trace.io),
      ).toBe(EXIT_CODE.success);
      expect(JSON.parse(trace.stdout[0]!)).toMatchObject({
        endpoint: { httpMethod: 'GET', path: '/status' },
        steps: [{ relation: 'ENDPOINT_IMPLEMENTED_BY', status: 'resolved' }],
      });
    } finally {
      await project.cleanup();
    }
  });

  it('supports the optional current-directory argument and rejects invalid formats', async () => {
    const help = captureIo();
    expect(await runCli(['init', '--help'], help.io)).toBe(EXIT_CODE.success);
    expect(help.stdout.join('\n')).toContain('api-intel init [repository]');

    const invalid = captureIo();
    expect(await runCli(['init', '.', '--format', 'yaml'], invalid.io)).toBe(EXIT_CODE.usageError);
    expect(invalid.stderr.join('\n')).toContain('--format must be text or json');
  });
});
