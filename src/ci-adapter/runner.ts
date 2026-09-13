import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { scanRepository } from '../analysis/scan-repository.js';
import { rawSqlConfigurationFromOption } from '../cli/options.js';
import {
  createCiDependencyInstallPlan,
  createCiScanRecipe,
  evaluateCiArtifacts,
  renderCiEvaluationMarkdown,
  serializeCiEvaluationDocument,
  serializeCiScanRecipeManifest,
  verifyCiScanRecipe,
  CI_PROCESS_EXIT_CODES,
  type CiEvaluationDocument,
  type CiPackageManager,
  type CiProcessOutcome,
  type CiScanRecipeManifest,
} from '../ci-evaluation/index.js';
import { compareAnalysisDocuments } from '../comparison/compare.js';
import { serializeDiffDocument } from '../comparison/ordering.js';
import { loadProjectConfigurationForScan } from '../config/project-config.js';
import { buildGraphReportDocument } from '../graph-report/project.js';
import { analyzePotentialImpact } from '../impact/analyze.js';
import { serializeImpactDocument } from '../impact/ordering.js';
import { hashContent } from '../model/hashing.js';
import { prepareOfflineGraphReportArtifact } from '../output/graph-report-artifact.js';
import { evaluatePolicies } from '../policy/evaluate.js';
import { POLICY_CONFIGURATION_VERSION } from '../policy/model.js';
import { serializePolicyResults } from '../policy/ordering.js';

export const CI_ADAPTER_MAX_INPUT_BYTES = 64 * 1024 * 1024;

export class CiRepositoryEvaluationRunError extends Error {
  readonly outcome: CiProcessOutcome;
  readonly exitCode: number;

  constructor(outcome: CiProcessOutcome, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CiRepositoryEvaluationRunError';
    this.outcome = outcome;
    this.exitCode = CI_PROCESS_EXIT_CODES[outcome];
  }
}

export interface CiRepositoryEvaluationRunInput {
  readonly workspace: string;
  readonly baselineDirectory: string;
  readonly baselineRevision: string;
  readonly candidateDirectory: string;
  readonly candidateRevision: string;
  readonly configurationPath: string;
  readonly outputDirectory: string;
  readonly baselinePackageManager: CiPackageManager;
  readonly baselinePackageManagerVersion: string;
  readonly baselineLockfilePath: string;
  readonly candidatePackageManager: CiPackageManager;
  readonly candidatePackageManagerVersion: string;
  readonly candidateLockfilePath: string;
  readonly engineDistributionFingerprint: string;
  readonly processEnvironment: NodeJS.ProcessEnv;
}

export interface CiPreparedArtifact {
  readonly path: string;
  readonly contents: string;
}

export interface CiRepositoryEvaluationRunResult {
  readonly evaluation: CiEvaluationDocument;
  readonly recipe: CiScanRecipeManifest;
  readonly artifactPath: string;
  readonly files: readonly CiPreparedArtifact[];
}

const TARGET_ENVIRONMENT_KEYS = new Set([
  'APPDATA',
  'CI',
  'COMSPEC',
  'HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LOCALAPPDATA',
  'NODE_EXTRA_CA_CERTS',
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'PNPM_HOME',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
]);

export function targetProcessEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => value !== undefined && TARGET_ENVIRONMENT_KEYS.has(key.toUpperCase()),
    ),
  );
}

