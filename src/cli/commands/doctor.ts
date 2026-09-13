import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { renderDoctorJson, renderDoctorText, runDoctor } from '../../doctor/index.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import type { CliCommand } from '../types.js';

export const doctorCommand: CliCommand = {
  name: 'doctor',
  summary: 'Preflight repository capabilities without executing target code.',
  usage:
    'api-intel doctor [repository] [--config <path> | --no-config] [--tsconfig <path>] [--output <directory>] [--format text|json] [--probe-output]',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          tsconfig: { type: 'string' },
          config: { type: 'string', short: 'c' },
          'no-config': { type: 'boolean' },
          output: { type: 'string', short: 'o' },
          format: { type: 'string' },
          'probe-output': { type: 'boolean' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid doctor options.');
      io.writeError(`Usage: ${doctorCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    if (parsed.positionals.length > 1) {
      io.writeError('The doctor command accepts at most one repository path.');
      io.writeError(`Usage: ${doctorCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    if (parsed.values.config !== undefined && parsed.values['no-config'] === true) {
      io.writeError('--config and --no-config cannot be used together.');
      io.writeError(`Usage: ${doctorCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    const format = parsed.values.format ?? 'text';
    if (format !== 'text' && format !== 'json') {
      io.writeError('--format must be text or json.');
      io.writeError(`Usage: ${doctorCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const document = await runDoctor({
        repositoryRoot: resolve(parsed.positionals[0] ?? '.'),
        ...(parsed.values.tsconfig === undefined ? {} : { tsconfigPath: parsed.values.tsconfig }),
        ...(parsed.values.config === undefined
          ? {}
          : { explicitConfigurationPath: parsed.values.config }),
        ...(parsed.values['no-config'] === undefined
          ? {}
          : { configurationDisabled: parsed.values['no-config'] }),
        ...(parsed.values.output === undefined
          ? {}
          : { outputDirectory: resolve(parsed.values.output) }),
        ...(parsed.values['probe-output'] === undefined
          ? {}
          : { probeOutput: parsed.values['probe-output'] }),
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      io.writeOut(format === 'json' ? renderDoctorJson(document) : renderDoctorText(document));
      return document.result === 'failure' ? EXIT_CODE.analysisFailure : EXIT_CODE.success;
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError('Doctor preflight failed unexpectedly without producing a result.');
      return EXIT_CODE.internalError;
    }
  },
};
