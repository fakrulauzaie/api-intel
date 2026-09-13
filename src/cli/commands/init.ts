import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  initializeProject,
  renderInitializationJson,
  renderInitializationText,
} from '../../initialization.js';
import { isCancellation, reportCancellation } from '../cancellation.js';
import { EXIT_CODE } from '../errors.js';
import type { CliCommand } from '../types.js';

export const initCommand: CliCommand = {
  name: 'init',
  summary: 'Preview or create a minimal, strict project configuration.',
  usage: 'api-intel init [repository] [--tsconfig <path>] [--write] [--format text|json]',
  async execute(args, io) {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...args],
        allowPositionals: true,
        strict: true,
        options: {
          tsconfig: { type: 'string' },
          write: { type: 'boolean' },
          format: { type: 'string' },
        },
      });
    } catch (error) {
      io.writeError(error instanceof Error ? error.message : 'Invalid init options.');
      io.writeError(`Usage: ${initCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    if (parsed.positionals.length > 1) {
      io.writeError('The init command accepts at most one repository path.');
      io.writeError(`Usage: ${initCommand.usage}`);
      return EXIT_CODE.usageError;
    }
    const format = parsed.values.format ?? 'text';
    if (format !== 'text' && format !== 'json') {
      io.writeError('--format must be text or json.');
      io.writeError(`Usage: ${initCommand.usage}`);
      return EXIT_CODE.usageError;
    }

    try {
      const document = await initializeProject({
        repositoryRoot: resolve(parsed.positionals[0] ?? '.'),
        ...(parsed.values.tsconfig === undefined ? {} : { tsconfigPath: parsed.values.tsconfig }),
        ...(parsed.values.write === undefined ? {} : { write: parsed.values.write }),
        ...(io.signal === undefined ? {} : { signal: io.signal }),
      });
      io.writeOut(
        format === 'json' ? renderInitializationJson(document) : renderInitializationText(document),
      );
      switch (document.result) {
        case 'ready':
        case 'written':
          return EXIT_CODE.success;
        case 'blocked':
          return EXIT_CODE.analysisFailure;
        case 'existing_configuration':
          return EXIT_CODE.invalidConfiguration;
      }
    } catch (error) {
      if (isCancellation(error, io.signal)) return reportCancellation(io);
      io.writeError('Initialization failed unexpectedly without changing project configuration.');
      return EXIT_CODE.internalError;
    }
  },
};
