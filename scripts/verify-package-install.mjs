import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { resolveNpmCliPath } from './package-manager-cli.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(repositoryRoot, 'packaging/npm/fixtures/clean-room');
const contractPath = resolve(repositoryRoot, 'packaging/npm/clean-room-contract.json');
const privatePackageContentsPath = resolve(repositoryRoot, 'packaging/npm/package-contents.json');
const publicPackageContentsPath = resolve(
  repositoryRoot,
  'packaging/npm/public-package-contents.json',
);
const reportPath = resolve(repositoryRoot, 'packaging/npm/clean-room-install-report.json');
const npmCli = resolveNpmCliPath();
const maximumProcessOutputBytes = 4 * 1_024 * 1_024;
const processTimeoutMilliseconds = 5 * 60_000;

function normalizePath(path) {
  return path.replaceAll('\\', '/');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function parseArguments() {
  const arguments_ = process.argv.slice(2);
  const mode = arguments_.shift();
  if (!['--write', '--check', '--check-report', '--smoke'].includes(mode)) {
    throw new Error(
      'Usage: node scripts/verify-package-install.mjs --write|--check|--check-report|--smoke ' +
        '[--package-spec <exact-name-and-version> --expected-sha256 <digest> ' +
        '--result-file <repository-relative-path>]',
    );
  }
  const options = {
    mode,
    packageSpec: null,
    expectedSha256: null,
    resultFile: null,
  };
  while (arguments_.length > 0) {
    const name = arguments_.shift();
    const value = arguments_.shift();
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${name} requires a value.`);
    }
    if (name === '--package-spec') options.packageSpec = value;
    else if (name === '--expected-sha256') options.expectedSha256 = value.toLowerCase();
    else if (name === '--result-file') options.resultFile = resolve(repositoryRoot, value);
    else throw new Error(`Unknown clean-room verification option: ${name}.`);
  }
  const registryMode = options.packageSpec !== null || options.expectedSha256 !== null;
  if (registryMode && (options.packageSpec === null || options.expectedSha256 === null)) {
    throw new Error('--package-spec and --expected-sha256 must be provided together.');
  }
  if (options.expectedSha256 !== null && !/^[a-f0-9]{64}$/u.test(options.expectedSha256)) {
    throw new Error('--expected-sha256 must be a lowercase or uppercase SHA-256 digest.');
  }
  if (options.resultFile !== null) {
    if (mode !== '--smoke' || !registryMode) {
      throw new Error('--result-file is limited to registry-backed --smoke verification.');
    }
    const relativeResult = relative(repositoryRoot, options.resultFile);
    if (relativeResult === '' || relativeResult.startsWith('..') || isAbsolute(relativeResult)) {
      throw new Error('--result-file must remain beneath the repository root.');
    }
  }
  return options;
}

function cleanChildEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    'INIT_CWD',
    'NODE_PATH',
    'PNPM_SCRIPT_SRC_DIR',
    'npm_config_workspace',
    'npm_config_workspaces',
    'npm_lifecycle_event',
    'npm_package_json',
    'npm_package_name',
  ]) {
    delete environment[name];
  }
  environment.NO_COLOR = '1';
  return environment;
}

async function runProcess(executable, arguments_, options = {}) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(executable, arguments_, {
      cwd: options.cwd,
      env: cleanChildEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const collect = (destination, chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maximumProcessOutputBytes) {
        child.kill();
        finish(() => rejectProcess(new Error(`Process output exceeded the fixed byte limit.`)));
        return;
      }
      destination.push(chunk);
    };
    child.stdout.on('data', (chunk) => collect(stdout, chunk));
    child.stderr.on('data', (chunk) => collect(stderr, chunk));
    child.once('error', (error) => finish(() => rejectProcess(error)));
    child.once('close', (exitCode, signal) =>
      finish(() =>
        resolveProcess({
          exitCode: exitCode ?? 1,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        }),
      ),
    );
    const timer = setTimeout(() => {
      child.kill();
      finish(() => rejectProcess(new Error(`Process exceeded the five-minute timeout.`)));
    }, options.timeoutMilliseconds ?? processTimeoutMilliseconds);
  });
}

async function requireSuccess(executable, arguments_, options = {}) {
  const result = await runProcess(executable, arguments_, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed with exit ${result.exitCode}: ${basename(executable)} ${arguments_.join(' ')}\n` +
        `${result.stderr || result.stdout}`,
    );
  }
  return result;
}

