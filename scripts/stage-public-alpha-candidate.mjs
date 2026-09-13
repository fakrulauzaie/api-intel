import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, '..');
const contractPath = resolve(
  repositoryRoot,
  'packaging/release/public-alpha-candidate-contract.json',
);
const candidateParent = resolve(repositoryRoot, '.tmp/public-alpha-candidate');
const workParent = resolve(repositoryRoot, '.tmp');
const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const maximumOutputBytes = 64 * 1024 * 1024;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(path) {
  return path.replaceAll('\\', '/');
}

function fingerprint(records) {
  return `sha256:${sha256(`${JSON.stringify(records)}\n`)}`;
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function parseMode(arguments_) {
  if (arguments_.length !== 1 || !['--write', '--check'].includes(arguments_[0])) {
    throw new Error('Usage: stage-public-alpha-candidate.mjs --write|--check');
  }
  return arguments_[0];
}

async function run(executable, arguments_, options = {}) {
  const result = await execFile(executable, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: maximumOutputBytes,
    windowsHide: true,
    ...options,
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function git(arguments_, options = {}) {
  return run('git', ['-c', `safe.directory=${normalize(repositoryRoot)}`, ...arguments_], options);
}

async function filesIn(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
      ({ name: left }, { name: right }) => left.localeCompare(right),
    )) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Candidate contains symbolic link ${normalize(relative(root, path))}.`);
      }
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Candidate contains unsupported filesystem entry ${path}.`);
    }
  }
  await visit(root);
  return files;
}

