import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { resolveNpmCliPath } from './package-manager-cli.mjs';

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, '..');
const temporaryParent = resolve(repositoryRoot, '.tmp');
const outputRoot = resolve(temporaryParent, 'release-dry-run');
const npmCli = resolveNpmCliPath();

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalize(path) {
  return path.replaceAll('\\', '/');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function parseArguments(arguments_) {
  if (arguments_.some((entry) => entry !== '--prepared')) {
    throw new Error('Usage: release-dry-run.mjs [--prepared]');
  }
  return { prepared: arguments_.includes('--prepared') };
}

async function run(executable, arguments_, options = {}) {
  const result = await execFile(executable, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  return typeof result.stdout === 'string' ? result.stdout.trim() : result.stdout;
}

async function runPackageScript(name) {
  const pnpmCli = await resolvePnpmExecutable();
  process.stdout.write(`Verifying ${name}...\n`);
  await execFile(pnpmCli, ['run', name], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
  });
}

async function resolvePnpmExecutable() {
  const configured = process.env.API_INTEL_PNPM_EXECUTABLE;
  if (configured) {
    if (!isAbsolute(configured)) {
      throw new Error('API_INTEL_PNPM_EXECUTABLE must be an absolute path.');
    }
    await access(configured);
    return realpath(configured);
  }
  const inherited = process.env.npm_execpath;
  if (inherited && (process.platform !== 'win32' || inherited.toLowerCase().endsWith('.exe'))) {
    return inherited;
  }
  if (process.platform !== 'win32') {
    throw new Error('The dry run must be invoked through `pnpm run release:dry-run`.');
  }
  const localApplicationData = process.env.LOCALAPPDATA;
  if (localApplicationData) {
    const shim = resolve(localApplicationData, 'pnpm/bin/pnpm.ps1');
    try {
      const source = await readFile(shim, 'utf8');
      const match = source.match(/\$basedir\/([^"\r\n]*?pnpm\.exe)/u);
      if (match?.[1]) {
        const executable = resolve(dirname(shim), ...match[1].split('/'));
        await access(executable);
        return realpath(executable);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(
    'Cannot resolve a directly executable pnpm binary; set API_INTEL_PNPM_EXECUTABLE.',
  );
}

async function safeResetOutput() {
  await mkdir(temporaryParent, { recursive: true });
  const canonicalParent = await realpath(temporaryParent);
  const prospective = resolve(canonicalParent, basename(outputRoot));
  if (prospective !== outputRoot || dirname(prospective) !== canonicalParent) {
    throw new Error('Refusing to reset an output outside the verified .tmp directory.');
  }
  await rm(prospective, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(prospective, { recursive: true });
}

async function git(arguments_, options = {}) {
  return run('git', ['-c', `safe.directory=${normalize(repositoryRoot)}`, ...arguments_], options);
}

async function sourceIdentity(packageVersion, tagPrefix) {
  try {
    const [revision, statusText, listed] = await Promise.all([
      git(['rev-parse', 'HEAD']),
      git(['status', '--porcelain=v1', '--untracked-files=all']),
      git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        encoding: 'buffer',
      }),
    ]);
    const paths = listed
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    const records = [];
    for (const path of paths) {
      try {
        records.push({
          path: normalize(path),
          sha256: sha256(await readFile(resolve(repositoryRoot, path))),
        });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        records.push({ path: normalize(path), sha256: '<missing>' });
      }
    }
    let exactTag = null;
    try {
      exactTag = await git(['describe', '--tags', '--exact-match', 'HEAD']);
    } catch {
      // An untagged development snapshot is expected before O5.
    }
    const dirtyEntries = statusText === '' ? 0 : statusText.split(/\r?\n/u).length;
    return {
      revision,
      treeState: dirtyEntries === 0 ? 'clean' : 'dirty',
      treeFingerprint: `sha256:${sha256(`${JSON.stringify(records)}\n`)}`,
      inventoriedFiles: records.length,
      dirtyEntries,
      exactTag,
      expectedTag: `${tagPrefix}${packageVersion}`,
      tagMatchesVersion: exactTag === `${tagPrefix}${packageVersion}`,
    };
  } catch (error) {
    return {
      revision: null,
      treeState: 'unavailable',
      treeFingerprint: null,
      inventoriedFiles: 0,
      dirtyEntries: null,
      exactTag: null,
      expectedTag: `${tagPrefix}${packageVersion}`,
      tagMatchesVersion: false,
      resolutionError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function filesIn(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
      ({ name: left }, { name: right }) => left.localeCompare(right),
    )) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Dry-run bundle contains non-regular entry ${path}.`);
    }
  }
  await visit(root);
  return files;
}

async function fileRecords(root, excluded = new Set()) {
  const records = [];
  for (const path of await filesIn(root)) {
    const relativePath = normalize(relative(root, path));
    if (excluded.has(relativePath)) continue;
    const bytes = await readFile(path);
    records.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return records;
}

async function copyEvidence(source, destination) {
  const target = resolve(outputRoot, destination);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(repositoryRoot, source), target);
}

async function createPackageArchive() {
  const directory = resolve(outputRoot, 'artifacts/npm');
  const cache = resolve(outputRoot, 'work/npm-cache');
  await mkdir(directory, { recursive: true });
  await mkdir(cache, { recursive: true });
  const stdout = await run(process.execPath, [
    npmCli,
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    directory,
    '--cache',
    cache,
  ]);
  const records = JSON.parse(stdout);
  if (!Array.isArray(records) || records.length !== 1) {
    throw new Error('Dry-run npm pack did not return exactly one archive.');
  }
  await rm(resolve(outputRoot, 'work'), { recursive: true, force: true, maxRetries: 3 });
  return records[0];
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const commonChecks = [
    'audit:licenses',
    'audit:dependencies',
    'audit:public',
    'release:integrity',
  ];
  const completeChecks = [
    'build',
    'schema:check',
    ...commonChecks.slice(0, 3),
    'pack:contents:check',
    'artifacts:check',
    'release:integrity',
  ];
  for (const check of options.prepared ? commonChecks : completeChecks) {
    await runPackageScript(check);
  }

  const manifest = await readJson(resolve(repositoryRoot, 'package.json'));
  const publicManifest = !Object.hasOwn(manifest, 'private');
  const packageContentsPath = publicManifest
    ? 'packaging/npm/public-package-contents.json'
    : 'packaging/npm/package-contents.json';
  const releaseInputsPath = publicManifest
    ? 'packaging/release/public-release-inputs.json'
    : 'packaging/release/release-inputs.json';
  const releaseChecksumsPath = publicManifest
    ? 'packaging/release/PUBLIC_SHA256SUMS'
    : 'packaging/release/SHA256SUMS';
  const [policy, packageContents, providerArtifacts, vulnerability] = await Promise.all([
    readJson(resolve(repositoryRoot, 'packaging/release/release-integrity-policy.json')),
    readJson(resolve(repositoryRoot, packageContentsPath)),
    readJson(resolve(repositoryRoot, 'packaging/release/reproducible-artifacts.json')),
    readJson(resolve(repositoryRoot, 'packaging/release/dependency-vulnerability-report.json')),
  ]);
  await safeResetOutput();
  const source = await sourceIdentity(manifest.version, policy.versioning.tagPrefix);
  const archive = await createPackageArchive();
  if (archive.integrity !== packageContents.archive.integrity) {
    throw new Error('Dry-run package bytes differ from the reviewed npm package manifest.');
  }

  await Promise.all([
    copyEvidence(
      'packaging/release/source-dependencies.cdx.json',
      'evidence/source-dependencies.cdx.json',
    ),
    copyEvidence(releaseInputsPath, 'evidence/release-inputs.json'),
    copyEvidence(releaseChecksumsPath, 'evidence/source-SHA256SUMS'),
    copyEvidence(
      'packaging/release/dependency-vulnerability-report.json',
      'evidence/dependency-vulnerability-report.json',
    ),
    copyEvidence(
      'packaging/release/vulnerability-exceptions.json',
      'evidence/vulnerability-exceptions.json',
    ),
    copyEvidence(
      'docs/legal/dependency-license-inventory.json',
      'evidence/dependency-license-inventory.json',
    ),
    copyEvidence('docs/legal/redistribution-audit.md', 'evidence/redistribution-audit.md'),
    copyEvidence(
      'packaging/release/reproducible-artifacts.json',
      'evidence/provider-artifacts.json',
    ),
    copyEvidence('LICENSE', 'legal/LICENSE'),
    copyEvidence('THIRD_PARTY_NOTICES.md', 'legal/THIRD_PARTY_NOTICES.md'),
    copyEvidence('action.yml', 'artifacts/github/action.yml'),
    copyEvidence('templates/api-intel/template.yml', 'artifacts/gitlab/template.yml'),
    copyEvidence('packaging/gitlab/Dockerfile', 'artifacts/gitlab/Dockerfile'),
    cp(
      resolve(repositoryRoot, 'action-dist'),
      resolve(outputRoot, 'artifacts/github/action-dist'),
      {
        recursive: true,
        force: false,
      },
    ),
    cp(
      resolve(repositoryRoot, 'gitlab-dist'),
      resolve(outputRoot, 'artifacts/gitlab/gitlab-dist'),
      {
        recursive: true,
        force: false,
      },
    ),
  ]);

  const blockers = [];
  if (source.treeState !== 'clean') blockers.push('source_tree_not_clean');
  if (!source.tagMatchesVersion) blockers.push('source_tag_does_not_match_package_version');
  if (manifest.private === true) blockers.push('source_manifest_is_private_before_o5');
  blockers.push(...policy.pendingIndependentGates);
  const pnpmCli = await resolvePnpmExecutable();
  const pnpmVersion =
    process.env.npm_config_user_agent?.match(/(?:^|\s)pnpm\/([^\s]+)/u)?.[1] ??
    (await run(pnpmCli, ['--version']));
  const toolchain = {
    node: process.version,
    pnpm: pnpmVersion,
    npm: await run(process.execPath, [npmCli, '--version']),
    git: await git(['--version']).catch(() => null),
  };
  if (`pnpm@${toolchain.pnpm}` !== manifest.packageManager) {
    blockers.push('actual_pnpm_differs_from_declared_package_manager');
  }
  const files = await fileRecords(
    outputRoot,
    new Set(['release-candidate-manifest.json', 'SHA256SUMS']),
  );
  const candidate = {
    schemaVersion: '1.0.0',
    kind: 'non_publishing_release_dry_run',
    package: { name: manifest.name, version: manifest.version },
    source,
    toolchain,
    artifacts: {
      npm: {
        path: `artifacts/npm/${archive.filename}`,
        sha256: files.find(({ path }) => path === `artifacts/npm/${archive.filename}`)?.sha256,
        integrity: archive.integrity,
      },
      providers: Object.fromEntries(
        Object.entries(providerArtifacts.providers).map(([name, provider]) => [
          name,
          provider.fingerprint,
        ]),
      ),
      files,
    },
    dependencyDecision: {
      reviewedOn: vulnerability.reviewedOn,
      expiresOn: vulnerability.expiresOn,
      unreviewedHighCritical: vulnerability.summary.unreviewedHighCritical,
    },
    releaseReadiness: {
      publishable: false,
      blockers: [...new Set(blockers)],
      note: 'This dry run validates bytes and evidence only; it cannot authorize or perform publication.',
    },
    trustBoundary: {
      externalMutationPerformed: false,
      credentialsRequired: false,
      writes: ['.tmp/release-dry-run'],
    },
  };
  const manifestPath = resolve(outputRoot, 'release-candidate-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  const finalRecords = await fileRecords(outputRoot, new Set(['SHA256SUMS']));
  await writeFile(
    resolve(outputRoot, 'SHA256SUMS'),
    `${finalRecords.map(({ path, sha256: digest }) => `${digest}  ${path}`).join('\n')}\n`,
    'utf8',
  );
  const outputStats = await stat(resolve(outputRoot, `artifacts/npm/${archive.filename}`));
  process.stdout.write(
    `Non-publishing release dry run complete: ${finalRecords.length} files, ` +
      `${outputStats.size} byte npm archive, ${candidate.releaseReadiness.blockers.length} publication blockers recorded in ${normalize(relative(repositoryRoot, manifestPath))}.\n`,
  );
}

await main();