async function resolvePnpmCommand() {
  const configured = process.env.API_INTEL_PNPM_EXECUTABLE;
  if (configured !== undefined) {
    if (!isAbsolute(configured)) {
      throw new Error('API_INTEL_PNPM_EXECUTABLE must be an absolute path.');
    }
    await access(configured);
    return { executable: await realpath(configured), prefixArguments: [] };
  }
  if (process.platform !== 'win32') return { executable: 'pnpm', prefixArguments: [] };

  const localApplicationData = process.env.LOCALAPPDATA;
  if (localApplicationData !== undefined) {
    const shim = resolve(localApplicationData, 'pnpm/bin/pnpm.ps1');
    try {
      const source = await readFile(shim, 'utf8');
      const match = source.match(/\$basedir\/([^"\r\n]*?pnpm\.exe)/u);
      if (match?.[1] !== undefined) {
        const candidate = resolve(dirname(shim), ...match[1].split('/'));
        await access(candidate);
        return { executable: await realpath(candidate), prefixArguments: [] };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const globalRoot = (
    await requireSuccess(process.execPath, [npmCli, 'root', '--global'], {
      cwd: repositoryRoot,
    })
  ).stdout.trim();
  for (const relativeCli of ['pnpm/bin/pnpm.cjs', 'pnpm/bin/pnpm.js']) {
    const candidate = resolve(globalRoot, ...relativeCli.split('/'));
    try {
      return {
        executable: process.execPath,
        prefixArguments: [await realpath(candidate)],
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(
    'Cannot resolve pnpm as a direct executable or an npm-global JavaScript CLI. ' +
      'Set API_INTEL_PNPM_EXECUTABLE to an absolute directly executable pnpm path.',
  );
}

function managerCommand(manager, arguments_) {
  return manager.name === 'npm'
    ? { executable: process.execPath, arguments: [npmCli, ...arguments_] }
    : {
        executable: manager.executable,
        arguments: [...manager.prefixArguments, ...arguments_],
      };
}

async function runManager(manager, arguments_, cwd) {
  const command = managerCommand(manager, arguments_);
  return runProcess(command.executable, command.arguments, { cwd });
}

async function requireManagerSuccess(manager, arguments_, cwd) {
  const command = managerCommand(manager, arguments_);
  return requireSuccess(command.executable, command.arguments, { cwd });
}

function binArguments(manager, bin, arguments_) {
  return manager.name === 'npm' ? ['exec', '--', bin, ...arguments_] : ['exec', bin, ...arguments_];
}

async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
      ({ name: left }, { name: right }) => left.localeCompare(right),
    )) {
      if (directory === root && entry.name === 'node_modules') continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(normalizePath(relative(root, path)));
    }
  }
  await visit(root);
  return files;
}

function contained(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function copyFixtureText(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function preparePositiveFixture(consumerRoot) {
  await mkdir(resolve(consumerRoot, 'src'), { recursive: true });
  await Promise.all([
    copyFixtureText(
      resolve(fixtureRoot, 'src/orders.ts.txt'),
      resolve(consumerRoot, 'src/orders.ts'),
    ),
    copyFixtureText(resolve(fixtureRoot, 'tsconfig.json'), resolve(consumerRoot, 'tsconfig.json')),
    copyFixtureText(
      resolve(fixtureRoot, 'declarations/@nestjs/common/package.json'),
      resolve(consumerRoot, 'node_modules/@nestjs/common/package.json'),
    ),
    copyFixtureText(
      resolve(fixtureRoot, 'declarations/@nestjs/common/index.d.ts.txt'),
      resolve(consumerRoot, 'node_modules/@nestjs/common/index.d.ts'),
    ),
    copyFixtureText(
      resolve(fixtureRoot, 'declarations/@nestjs/core/package.json'),
      resolve(consumerRoot, 'node_modules/@nestjs/core/package.json'),
    ),
    copyFixtureText(
      resolve(fixtureRoot, 'declarations/@nestjs/core/index.d.ts.txt'),
      resolve(consumerRoot, 'node_modules/@nestjs/core/index.d.ts'),
    ),
    copyFixtureText(
      resolve(fixtureRoot, 'declarations/typeorm/package.json'),
      resolve(consumerRoot, 'node_modules/typeorm/package.json'),
    ),
    copyFixtureText(
      resolve(fixtureRoot, 'declarations/typeorm/index.d.ts.txt'),
      resolve(consumerRoot, 'node_modules/typeorm/index.d.ts'),
    ),
  ]);
}

async function installPositiveConfiguration(consumerRoot) {
  await copyFixtureText(
    resolve(fixtureRoot, 'api-intel.config.json'),
    resolve(consumerRoot, 'api-intel.config.json'),
  );
}

async function prepareNegativeFixtures(consumerRoot) {
  const missingRoot = resolve(consumerRoot, 'missing-target');
  const invalidRoot = resolve(consumerRoot, 'invalid-tsconfig-target');
  await Promise.all([
    mkdir(resolve(missingRoot, 'src'), { recursive: true }),
    mkdir(resolve(invalidRoot, 'src'), { recursive: true }),
  ]);
  await Promise.all([
    copyFixtureText(
      resolve(fixtureRoot, 'missing-dependency.ts.txt'),
      resolve(missingRoot, 'src/missing.ts'),
    ),
    copyFixtureText(resolve(fixtureRoot, 'tsconfig.json'), resolve(missingRoot, 'tsconfig.json')),
    writeFile(resolve(invalidRoot, 'src/plain.ts'), 'export const value = 1;\n', 'utf8'),
    writeFile(resolve(invalidRoot, 'tsconfig.json'), '{ invalid json\n', 'utf8'),
  ]);
  return { missingRoot, invalidRoot };
}

async function verifyInstalledContents(packageRoot, packageContents, sourceRoot) {
  const installedFiles = await listFiles(packageRoot);
  const expectedFiles = packageContents.files.map(({ path }) => path);
  const expected = new Set(expectedFiles);
  const installed = new Set(installedFiles);
  const missing = expectedFiles.filter((path) => !installed.has(path));
  const unexpected = installedFiles.filter((path) => !expected.has(path));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Installed package files differ from the reviewed tarball inventory. ` +
        `Missing: ${missing.join(', ') || '<none>'}. ` +
        `Unexpected: ${unexpected.join(', ') || '<none>'}.`,
    );
  }
  const sourceMarkers = [sourceRoot, normalizePath(sourceRoot)];
  for (const expected of packageContents.files) {
    const bytes = await readFile(resolve(packageRoot, expected.path));
    if (bytes.byteLength !== expected.size || sha256(bytes) !== expected.sha256) {
      throw new Error(`Installed package bytes drifted for ${expected.path}.`);
    }
    const text = bytes.toString('utf8');
    if (sourceMarkers.some((marker) => text.includes(marker))) {
      throw new Error(`Installed package retains the source workspace path in ${expected.path}.`);
    }
  }
  return installedFiles.length;
}

function packageResolutionError(requireFromConsumer, specifier) {
  try {
    requireFromConsumer.resolve(specifier);
    return null;
  } catch (error) {
    return error?.code ?? 'UNKNOWN';
  }
}

async function verifySchemaExports(consumerRoot, packageRoot, contract) {
  const requireFromConsumer = createRequire(resolve(consumerRoot, 'consumer-probe.cjs'));
  const configurationSpecifier = `${contract.packageName}/schemas/api-intel.config.schema.json`;
  const supportSpecifier = `${contract.packageName}/schemas/support-diagnostic-manifest.schema.json`;
  const configurationPath = await realpath(requireFromConsumer.resolve(configurationSpecifier));
  const supportPath = await realpath(requireFromConsumer.resolve(supportSpecifier));
  if (!contained(packageRoot, configurationPath) || !contained(packageRoot, supportPath)) {
    throw new Error('A data export resolved outside the installed package.');
  }
  const configuration = requireFromConsumer(configurationSpecifier);
  const support = requireFromConsumer(supportSpecifier);
  if (configuration.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error('Installed configuration schema is not the reviewed draft-2020-12 document.');
  }
  if (support.title !== contract.expected.supportSchemaTitle) {
    throw new Error('Installed support schema title drifted.');
  }
  if (
    packageResolutionError(requireFromConsumer, contract.packageName) !==
    'ERR_PACKAGE_PATH_NOT_EXPORTED'
  ) {
    throw new Error('The package root unexpectedly became an import surface.');
  }
  if (
    packageResolutionError(requireFromConsumer, `${contract.packageName}/dist/model/index.js`) !==
    'ERR_PACKAGE_PATH_NOT_EXPORTED'
  ) {
    throw new Error('A private dist module unexpectedly became a deep-import surface.');
  }
  return {
    configuration: 'draft-2020-12',
    support: support.title,
    rootImport: 'blocked',
    deepImport: 'blocked',
  };
}

async function verifyRuntimeResolution(packageRoot, sourceRoot, temporaryRoot) {
  const requireFromPackage = createRequire(resolve(packageRoot, 'dist/cli/index.js'));
  const probes = {
    cytoscape: requireFromPackage.resolve('cytoscape/dist/cytoscape.min.js'),
    libpgQueryWasm: requireFromPackage.resolve('libpg-query/wasm/libpg-query.wasm'),
    mcpServer: requireFromPackage.resolve('@modelcontextprotocol/server'),
    typescript: requireFromPackage.resolve('typescript'),
    zod: requireFromPackage.resolve('zod'),
  };
  for (const [name, unresolved] of Object.entries(probes)) {
    const resolved = await realpath(unresolved);
    if (contained(sourceRoot, resolved) || !contained(temporaryRoot, resolved)) {
      throw new Error(`${name} resolved outside the isolated clean-room tree.`);
    }
  }
  return Object.keys(probes).sort();
}

async function verifyBins(manager, consumerRoot, contract) {
  const binDirectory = resolve(consumerRoot, 'node_modules/.bin');
  for (const name of ['api-intel', 'api-intel-mcp']) {
    await access(resolve(binDirectory, process.platform === 'win32' ? `${name}.cmd` : name));
  }
  const [cliVersion, cliHelp, mcpVersion, mcpHelp] = await Promise.all([
    requireManagerSuccess(manager, binArguments(manager, 'api-intel', ['--version']), consumerRoot),
    requireManagerSuccess(manager, binArguments(manager, 'api-intel', ['--help']), consumerRoot),
    requireManagerSuccess(
      manager,
      binArguments(manager, 'api-intel-mcp', ['--version']),
      consumerRoot,
    ),
    requireManagerSuccess(
      manager,
      binArguments(manager, 'api-intel-mcp', ['--help']),
      consumerRoot,
    ),
  ]);
  if (cliVersion.stdout.trim() !== contract.expected.cliVersion) {
    throw new Error(
      `${manager.name} api-intel version output drifted: ` +
        `stdout=${JSON.stringify(cliVersion.stdout)}, stderr=${JSON.stringify(cliVersion.stderr)}.`,
    );
  }
  if (!cliHelp.stdout.includes('api-intel <command> [options]')) {
    throw new Error(`${manager.name} api-intel help did not run from the installed bin.`);
  }
  if (mcpVersion.stdout.trim() !== contract.expected.mcpVersion) {
    throw new Error(
      `${manager.name} api-intel-mcp version output drifted: ` +
        `stdout=${JSON.stringify(mcpVersion.stdout)}, stderr=${JSON.stringify(mcpVersion.stderr)}.`,
    );
  }
  if (!mcpHelp.stdout.includes('api-intel-mcp --analysis')) {
    throw new Error(`${manager.name} api-intel-mcp help did not run from the installed bin.`);
  }
  return {
    apiIntel: contract.expected.cliVersion,
    apiIntelMcp: contract.expected.mcpVersion,
    shims: ['api-intel', 'api-intel-mcp'],
  };
}

async function verifyDoctor(manager, consumerRoot, contract) {
  const result = await requireManagerSuccess(
    manager,
    binArguments(manager, 'api-intel', ['doctor', '.', '--format', 'json']),
    consumerRoot,
  );
  const document = JSON.parse(result.stdout);
  const checkCodes = document.checks.map(({ code }) => code);
  if (
    document.schemaVersion !== contract.expected.doctorSchemaVersion ||
    document.result !== contract.expected.doctorResult ||
    document.repository !== '<repository>' ||
    !checkCodes.includes('DOCTOR_RUNTIME_ASSETS_READY') ||
    !checkCodes.includes('DOCTOR_NESTJS_DECLARATIONS_RESOLVED') ||
    result.stdout.includes(consumerRoot)
  ) {
    throw new Error('Installed doctor preflight did not satisfy the source-safe contract.');
  }
  return {
    schemaVersion: document.schemaVersion,
    result: document.result,
    repository: document.repository,
    runtimeAssetsReady: true,
    nestDeclarationsResolved: true,
    absoluteConsumerPathExposed: false,
  };
}

async function verifyInitialization(manager, consumerRoot, contract) {
  const configurationPath = resolve(consumerRoot, 'api-intel.config.json');
  const preview = await requireManagerSuccess(
    manager,
    binArguments(manager, 'api-intel', ['init', '.', '--format', 'json']),
    consumerRoot,
  );
  const previewDocument = JSON.parse(preview.stdout);
  try {
    await access(configurationPath);
    throw new Error('Installed init preview unexpectedly created a configuration file.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (
    previewDocument.schemaVersion !== contract.expected.initializationSchemaVersion ||
    previewDocument.result !== 'ready' ||
    previewDocument.repository !== '<repository>' ||
    previewDocument.write.requested !== false ||
    previewDocument.write.performed !== false ||
    JSON.stringify(previewDocument.configuration) !==
      JSON.stringify(contract.expected.initialConfiguration) ||
    preview.stdout.includes(consumerRoot)
  ) {
    throw new Error('Installed init preview did not satisfy the deterministic safe contract.');
  }

  const write = await requireManagerSuccess(
    manager,
    binArguments(manager, 'api-intel', ['init', '.', '--write', '--format', 'json']),
    consumerRoot,
  );
  const writeDocument = JSON.parse(write.stdout);
  const expectedText = `${JSON.stringify(contract.expected.initialConfiguration, null, 2)}\n`;
  if (
    writeDocument.result !== 'written' ||
    writeDocument.write.requested !== true ||
    writeDocument.write.performed !== true ||
    (await readFile(configurationPath, 'utf8')) !== expectedText
  ) {
    throw new Error('Installed init write did not create the exact reviewed configuration.');
  }

  const repeat = await runManager(
    manager,
    binArguments(manager, 'api-intel', ['init', '.', '--write', '--format', 'json']),
    consumerRoot,
  );
  if (
    repeat.exitCode !== contract.expected.existingConfigurationExitCode ||
    JSON.parse(repeat.stdout).result !== 'existing_configuration' ||
    (await readFile(configurationPath, 'utf8')) !== expectedText
  ) {
    throw new Error('Installed init did not preserve its no-overwrite boundary.');
  }

  const outputRoot = resolve(consumerRoot, '.api-intel-first-use');
  const scan = await requireManagerSuccess(
    manager,
    binArguments(manager, 'api-intel', ['scan', '.', '--with-graph', '--output', outputRoot]),
    consumerRoot,
  );
  const graphPath = resolve(outputRoot, contract.expected.graphFile);
  if (!scan.stdout.includes('Offline graph:') || scan.stdout.includes('Opened graph report')) {
    throw new Error('Installed first-use scan did not generate the graph headlessly.');
  }
  await access(graphPath);
  return {
    schemaVersion: previewDocument.schemaVersion,
    previewResult: previewDocument.result,
    writeResult: writeDocument.result,
    existingConfigurationExitCode: repeat.exitCode,
    configuration: previewDocument.configuration,
    absoluteConsumerPathExposed: false,
    headlessGraphGenerated: true,
  };
}

async function verifyPositiveScan(manager, consumerRoot, contract) {
  const result = await requireManagerSuccess(
    manager,
    binArguments(manager, 'api-intel', ['scan', '.']),
    consumerRoot,
  );
  if (!result.stdout.includes('Offline graph:') || result.stdout.includes('Opened graph report')) {
    throw new Error('Configured graph generation did not remain headless and successful.');
  }
  const outputRoot = resolve(consumerRoot, '.api-intel');
  const analysisPath = resolve(outputRoot, 'analysis.json');
  const graphPath = resolve(outputRoot, contract.expected.graphFile);
  const [analysis, graph] = await Promise.all([
    readJson(analysisPath),
    readFile(graphPath, 'utf8'),
  ]);
  if (
    analysis.schemaVersion !== contract.expected.analysisSchemaVersion ||
    analysis.resultState !== 'completed'
  ) {
    throw new Error(
      `Clean-room analysis returned schema ${String(analysis.schemaVersion)} and ` +
        `state ${String(analysis.resultState)}. Diagnostics: ` +
        `${analysis.diagnostics.map(({ code }) => code).join(', ') || '<none>'}.`,
    );
  }
  const endpoint = analysis.endpoints.find(
    (candidate) =>
      candidate.httpMethod === contract.expected.endpoint.httpMethod &&
      candidate.path === contract.expected.endpoint.routePath,
  );
  const implementation = analysis.assertions.find(
    (assertion) =>
      assertion.subjectId === endpoint?.id && assertion.predicate === 'ENDPOINT_IMPLEMENTED_BY',
  );
  const handler = analysis.methods.find((method) => method.id === implementation?.objectId);
  if (handler?.qualifiedName !== contract.expected.endpoint.handler) {
    throw new Error('Clean-room endpoint handler did not match the frozen fixture contract.');
  }
  const table = analysis.tables.find(
    (candidate) => candidate.name === contract.expected.rawSql.table,
  );
  const rawSqlAssertion = analysis.assertions.find(
    (assertion) =>
      assertion.ruleId === contract.expected.rawSql.ruleId && assertion.objectId === table?.id,
  );
  if (rawSqlAssertion?.predicate !== 'METHOD_READS_TABLE') {
    throw new Error('Clean-room raw-SQL/WASM probe did not prove the expected table read.');
  }
  if (analysis.analysisRun.configuration.rawSql?.dialect !== contract.expected.rawSql.dialect) {
    throw new Error('Clean-room project configuration did not select the raw-SQL dialect.');
  }
  if (
    !graph.includes('<meta name="api-intel-graph-schema"') ||
    !graph.includes('cytoscape') ||
    /<(?:script|link)\b[^>]+(?:src|href)=["']https?:/iu.test(graph)
  ) {
    throw new Error('Clean-room graph is not a self-contained offline HTML artifact.');
  }
  return {
    resultState: analysis.resultState,
    schemaVersion: analysis.schemaVersion,
    endpoints: analysis.endpoints.length,
    handler: handler.qualifiedName,
    rawSql: {
      dialect: analysis.analysisRun.configuration.rawSql.dialect,
      ruleId: rawSqlAssertion.ruleId,
      table: table.name,
      direction: 'READ',
    },
    graph: {
      file: contract.expected.graphFile,
      bytes: Buffer.byteLength(graph),
      externalScriptOrStylesheetReferences: 0,
      browserPreviewRequested: false,
    },
    analysisPath,
  };
}

async function mcpProtocolProbe(packageRoot, analysisPath, contract) {
  const mcpPath = resolve(packageRoot, 'dist/mcp/index.js');
  const child = spawn(process.execPath, [mcpPath, '--analysis', `clean-room=${analysisPath}`], {
    env: cleanChildEnvironment(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const pending = new Map();
  const protocolErrors = [];
  const stderr = [];
  let buffer = '';
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index).replace(/\r$/u, '');
      buffer = buffer.slice(index + 1);
      if (line === '') continue;
      try {
        const message = JSON.parse(line);
        const completion = pending.get(message.id);
        if (completion !== undefined) {
          pending.delete(message.id);
          if (message.error !== undefined) completion.reject(new Error(message.error.message));
          else completion.resolve(message.result);
        }
      } catch (error) {
        protocolErrors.push(error);
      }
    }
  });
  const request = (id, method, params) =>
    new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`MCP request ${method} timed out.`));
      }, 15_000);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolveRequest(value);
        },
        reject(error) {
          clearTimeout(timer);
          rejectRequest(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const notify = (method, params = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };

  try {
    const initialized = await request(1, 'initialize', {
      protocolVersion: contract.expected.mcpProtocolVersion,
      capabilities: {},
      clientInfo: { name: 'api-intel-clean-room', version: '1.0.0' },
    });
    notify('notifications/initialized');
    const listed = await request(2, 'tools/list', {});
    const tools = listed.tools.map(({ name }) => name).sort();
    if (
      initialized.protocolVersion !== contract.expected.mcpProtocolVersion ||
      JSON.stringify(tools) !== JSON.stringify(contract.expected.mcpTools)
    ) {
      throw new Error('Installed MCP server protocol surface drifted.');
    }
    if (protocolErrors.length > 0) throw protocolErrors[0];
    const startupError = Buffer.concat(stderr).toString('utf8');
    if (!startupError.includes('loaded 1 validated artifact(s); serving stdio.')) {
      throw new Error('Installed MCP server did not validate and serve the analysis artifact.');
    }
    return { protocolVersion: initialized.protocolVersion, tools };
  } finally {
    child.stdin.end();
    await new Promise((resolveExit) => {
      const timer = setTimeout(() => {
        child.kill();
        resolveExit();
      }, 5_000);
      child.once('close', () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
  }
}

function containsStackTrace(text) {
  return /\n\s+at\s+(?:async\s+)?(?:file:|[\w$.<>]+\s*\()/u.test(text);
}

async function verifyNegativeInputs(manager, consumerRoot, contract) {
  const { missingRoot, invalidRoot } = await prepareNegativeFixtures(consumerRoot);
  const missingOutput = resolve(missingRoot, '.api-intel');
  const missing = await runManager(
    manager,
    binArguments(manager, 'api-intel', [
      'scan',
      missingRoot,
      '--no-config',
      '--output',
      missingOutput,
    ]),
    consumerRoot,
  );
  if (missing.exitCode !== 0 || containsStackTrace(`${missing.stdout}\n${missing.stderr}`)) {
    throw new Error(
      'Missing-dependency scan did not return a bounded successful diagnostic result.',
    );
  }
  const missingAnalysis = await readJson(resolve(missingOutput, 'analysis.json'));
  if (
    missingAnalysis.resultState !== contract.expected.missingDependency.resultState ||
    !missingAnalysis.diagnostics.some(
      ({ code }) => code === contract.expected.missingDependency.diagnosticCode,
    )
  ) {
    throw new Error('Missing target dependency was not retained as an honest analysis gap.');
  }

  const invalid = await runManager(
    manager,
    binArguments(manager, 'api-intel', ['scan', invalidRoot, '--no-config']),
    consumerRoot,
  );
  if (
    invalid.exitCode !== contract.expected.invalidTsconfig.exitCode ||
    !invalid.stderr.includes(contract.expected.invalidTsconfig.message) ||
    containsStackTrace(`${invalid.stdout}\n${invalid.stderr}`)
  ) {
    throw new Error('Invalid tsconfig did not produce the bounded actionable CLI diagnostic.');
  }
  return {
    missingDependency: {
      exitCode: missing.exitCode,
      resultState: missingAnalysis.resultState,
      diagnosticCode: contract.expected.missingDependency.diagnosticCode,
      stackTrace: false,
    },
    invalidTsconfig: {
      exitCode: invalid.exitCode,
      messageCategory: 'TypeScript configuration could not be parsed',
      stackTrace: false,
    },
  };
}

async function installConsumer(manager, consumerRoot, archivePath, storeRoot) {
  await mkdir(consumerRoot, { recursive: true });
  await writeFile(
    resolve(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: `api-intel-${manager.name}-clean-room`,
        version: '1.0.0',
        private: true,
        type: 'module',
        packageManager: `${manager.name}@${manager.version}`,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  const installArguments =
    manager.name === 'npm'
      ? [
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--package-lock=false',
          '--cache',
          resolve(storeRoot, 'npm-cache'),
          archivePath,
        ]
      : [
          'add',
          '--ignore-scripts',
          '--save-exact',
          '--store-dir',
          resolve(storeRoot, 'pnpm-store'),
          archivePath,
        ];
  await requireManagerSuccess(manager, installArguments, consumerRoot);
}

async function verifyConsumer(input) {
  const consumerRoot = resolve(input.temporaryRoot, `${input.manager.name}-consumer`);
  await installConsumer(input.manager, consumerRoot, input.archivePath, input.temporaryRoot);
  const packageRoot = await realpath(resolve(consumerRoot, 'node_modules/@fakrulauzaie/api-intel'));
  const sourceRoot = await realpath(repositoryRoot);
  const resolvedConsumerRoot = await realpath(consumerRoot);
  if (
    contained(sourceRoot, resolvedConsumerRoot) ||
    contained(sourceRoot, packageRoot) ||
    !contained(input.temporaryRoot, packageRoot)
  ) {
    throw new Error(`${input.manager.name} consumer is not isolated from the source workspace.`);
  }
  const installedFiles = await verifyInstalledContents(
    packageRoot,
    input.packageContents,
    sourceRoot,
  );
  const runtimeDependencies = await verifyRuntimeResolution(
    packageRoot,
    sourceRoot,
    input.temporaryRoot,
  );
  const schemas = await verifySchemaExports(consumerRoot, packageRoot, input.contract);
  const bins = await verifyBins(input.manager, consumerRoot, input.contract);
  await preparePositiveFixture(consumerRoot);
  const initialization = await verifyInitialization(input.manager, consumerRoot, input.contract);
  const doctor = await verifyDoctor(input.manager, consumerRoot, input.contract);
  await installPositiveConfiguration(consumerRoot);
  const scan = await verifyPositiveScan(input.manager, consumerRoot, input.contract);
  const mcp = await mcpProtocolProbe(packageRoot, scan.analysisPath, input.contract);
  const negatives = await verifyNegativeInputs(input.manager, consumerRoot, input.contract);

  return {
    manager: input.manager.name,
    version: input.manager.version,
    installScriptsExecuted: false,
    consumerRootOutsideSourceWorkspace: true,
    runtimePathsOutsideSourceWorkspace: true,
    installedPackageFiles: installedFiles,
    runtimeDependencies,
    bins,
    initialization,
    doctor,
    schemas,
    scan: {
      resultState: scan.resultState,
      schemaVersion: scan.schemaVersion,
      endpoints: scan.endpoints,
      handler: scan.handler,
      rawSql: scan.rawSql,
      graph: scan.graph,
    },
    mcp,
    negatives,
  };
}

async function createArchive(temporaryRoot, packageContents, options) {
  const packageArguments = options.packageSpec === null ? [] : [options.packageSpec];
  const result = await requireSuccess(
    process.execPath,
    [
      npmCli,
      'pack',
      ...packageArguments,
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      temporaryRoot,
      '--cache',
      resolve(temporaryRoot, 'pack-cache'),
    ],
    { cwd: repositoryRoot },
  );
  const records = JSON.parse(result.stdout);
  if (!Array.isArray(records) || records.length !== 1) {
    throw new Error('npm pack did not return one clean-room archive.');
  }
  const record = records[0];
  for (const field of ['filename', 'entryCount', 'size', 'unpackedSize', 'shasum', 'integrity']) {
    const expectedField =
      field === 'entryCount'
        ? packageContents.archive.fileCount
        : field === 'size'
          ? packageContents.archive.packedBytes
          : field === 'unpackedSize'
            ? packageContents.archive.unpackedBytes
            : packageContents.archive[field];
    if (record[field] !== expectedField) {
      throw new Error(`Clean-room archive ${field} differs from the O2.2 reviewed package.`);
    }
  }
  const archivePath = resolve(temporaryRoot, record.filename);
  const archive = await readFile(archivePath);
  const archiveSha256 = sha256(archive);
  if (
    createHash('sha1').update(archive).digest('hex') !== record.shasum ||
    `sha512-${createHash('sha512').update(archive).digest('base64')}` !== record.integrity
  ) {
    throw new Error('Clean-room archive bytes do not match npm pack integrity metadata.');
  }
  if (options.expectedSha256 !== null && archiveSha256 !== options.expectedSha256) {
    throw new Error(
      `Registry archive SHA-256 drifted: expected ${options.expectedSha256}, received ${archiveSha256}.`,
    );
  }
  return { archivePath, record, sha256: archiveSha256 };
}

function assertReport(report, contract, packageContents) {
  if (
    report.schemaVersion !== '1.0.0' ||
    report.package.name !== contract.packageName ||
    report.package.version !== contract.packageVersion ||
    report.package.integrity !== packageContents.archive.integrity ||
    report.package.shasum !== packageContents.archive.shasum
  ) {
    throw new Error('Retained clean-room report does not match the package contracts.');
  }
  if (JSON.stringify(report.expected) !== JSON.stringify(contract.expected)) {
    throw new Error('Retained clean-room report expectation snapshot drifted.');
  }
  if (
    report.consumers.length !== contract.packageManagers.length ||
    !contract.packageManagers.every((name) =>
      report.consumers.some(
        (consumer) =>
          consumer.manager === name &&
          consumer.installedPackageFiles === packageContents.archive.fileCount &&
          consumer.installScriptsExecuted === false &&
          consumer.consumerRootOutsideSourceWorkspace === true &&
          consumer.runtimePathsOutsideSourceWorkspace === true &&
          consumer.initialization.schemaVersion === contract.expected.initializationSchemaVersion &&
          consumer.initialization.previewResult === 'ready' &&
          consumer.initialization.writeResult === 'written' &&
          consumer.initialization.existingConfigurationExitCode ===
            contract.expected.existingConfigurationExitCode &&
          JSON.stringify(consumer.initialization.configuration) ===
            JSON.stringify(contract.expected.initialConfiguration) &&
          consumer.initialization.absoluteConsumerPathExposed === false &&
          consumer.initialization.headlessGraphGenerated === true &&
          consumer.scan.resultState === 'completed' &&
          consumer.scan.rawSql.table === contract.expected.rawSql.table &&
          consumer.scan.graph.browserPreviewRequested === false &&
          consumer.mcp.tools.length === contract.expected.mcpTools.length &&
          consumer.negatives.missingDependency.stackTrace === false &&
          consumer.negatives.invalidTsconfig.stackTrace === false,
      ),
    )
  ) {
    throw new Error('Retained clean-room consumer evidence is incomplete.');
  }
  const serialized = JSON.stringify(report);
  if (
    /(?:[A-Za-z]:\\Users\\[^\\"\s]+|\/(?:Users|home)\/[^/"\s]+)/u.test(serialized) ||
    serialized.includes(repositoryRoot) ||
    serialized.includes(normalizePath(repositoryRoot))
  ) {
    throw new Error('Retained clean-room report contains a machine or source-workspace path.');
  }
}

async function buildReport(contract, packageContents, temporaryRoot, archive, options) {
  const pnpmCommand = await resolvePnpmCommand();
  const npmVersion = (
    await requireSuccess(process.execPath, [npmCli, '--version'], { cwd: temporaryRoot })
  ).stdout.trim();
  const pnpmVersion = (
    await requireSuccess(pnpmCommand.executable, [...pnpmCommand.prefixArguments, '--version'], {
      cwd: temporaryRoot,
    })
  ).stdout.trim();
  const managers = [
    { name: 'npm', executable: process.execPath, prefixArguments: [], version: npmVersion },
    { name: 'pnpm', ...pnpmCommand, version: pnpmVersion },
  ];
  const consumers = [];
  for (const manager of managers) {
    consumers.push(
      await verifyConsumer({
        manager,
        temporaryRoot,
        archivePath: archive.archivePath,
        contract,
        packageContents,
      }),
    );
  }
  const report = {
    schemaVersion: '1.0.0',
    generatedAt: '2026-09-12',
    package: {
      name: contract.packageName,
      version: contract.packageVersion,
      filename: archive.record.filename,
      fileCount: archive.record.entryCount,
      packedBytes: archive.record.size,
      unpackedBytes: archive.record.unpackedSize,
      shasum: archive.record.shasum,
      integrity: archive.record.integrity,
    },
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      npm: npmVersion,
      pnpm: pnpmVersion,
    },
    isolation: {
      consumerLocation: 'operating_system_temporary_directory',
      sourceWorkspaceNodeModulesUsed: false,
      targetApplicationExecuted: false,
      packageInstallScriptsExecuted: false,
    },
    expected: contract.expected,
    consumers,
  };
  if (options.packageSpec !== null) {
    report.package.sha256 = archive.sha256;
    report.source = {
      kind: 'npm_registry',
      packageSpec: options.packageSpec,
      registry: 'https://registry.npmjs.org/',
    };
  }
  return report;
}

async function serializeReport(report, destination = reportPath) {
  const prettierConfig = (await resolveConfig(destination)) ?? {};
  return format(JSON.stringify(report), { ...prettierConfig, filepath: destination });
}

async function main() {
  const options = parseArguments();
  const { mode } = options;
  const [contract, manifest] = await Promise.all([
    readJson(contractPath),
    readJson(resolve(repositoryRoot, 'package.json')),
  ]);
  const stagedPublic = !Object.hasOwn(manifest, 'private');
  const packageContentsPath =
    (stagedPublic || options.packageSpec !== null) && mode !== '--check-report'
      ? publicPackageContentsPath
      : privatePackageContentsPath;
  const packageContents = await readJson(packageContentsPath);
  if (
    options.packageSpec !== null &&
    options.packageSpec !== `${contract.packageName}@${contract.packageVersion}`
  ) {
    throw new Error(
      `Published-package verification requires exact spec ${contract.packageName}@${contract.packageVersion}.`,
    );
  }
  if (mode === '--check-report') {
    const report = await readJson(reportPath);
    assertReport(report, contract, packageContents);
    process.stdout.write(
      `Clean-room report verified: ${report.consumers.length} package managers, ` +
        `${report.package.fileCount} installed package files.\n`,
    );
    return;
  }

  const operatingSystemTemporaryRoot = await realpath(tmpdir());
  const temporaryRoot = await mkdtemp(join(operatingSystemTemporaryRoot, 'api-intel-o2-3-'));
  const temporaryRelative = relative(operatingSystemTemporaryRoot, temporaryRoot);
  if (
    temporaryRelative === '' ||
    temporaryRelative.startsWith('..') ||
    !basename(temporaryRoot).startsWith('api-intel-o2-3-')
  ) {
    throw new Error('Refusing to use an unverified clean-room temporary directory.');
  }
  try {
    const archive = await createArchive(temporaryRoot, packageContents, options);
    const report = await buildReport(contract, packageContents, temporaryRoot, archive, options);
    assertReport(report, contract, packageContents);
    const serialized = await serializeReport(report, options.resultFile ?? reportPath);
    if (options.resultFile !== null) {
      await mkdir(dirname(options.resultFile), { recursive: true });
      await writeFile(options.resultFile, serialized, 'utf8');
    }
    if (mode === '--write') {
      await writeFile(reportPath, serialized, 'utf8');
      process.stdout.write('Wrote packaging/npm/clean-room-install-report.json.\n');
    } else if (mode === '--check') {
      const retained = await readFile(reportPath, 'utf8');
      if (retained !== serialized) {
        throw new Error(
          'Clean-room install report is stale; run npm run pack:clean-room:write and review it.',
        );
      }
      process.stdout.write('Clean npm and pnpm package installation verified.\n');
    } else {
      process.stdout.write(
        `Clean npm and pnpm package smoke passed on ${report.environment.platform}/${report.environment.architecture} ` +
          `with Node ${report.environment.node}; retained evidence was not rewritten.\n`,
      );
    }
  } finally {
    const resolved = await realpath(temporaryRoot).catch(() => null);
    if (resolved !== null && contained(operatingSystemTemporaryRoot, resolved)) {
      await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

await main();