async function recordsFor(root) {
  const records = [];
  for (const path of await filesIn(root)) {
    const bytes = await readFile(path);
    records.push({
      path: normalize(relative(root, path)),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  return records;
}

function assertContract(contract, manifest) {
  if (contract.schemaVersion !== '1.0.0') throw new Error('Unknown alpha-candidate contract.');
  if (
    manifest.name !== contract.package.name ||
    manifest.version !== contract.package.version ||
    manifest.private !== contract.package.sourceManifestPrivate
  ) {
    throw new Error('Private source package identity does not match the alpha-candidate contract.');
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z.-]+$/u.test(manifest.version)) {
    throw new Error('The alpha candidate must use a SemVer prerelease version.');
  }
  if (
    contract.package.stagedManifestPrivateProperty !== 'omitted' ||
    contract.releaseBoundary.externalMutationAuthorized !== false ||
    contract.releaseBoundary.sourceRepositoryHistoryIncluded !== false
  ) {
    throw new Error('The alpha-candidate trust boundary drifted.');
  }
}

async function sourceInventory(contract) {
  const { stdout } = await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const paths = stdout
    .split('\0')
    .filter(Boolean)
    .map(normalize)
    .sort((left, right) => left.localeCompare(right));
  const allowedFiles = new Set(contract.sourceExport.allowedRootFiles);
  const allowedDirectories = new Set(contract.sourceExport.allowedRootDirectories);
  const forbidden = new Set(contract.sourceExport.forbiddenPathSegments);
  const records = [];
  for (const path of paths) {
    const segments = path.split('/');
    if (segments.some((segment) => forbidden.has(segment))) {
      throw new Error(`Source export includes forbidden path ${path}.`);
    }
    const root = segments[0];
    if (
      (segments.length === 1 && !allowedFiles.has(root)) ||
      (segments.length > 1 && !allowedDirectories.has(root))
    ) {
      throw new Error(`Source export path is not allowlisted: ${path}.`);
    }
    const source = resolve(repositoryRoot, path);
    let sourceStats;
    try {
      sourceStats = await stat(source);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!sourceStats.isFile())
      throw new Error(`Source export path is not a regular file: ${path}.`);
    const bytes = await readFile(source);
    records.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  if (records.length === 0) throw new Error('Source export inventory is empty.');
  return records;
}

async function exportSource(records, destination) {
  for (const record of records) {
    const target = resolve(destination, record.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(repositoryRoot, record.path), target);
  }
}

async function makeManifestPublic(sourceRoot, contract) {
  const path = resolve(sourceRoot, 'package.json');
  const manifest = await json(path);
  if (manifest.private !== true) throw new Error('Expected the private source manifest guard.');
  delete manifest.private;
  if (manifest.name !== contract.package.name || manifest.version !== contract.package.version) {
    throw new Error('Candidate package identity drifted during staging.');
  }
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function verifyImmutableReferences(sourceRoot, contract) {
  const actionFiles = [
    '.github/workflows/ci.yml',
    '.github/workflows/dco.yml',
    'action.yml',
    'docs/examples/github/api-intel-pull-request.yml',
  ];
  for (const path of actionFiles) {
    const text = await readFile(resolve(sourceRoot, path), 'utf8');
    for (const match of text.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+).*$/gmu)) {
      const reference = match[1];
      if (!/^[a-f0-9]{40,64}$/u.test(reference) && reference !== 'ACTION_COMMIT_SHA') {
        throw new Error(`Mutable GitHub Action reference in ${path}: ${reference}.`);
      }
    }
  }
  const [component, example, guide] = await Promise.all([
    readFile(resolve(sourceRoot, 'templates/api-intel/template.yml'), 'utf8'),
    readFile(resolve(sourceRoot, 'docs/examples/gitlab/api-intel-merge-request.yml'), 'utf8'),
    readFile(resolve(sourceRoot, 'docs/gitlab-ci.md'), 'utf8'),
  ]);
  if (!component.includes('^.+@sha256:[a-f0-9]{64}$')) {
    throw new Error('GitLab component no longer requires an OCI manifest digest.');
  }
  if (!example.includes('@sha256:IMAGE_MANIFEST_DIGEST')) {
    throw new Error('GitLab consumer example is not pinned to an image manifest digest.');
  }
  if (!guide.includes('component include by a full commit SHA')) {
    throw new Error('GitLab guide no longer requires a full component commit SHA.');
  }
  if (contract.immutableReferences.mutableConsumptionTagsAllowed !== false) {
    throw new Error('Mutable consumer references are not allowed for the alpha candidate.');
  }
}

async function verifyCommunityBoundary(sourceRoot) {
  const [security, conduct, support, issueConfig, dco] = await Promise.all([
    readFile(resolve(sourceRoot, 'SECURITY.md'), 'utf8'),
    readFile(resolve(sourceRoot, 'CODE_OF_CONDUCT.md'), 'utf8'),
    readFile(resolve(sourceRoot, 'SUPPORT.md'), 'utf8'),
    readFile(resolve(sourceRoot, '.github/ISSUE_TEMPLATE/config.yml'), 'utf8'),
    readFile(resolve(sourceRoot, '.github/workflows/dco.yml'), 'utf8'),
  ]);
  if (!security.includes('channel is not active')) {
    throw new Error('SECURITY.md must retain pre-publication inactive-channel wording.');
  }
  if (!conduct.includes('has not yet been configured')) {
    throw new Error('CODE_OF_CONDUCT.md must retain pre-publication inactive-channel wording.');
  }
  if (!support.includes('source-free reproduction workflow')) {
    throw new Error('SUPPORT.md must retain the source-free intake boundary.');
  }
  if (!issueConfig.includes('blank_issues_enabled: false')) {
    throw new Error('Blank public issues must remain disabled.');
  }
  if (!dco.includes('DCO')) throw new Error('The DCO workflow is missing from the candidate.');
}

async function auditStaged(sourceRoot) {
  return run(process.execPath, [
    resolve(repositoryRoot, 'scripts/audit-public-release.mjs'),
    '--staged',
    sourceRoot,
  ]);
}

async function createArchive(sourceRoot, artifactsRoot, workRoot) {
  const packageWork = resolve(workRoot, 'package-work');
  const secondPack = resolve(workRoot, 'second-pack');
  await cp(sourceRoot, packageWork, { recursive: true, force: false });
  await cp(resolve(repositoryRoot, 'dist'), resolve(packageWork, 'dist'), {
    recursive: true,
    force: false,
  });
  await mkdir(artifactsRoot, { recursive: true });
  await mkdir(secondPack, { recursive: true });
  const pack = async (destination, cache) => {
    const { stdout } = await run(
      process.execPath,
      [
        npmCli,
        'pack',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        destination,
        '--cache',
        cache,
      ],
      { cwd: packageWork },
    );
    const result = JSON.parse(stdout);
    if (!Array.isArray(result) || result.length !== 1) {
      throw new Error('npm pack did not return exactly one alpha archive.');
    }
    return result[0];
  };
  const first = await pack(artifactsRoot, resolve(workRoot, 'npm-cache-1'));
  const second = await pack(secondPack, resolve(workRoot, 'npm-cache-2'));
  const [firstBytes, secondBytes] = await Promise.all([
    readFile(resolve(artifactsRoot, first.filename)),
    readFile(resolve(secondPack, second.filename)),
  ]);
  if (first.filename !== second.filename || !firstBytes.equals(secondBytes)) {
    throw new Error('Two independent npm pack operations did not produce identical bytes.');
  }
  return {
    filename: first.filename,
    fileCount: first.entryCount,
    packedBytes: first.size,
    unpackedBytes: first.unpackedSize,
    shasum: first.shasum,
    integrity: first.integrity,
    sha256: sha256(firstBytes),
  };
}

async function installSmoke(archivePath, contract, workRoot) {
  const consumer = resolve(workRoot, 'consumer');
  await mkdir(consumer, { recursive: true });
  await writeFile(
    resolve(consumer, 'package.json'),
    `${JSON.stringify({ name: 'api-intel-alpha-candidate-smoke', version: '1.0.0', private: true }, null, 2)}\n`,
    'utf8',
  );
  await run(
    process.execPath,
    [
      npmCli,
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--cache',
      resolve(workRoot, 'consumer-npm-cache'),
      archivePath,
    ],
    { cwd: consumer },
  );
  const packageRoot = resolve(consumer, 'node_modules', ...contract.package.name.split('/'));
  const installedManifest = await json(resolve(packageRoot, 'package.json'));
  if (
    installedManifest.name !== contract.package.name ||
    installedManifest.version !== contract.package.version ||
    Object.hasOwn(installedManifest, 'private')
  ) {
    throw new Error('Installed alpha manifest is not the reviewed public candidate manifest.');
  }
  const cli = resolve(packageRoot, 'dist/cli/index.js');
  const [version, help, configSchema, supportSchema] = await Promise.all([
    run(process.execPath, [cli, '--version'], { cwd: consumer }),
    run(process.execPath, [cli, '--help'], { cwd: consumer }),
    json(resolve(packageRoot, 'schemas/api-intel.config.schema.json')),
    json(resolve(packageRoot, 'schemas/support-diagnostic-manifest.schema.json')),
  ]);
  if (version.stdout !== contract.package.version || !help.stdout.includes('api-intel <command>')) {
    throw new Error('Installed alpha CLI version/help smoke failed.');
  }
  return {
    packageVersion: version.stdout,
    publicManifestPrivateProperty: 'omitted',
    lifecycleScriptsExecuted: false,
    sourceWorkspaceNodeModulesUsed: false,
    cliHelp: 'pass',
    configurationSchema: configSchema.$schema,
    supportSchema: supportSchema.$schema,
  };
}

async function copyReleaseEvidence(sourceRoot, artifactsRoot) {
  const paths = [
    'CHANGELOG.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'docs/compatibility-and-support.md',
    'docs/current-limitations.md',
    'docs/releases/0.1.0-alpha.1.md',
    'docs/release-integrity-and-response.md',
    'docs/legal/dependency-license-inventory.json',
    'docs/legal/redistribution-audit.md',
    'packaging/release/SHA256SUMS',
    'packaging/release/PUBLIC_SHA256SUMS',
    'packaging/release/release-inputs.json',
    'packaging/release/public-release-inputs.json',
    'packaging/release/source-dependencies.cdx.json',
  ];
  for (const path of paths) {
    const target = resolve(artifactsRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(sourceRoot, path), target);
  }
}

async function verifyRetainedCandidate(candidateRoot, contract) {
  const candidate = await json(resolve(candidateRoot, 'release-candidate-manifest.json'));
  if (
    candidate.schemaVersion !== '1.0.0' ||
    candidate.package.name !== contract.package.name ||
    candidate.package.version !== contract.package.version ||
    candidate.publication.externalMutationPerformed !== false
  ) {
    throw new Error('Retained alpha-candidate manifest violates the frozen contract.');
  }
  for (const section of ['source', 'artifacts']) {
    const root = resolve(candidateRoot, section);
    const actual = await recordsFor(root);
    if (JSON.stringify(actual) !== JSON.stringify(candidate.content[section].files)) {
      throw new Error(`Retained alpha candidate ${section} bytes drifted.`);
    }
  }
  await auditStaged(resolve(candidateRoot, 'source'));
  const archivePath = resolve(candidateRoot, 'artifacts/npm', candidate.package.archive.filename);
  if (sha256(await readFile(archivePath)) !== candidate.package.archive.sha256) {
    throw new Error('Retained alpha npm archive digest drifted.');
  }
  return candidate;
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const [contract, manifest] = await Promise.all([
    json(contractPath),
    json(resolve(repositoryRoot, 'package.json')),
  ]);
  assertContract(contract, manifest);
  await access(resolve(repositoryRoot, 'dist/cli/index.js'));
  const sourceFiles = await sourceInventory(contract);
  const privateSourceFingerprint = fingerprint(sourceFiles);
  const workRoot = resolve(workParent, `o5-alpha-work-${process.pid}`);
  if (dirname(workRoot) !== workParent || !basename(workRoot).startsWith('o5-alpha-work-')) {
    throw new Error('Refusing to use an unverified candidate work directory.');
  }
  await rm(workRoot, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(workRoot, { recursive: true });
  try {
    const sourceRoot = resolve(workRoot, 'candidate/source');
    await exportSource(sourceFiles, sourceRoot);
    await makeManifestPublic(sourceRoot, contract);
    await verifyImmutableReferences(sourceRoot, contract);
    await verifyCommunityBoundary(sourceRoot);
    const stagedAudit = await auditStaged(sourceRoot);
    const stagedFiles = await recordsFor(sourceRoot);
    const stagedSourceFingerprint = fingerprint(stagedFiles);
    const directoryName = `${contract.package.version}-${stagedSourceFingerprint.slice(7, 23)}`;
    const retainedRoot = resolve(candidateParent, directoryName);

    if (mode === '--check') {
      const candidate = await verifyRetainedCandidate(retainedRoot, contract);
      if (
        candidate.source.privateTreeFingerprint !== privateSourceFingerprint ||
        candidate.source.stagedTreeFingerprint !== stagedSourceFingerprint
      ) {
        throw new Error(
          'Retained candidate is not derived from the current approved source snapshot.',
        );
      }
      process.stdout.write(
        `Alpha candidate verified: ${normalize(relative(repositoryRoot, retainedRoot))}.\n`,
      );
      return;
    }

    try {
      await access(retainedRoot);
      await verifyRetainedCandidate(retainedRoot, contract);
      throw new Error(
        `The content-addressed candidate already exists at ${normalize(relative(repositoryRoot, retainedRoot))}; use release:alpha:check.`,
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const artifactsRoot = resolve(workRoot, 'candidate/artifacts');
    const npmRoot = resolve(artifactsRoot, 'npm');
    const archive = await createArchive(sourceRoot, npmRoot, resolve(workRoot, 'work'));
    const install = await installSmoke(
      resolve(npmRoot, archive.filename),
      contract,
      resolve(workRoot, 'install'),
    );
    await copyReleaseEvidence(sourceRoot, resolve(artifactsRoot, 'release'));

    const [revision, status] = await Promise.all([
      git(['rev-parse', 'HEAD']),
      git(['status', '--porcelain=v1', '--untracked-files=all']),
    ]);
    const artifactsFiles = await recordsFor(artifactsRoot);
    const candidate = {
      schemaVersion: '1.0.0',
      kind: 'audited_non_publishing_public_alpha_candidate',
      package: { name: contract.package.name, version: contract.package.version, archive },
      source: {
        privateGitHead: revision.stdout,
        privateTreeState: status.stdout === '' ? 'clean' : 'dirty_content_snapshot',
        privateDirtyEntries: status.stdout === '' ? 0 : status.stdout.split(/\r?\n/u).length,
        privateTreeFingerprint: privateSourceFingerprint,
        stagedTreeFingerprint: stagedSourceFingerprint,
        stagedFiles: stagedFiles.length,
        gitHistoryIncluded: false,
        derivation: 'allowlisted export plus package.json private-property omission only',
      },
      content: {
        source: { fingerprint: stagedSourceFingerprint, files: stagedFiles },
        artifacts: { fingerprint: fingerprint(artifactsFiles), files: artifactsFiles },
      },
      verification: {
        stagedPublicAudit: stagedAudit.stdout,
        immutableConsumerReferences: 'pass',
        communityPrePublicationBoundary: 'pass',
        independentNpmPackReproducibility: 'pass',
        exactCandidateInstallSmoke: install,
      },
      gates: {
        OT0: 'candidate_tree_pass; private security/conduct channel activation deferred to O5.2',
        OD0: 'exact archive packaging and disposable install smoke pass; retained full npm/pnpm evidence applies to the same source version',
        OR0: 'candidate bytes content-addressed; independent hosted, exact OCI, and channel gates remain pending',
        OX0: 'repository documentation/tests pass; no named-browser matrix claimed',
      },
      surfaces: contract.surfaceClaims,
      pendingIndependentGates: [
        'sanitized_public_repository_clean_clone_hosted_matrix',
        'exact_oci_image_sbom_base_digest_and_source_obligation_review',
        'gitlab_hosted_component_validation',
        'private_security_reporting_channel_activation',
        'private_conduct_reporting_channel_activation',
        'named_browser_matrix_if_claimed',
      ],
      publication: {
        authorizedByThisCandidate: false,
        externalMutationPerformed: false,
        registryPushPerformed: false,
        tagOrReleaseCreated: false,
        publicRepositoryCreated: false,
      },
    };
    const candidateRoot = resolve(workRoot, 'candidate');
    await writeFile(
      resolve(candidateRoot, 'release-candidate-manifest.json'),
      `${JSON.stringify(candidate, null, 2)}\n`,
      'utf8',
    );
    const checksummed = [
      ...stagedFiles.map((entry) => ({ ...entry, path: `source/${entry.path}` })),
      ...artifactsFiles.map((entry) => ({ ...entry, path: `artifacts/${entry.path}` })),
    ];
    await writeFile(
      resolve(candidateRoot, 'SHA256SUMS'),
      `${checksummed.map(({ path, sha256: digest }) => `${digest}  ${path}`).join('\n')}\n`,
      'utf8',
    );
    await mkdir(candidateParent, { recursive: true });
    await rename(candidateRoot, retainedRoot);
    await verifyRetainedCandidate(retainedRoot, contract);
    process.stdout.write(
      `Alpha candidate staged without publication: ${normalize(relative(repositoryRoot, retainedRoot))} ` +
        `(${stagedFiles.length} source files, ${archive.packedBytes} byte npm archive).\n`,
    );
  } finally {
    await rm(workRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

await main();
