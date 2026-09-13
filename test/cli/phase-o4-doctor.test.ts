import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index.js';
import { EXIT_CODE } from '../../src/cli/errors.js';
import type { DoctorDocument } from '../../src/doctor/index.js';
import type { CliIo } from '../../src/cli/types.js';
import { writeFakeNestCommon } from '../helpers/nest-project.js';
import { createTestTypeScriptProject, writeBasicTsconfig } from '../helpers/typescript-project.js';

function captureIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
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

describe('Phase O4.1 doctor preflight', () => {
  it('proves resolved framework declarations and keeps JSON safe for issue reports', async () => {
    const project = await prepareRepository();
    try {
      const captured = captureIo();
      const exitCode = await runCli(['doctor', project.path, '--format', 'json'], captured.io);
      expect(exitCode).toBe(EXIT_CODE.success);
      expect(captured.stderr).toEqual([]);
      expect(captured.stdout.join('\n')).not.toContain(project.path);
      const document = JSON.parse(captured.stdout[0]!) as DoctorDocument;
      expect(document).toMatchObject({
        schemaVersion: '1.0.0',
        repository: '<repository>',
        capabilities: {
          recognizedFrameworks: [
            {
              packageName: '@nestjs/common',
              version: '11.2.1',
              declarationResolution: 'typescript_resolved',
              compatibility: 'verified',
            },
          ],
        },
      });
      expect(document.checks.map(({ code }) => code)).toContain(
        'DOCTOR_NESTJS_DECLARATIONS_RESOLVED',
      );
      expect(document.checks.map(({ code }) => code)).toContain('DOCTOR_OUTPUT_METADATA_ONLY');
    } finally {
      await project.cleanup();
    }
  });

  it('does not infer framework recognition from an unreferenced package name', async () => {
    const project = await createTestTypeScriptProject();
    try {
      await writeFakeNestCommon(project, '11.2.1');
      await project.write('src/plain.ts', 'export const value = 1;\n');
      await writeBasicTsconfig(project);
      const captured = captureIo();
      expect(await runCli(['doctor', project.path, '--format', 'json'], captured.io)).toBe(
        EXIT_CODE.success,
      );
      const document = JSON.parse(captured.stdout[0]!) as DoctorDocument;
      expect(document.capabilities.recognizedFrameworks).toEqual([]);
      expect(document.checks.map(({ code }) => code)).toContain(
        'DOCTOR_NESTJS_DECLARATIONS_NOT_OBSERVED',
      );
    } finally {
      await project.cleanup();
    }
  });

  it('reports missing target declarations before scan and never evaluates target modules', async () => {
    const missing = await createTestTypeScriptProject();
    try {
      await missing.write(
        'src/not-executed.ts',
        [
          "import { Controller } from '@nestjs/common';",
          "throw new Error('TARGET_MODULE_EXECUTED');",
          '@Controller() export class MissingDependencyController {}',
        ].join('\n'),
      );
      await writeBasicTsconfig(missing);
      const captured = captureIo();
      expect(await runCli(['doctor', missing.path, '--format', 'json'], captured.io)).toBe(
        EXIT_CODE.analysisFailure,
      );
      expect(captured.stderr).toEqual([]);
      const document = JSON.parse(captured.stdout[0]!) as DoctorDocument;
      expect(document.checks.map(({ code }) => code)).toContain(
        'DOCTOR_TYPESCRIPT_IMPORTS_UNRESOLVED',
      );
      expect(captured.stdout.join('\n')).not.toContain('TARGET_MODULE_EXECUTED');
    } finally {
      await missing.cleanup();
    }
  });

  it('is byte-for-byte deterministic for unchanged filesystem and configuration state', async () => {
    const project = await prepareRepository('10.0.0');
    try {
      const first = captureIo();
      const second = captureIo();
      expect(await runCli(['doctor', project.path, '--format', 'json'], first.io)).toBe(
        EXIT_CODE.success,
      );
      expect(await runCli(['doctor', project.path, '--format', 'json'], second.io)).toBe(
        EXIT_CODE.success,
      );
      expect(second.stdout).toEqual(first.stdout);
      const document = JSON.parse(first.stdout[0]!) as DoctorDocument;
      expect(document.checks.map(({ code }) => code)).toContain(
        'DOCTOR_FRAMEWORK_VERSIONS_UNVERIFIED',
      );
    } finally {
      await project.cleanup();
    }
  });

  it('returns an actionable result for a wrong tsconfig without leaking its absolute path', async () => {
    const project = await prepareRepository();
    try {
      const captured = captureIo();
      const exitCode = await runCli(
        ['doctor', project.path, '--tsconfig', 'missing.json', '--format', 'json'],
        captured.io,
      );
      expect(exitCode).toBe(EXIT_CODE.analysisFailure);
      expect(captured.stderr).toEqual([]);
      expect(captured.stdout.join('\n')).not.toContain(project.path);
      const document = JSON.parse(captured.stdout[0]!) as DoctorDocument;
      expect(document.result).toBe('failure');
      expect(document.checks.map(({ code }) => code)).toContain('DOCTOR_TYPESCRIPT_PROGRAM_FAILED');
    } finally {
      await project.cleanup();
    }
  });

  it('reports invalid configuration as a stable failure while continuing safe checks', async () => {
    const project = await prepareRepository();
    try {
      await project.write('api-intel.config.json', '{ invalid json');
      const captured = captureIo();
      expect(await runCli(['doctor', project.path, '--format', 'json'], captured.io)).toBe(
        EXIT_CODE.analysisFailure,
      );
      const document = JSON.parse(captured.stdout[0]!) as DoctorDocument;
      expect(document.capabilities.configuration.source).toBe('invalid');
      expect(document.checks.map(({ code }) => code)).toContain('DOCTOR_CONFIGURATION_INVALID');
      expect(captured.stdout.join('\n')).not.toContain(project.path);
    } finally {
      await project.cleanup();
    }
  });

  it('performs and cleans up only the explicitly requested bounded output probe', async () => {
    const project = await prepareRepository();
    const output = join(project.path, 'nested', 'doctor-output');
    try {
      const captured = captureIo();
      expect(
        await runCli(
          ['doctor', project.path, '--output', output, '--probe-output', '--format', 'json'],
          captured.io,
        ),
      ).toBe(EXIT_CODE.success);
      const document = JSON.parse(captured.stdout[0]!) as DoctorDocument;
      expect(document.checks.map(({ code }) => code)).toContain('DOCTOR_OUTPUT_PROBE_PASSED');
      await expect(access(output)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(project.path, 'nested'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await project.cleanup();
    }
  });

  it('supports the optional current-directory argument and validates command options', async () => {
    const help = captureIo();
    expect(await runCli(['doctor', '--help'], help.io)).toBe(EXIT_CODE.success);
    expect(help.stdout.join('\n')).toContain('api-intel doctor [repository]');

    const invalid = captureIo();
    expect(await runCli(['doctor', '.', '--format', 'yaml'], invalid.io)).toBe(
      EXIT_CODE.usageError,
    );
    expect(invalid.stderr.join('\n')).toContain('--format must be text or json');
  });
});