export function isCiPathWithin(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`));
}

async function canonicalInputPath(root: string, value: string, label: string): Promise<string> {
  const candidate = await realpath(resolve(root, value));
  if (!isCiPathWithin(root, candidate)) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      `${label} must remain inside the isolated CI workspace.`,
    );
  }
  return candidate;
}

export async function canonicalCiOutputPath(root: string, value: string): Promise<string> {
  const lexicalPath = resolve(root, value);
  if (!isCiPathWithin(root, lexicalPath)) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      'Output directory must remain inside the isolated CI workspace.',
    );
  }
  let existingAncestor = lexicalPath;
  for (;;) {
    try {
      await stat(existingAncestor);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) throw new Error('No existing output ancestor was found.');
      existingAncestor = parent;
    }
  }
  const canonicalAncestor = await realpath(existingAncestor);
  if (!isCiPathWithin(root, canonicalAncestor)) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      'Output directory must not traverse a symbolic link outside the isolated CI workspace.',
    );
  }
  return resolve(canonicalAncestor, relative(existingAncestor, lexicalPath));
}

async function boundedTextFile(path: string, label: string): Promise<string> {
  const contents = await readFile(path);
  if (contents.byteLength > CI_ADAPTER_MAX_INPUT_BYTES) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      `${label} exceeds the ${CI_ADAPTER_MAX_INPUT_BYTES}-byte input limit.`,
    );
  }
  return contents.toString('utf8');
}

function commandOutput(
  executable: CiPackageManager,
  arguments_: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...arguments_], {
      cwd,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    child.stdout.on('data', (value: Buffer) => {
      if (outputBytes >= 8_192) return;
      output.push(value);
      outputBytes += value.byteLength;
    });
    child.stderr.on('data', (value: Buffer) => {
      if (errorBytes >= 8_192) return;
      errors.push(value);
      errorBytes += value.byteLength;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolvePromise(Buffer.concat(output).toString('utf8').trim());
      reject(
        new Error(
          `${executable} ${arguments_[0] ?? ''} failed (${signal ?? code ?? 'unknown'}): ${Buffer.concat(errors).toString('utf8').trim()}`,
        ),
      );
    });
  });
}

function runInstall(
  plan: ReturnType<typeof createCiDependencyInstallPlan>,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(plan.command.executable, [...plan.command.arguments], {
      cwd,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolvePromise();
      reject(
        new Error(
          `${plan.command.executable} dependency installation failed (${signal ?? code ?? 'unknown'}).`,
        ),
      );
    });
  });
}

export function portableCiPath(parent: string, child: string): string {
  return relative(parent, child).split(sep).join('/');
}

export function ciArtifactRecord(path: string, contents: string) {
  return {
    path,
    bytes: Buffer.byteLength(contents),
    contentHash: hashContent(contents),
  };
}

function exactRevision(value: string, label: string): string {
  const revision = value.toLowerCase();
  if (!/^[a-f0-9]{40,64}$/u.test(revision)) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      `${label} revision must be an exact 40-64 character hexadecimal object ID.`,
    );
  }
  return revision;
}

export async function runCiRepositoryEvaluation(
  input: CiRepositoryEvaluationRunInput,
): Promise<CiRepositoryEvaluationRunResult> {
  const baselineRevision = exactRevision(input.baselineRevision, 'Baseline');
  const candidateRevision = exactRevision(input.candidateRevision, 'Candidate');
  const workspace = await realpath(input.workspace);
  const baselineDirectory = await canonicalInputPath(
    workspace,
    input.baselineDirectory,
    'Baseline directory',
  );
  const candidateDirectory = await canonicalInputPath(
    workspace,
    input.candidateDirectory,
    'Candidate directory',
  );
  if (baselineDirectory === candidateDirectory) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      'Baseline and candidate directories must be isolated.',
    );
  }
  const configurationPath = await canonicalInputPath(
    workspace,
    input.configurationPath,
    'Configuration path',
  );
  if (!isCiPathWithin(baselineDirectory, configurationPath)) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      'The trusted project configuration must come from the baseline checkout.',
    );
  }
  const baselineLockfilePath = await canonicalInputPath(
    workspace,
    join(baselineDirectory, input.baselineLockfilePath),
    'Baseline lockfile',
  );
  const candidateLockfilePath = await canonicalInputPath(
    workspace,
    join(candidateDirectory, input.candidateLockfilePath),
    'Candidate lockfile',
  );
  if (!isCiPathWithin(baselineDirectory, baselineLockfilePath)) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      'Baseline lockfile must remain inside the baseline checkout.',
    );
  }
  if (!isCiPathWithin(candidateDirectory, candidateLockfilePath)) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      'Candidate lockfile must remain inside the candidate checkout.',
    );
  }

  const outputRoot = await canonicalCiOutputPath(workspace, input.outputDirectory);
  const environment = targetProcessEnvironment(input.processEnvironment);
  const [baselineVersion, candidateVersion] = await Promise.all([
    commandOutput(input.baselinePackageManager, ['--version'], baselineDirectory, environment),
    commandOutput(input.candidatePackageManager, ['--version'], candidateDirectory, environment),
  ]);
  if (baselineVersion !== input.baselinePackageManagerVersion) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      `Baseline package manager version is ${baselineVersion}; expected ${input.baselinePackageManagerVersion}.`,
    );
  }
  if (candidateVersion !== input.candidatePackageManagerVersion) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      `Candidate package manager version is ${candidateVersion}; expected ${input.candidatePackageManagerVersion}.`,
    );
  }

  const [baselineLockfile, candidateLockfile, configurationContents] = await Promise.all([
    boundedTextFile(baselineLockfilePath, 'Baseline lockfile'),
    boundedTextFile(candidateLockfilePath, 'Candidate lockfile'),
    boundedTextFile(configurationPath, 'Project configuration'),
  ]);
  const baselineDependencies = createCiDependencyInstallPlan({
    packageManager: input.baselinePackageManager,
    packageManagerVersion: input.baselinePackageManagerVersion,
    lockfilePath: portableCiPath(baselineDirectory, baselineLockfilePath),
    lockfileFingerprint: hashContent(baselineLockfile),
  });
  const candidateDependencies = createCiDependencyInstallPlan({
    packageManager: input.candidatePackageManager,
    packageManagerVersion: input.candidatePackageManagerVersion,
    lockfilePath: portableCiPath(candidateDirectory, candidateLockfilePath),
    lockfileFingerprint: hashContent(candidateLockfile),
  });

  try {
    await runInstall(baselineDependencies, baselineDirectory, environment);
    await runInstall(candidateDependencies, candidateDirectory, environment);
  } catch (error) {
    throw new CiRepositoryEvaluationRunError(
      'analysis_failure',
      'Immutable dependency preparation failed with lifecycle scripts disabled.',
      { cause: error },
    );
  }

  const projectConfiguration = await loadProjectConfigurationForScan({
    repositoryRoot: baselineDirectory,
    explicitPath: configurationPath,
  });
  if (projectConfiguration === undefined) {
    throw new CiRepositoryEvaluationRunError(
      'invalid_input',
      'The trusted project configuration is required.',
    );
  }
  const rawSql = rawSqlConfigurationFromOption(projectConfiguration.analysis.rawSqlDialect);
  const analysisConfiguration = {
    ...(projectConfiguration.analysis.maxCallDepth === undefined
      ? {}
      : { maxCallDepth: projectConfiguration.analysis.maxCallDepth }),
    ...(rawSql === undefined ? {} : { rawSql }),
    ...(projectConfiguration.analysis.interactions === undefined
      ? {}
      : { interactions: projectConfiguration.analysis.interactions }),
    ...(projectConfiguration.analysis.authorization === undefined
      ? {}
      : { authorization: projectConfiguration.analysis.authorization }),
  };
  let baselineScan: Awaited<ReturnType<typeof scanRepository>>;
  let candidateScan: Awaited<ReturnType<typeof scanRepository>>;
  try {
    baselineScan = await scanRepository({
      repositoryRoot: baselineDirectory,
      ...(Object.keys(analysisConfiguration).length === 0
        ? {}
        : { configuration: analysisConfiguration }),
    });
    candidateScan = await scanRepository({
      repositoryRoot: candidateDirectory,
      ...(Object.keys(analysisConfiguration).length === 0
        ? {}
        : { configuration: analysisConfiguration }),
    });
  } catch (error) {
    throw new CiRepositoryEvaluationRunError(
      'analysis_failure',
      'Baseline or candidate analysis could not be completed.',
      { cause: error },
    );
  }
  for (const [label, scan] of [
    ['Baseline', baselineScan],
    ['Candidate', candidateScan],
  ] as const) {
    if (scan.analysis.resultState === 'failed') {
      throw new CiRepositoryEvaluationRunError('analysis_failure', `${label} analysis failed.`);
    }
    if (scan.analysis.resultState === 'canceled') {
      throw new CiRepositoryEvaluationRunError('canceled', `${label} analysis was canceled.`);
    }
  }

  const comparison = compareAnalysisDocuments(baselineScan.analysis, candidateScan.analysis);
  const impact = analyzePotentialImpact(baselineScan.analysis, candidateScan.analysis);
  const policyResults = evaluatePolicies({
    analysis: candidateScan.analysis,
    baseline: baselineScan.analysis,
    configuration: {
      version: POLICY_CONFIGURATION_VERSION,
      rules: projectConfiguration.rules,
    },
  });
  const evaluation = evaluateCiArtifacts({
    baseline: baselineScan.analysis,
    candidate: candidateScan.analysis,
    comparison,
    impact,
    policyResults,
  });
  const baselineRepositoryRevision = evaluation.provenance.baseline.repositoryRevision;
  const candidateRepositoryRevision = evaluation.provenance.candidate.repositoryRevision;
  if (
    baselineRepositoryRevision === null ||
    candidateRepositoryRevision === null ||
    baselineRepositoryRevision !== baselineRevision ||
    candidateRepositoryRevision !== candidateRevision
  ) {
    throw new CiRepositoryEvaluationRunError(
      'incompatible_baseline',
      'Analyzed repository revisions do not match the declared baseline and candidate revisions.',
    );
  }
  const recipe = createCiScanRecipe({
    evaluation,
    engineDistributionFingerprint: input.engineDistributionFingerprint,
    projectConfigurationPath: portableCiPath(baselineDirectory, configurationPath),
    projectConfigurationFingerprint: hashContent(configurationContents),
    topology: { state: 'not_applicable', fingerprint: null },
    baselineAcquisition: {
      kind: 'isolated_scan',
      workspaceIsolationKey: `baseline:${evaluation.provenance.baseline.repositoryRevision}`,
      dependencies: baselineDependencies,
    },
    candidateAcquisition: {
      kind: 'isolated_scan',
      workspaceIsolationKey: `candidate:${evaluation.provenance.candidate.repositoryRevision}`,
      dependencies: candidateDependencies,
    },
  });
  verifyCiScanRecipe(recipe, {
    evaluation,
    baselineRepositoryRevision: baselineRevision,
    candidateRepositoryRevision: candidateRevision,
    engineDistributionFingerprint: input.engineDistributionFingerprint,
    projectConfigurationFingerprint: hashContent(configurationContents),
    topology: { state: 'not_applicable', fingerprint: null },
    baselineDependencies,
    candidateDependencies,
    runtimeNodeVersion: process.version,
  });

  const artifactPath = join(outputRoot, evaluation.evaluationId.replace(':', '-'));
  const graphDocument = buildGraphReportDocument({
    analysis: candidateScan.analysis,
    policyResults,
    impact,
    options: {
      maxNodesPerEndpoint: projectConfiguration.graph?.maxNodesPerEndpoint,
      maxEdgesPerEndpoint: projectConfiguration.graph?.maxEdgesPerEndpoint,
    },
  });
  const graph = await prepareOfflineGraphReportArtifact({
    outputDirectory: artifactPath,
    document: graphDocument,
    analysis: candidateScan.analysis,
    policyResults,
    impact,
  });
  return {
    evaluation,
    recipe,
    artifactPath,
    files: [
      {
        path: join(artifactPath, 'ci-evaluation.json'),
        contents: serializeCiEvaluationDocument(evaluation),
      },
      {
        path: join(artifactPath, 'ci-evaluation.md'),
        contents: renderCiEvaluationMarkdown(evaluation),
      },
      {
        path: join(artifactPath, 'ci-scan-recipe.json'),
        contents: serializeCiScanRecipeManifest(recipe),
      },
      { path: join(artifactPath, 'diff.json'), contents: serializeDiffDocument(comparison) },
      { path: join(artifactPath, 'impact.json'), contents: serializeImpactDocument(impact) },
      {
        path: join(artifactPath, 'policy-results.json'),
        contents: serializePolicyResults(policyResults),
      },
      { path: graph.artifact.path, contents: graph.artifact.contents },
    ],
  };
}
