import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { resolveNpmCliPath } from './package-manager-cli.mjs';

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, '..');
const policyPath = resolve(repositoryRoot, 'scripts/public-release-audit-policy.json');
const reportPath = resolve(repositoryRoot, 'docs/legal/public-release-audit.json');
const git = 'git';
const npmCli = resolveNpmCliPath();

const credentialPatterns = [
  {
    category: 'github_token',
    expression: new RegExp(
      String.raw`\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b`,
      'gu',
    ),
  },
  {
    category: 'aws_access_key',
    expression: new RegExp(String.raw`\b(?:AKIA|ASIA)[A-Z0-9]{16}\b`, 'gu'),
  },
  {
    category: 'npm_token',
    expression: new RegExp(String.raw`\bnpm_[A-Za-z0-9]{30,}\b`, 'gu'),
  },
  {
    category: 'slack_token',
    expression: new RegExp(String.raw`\bxox[baprs]-[A-Za-z0-9-]{20,}\b`, 'gu'),
  },
  {
    category: 'private_key_block',
    expression: new RegExp(
      ['-----BEGIN ', '(?:RSA |EC |OPENSSH |DSA )?', 'PRIVATE KEY-----'].join(''),
      'gu',
    ),
  },
  {
    category: 'url_userinfo',
    expression: new RegExp(String.raw`https?:\/\/[^\s/@:]+:[^\s/@]+@`, 'gu'),
  },
  {
    category: 'personal_absolute_path',
    expression: new RegExp(
      String.raw`(?:[A-Za-z]:\\Users\\[^\\\s"'<>]+|\/(?:Users|home)\/[^/\s"'<>]+)`,
      'gu',
    ),
  },
];

const publicDocumentPathPattern = new RegExp(
  String.raw`(?:[A-Za-z]:\\(?![\\])[^\s\x60"'<>]+|\/(?:Users|home)\/[^/\s\x60"'<>]+)`,
  'gu',
);
const tokenPattern = /[A-Za-z0-9][A-Za-z0-9._-]{2,}/gu;
const generatedPathPattern = /(?:^|\/)(?:\.api-intel|\.tmp|\.demo|coverage)(?:\/|$)/u;
const sensitiveFilePattern =
  /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.yarnrc|[^/]+\.(?:pem|p12|pfx|key|keystore))$/iu;
const alwaysTextExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sh',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function pathMatches(candidate, rule) {
  const normalized = normalizePath(candidate);
  if (rule.endsWith('/**')) return normalized.startsWith(rule.slice(0, -2));
  return normalized === rule;
}

function allowed(policy, category, path) {
  return (policy.syntheticAllowlist[category] ?? []).some((rule) => pathMatches(path, rule));
}

function publicDocument(path) {
  return path === 'README.md' || path.endsWith('.md');
}

function validateOwnershipPublicationAttestation(policy) {
  if (policy.schemaVersion !== '1.1.0') {
    throw new Error('Public-release audit policy must use schema version 1.1.0.');
  }
  const attestation = policy.ownershipPublicationAttestation;
  if (
    attestation?.status !== 'recorded' ||
    attestation.recordedAt !== '2026-09-10' ||
    attestation.projectOwnedSourceAuthorized !== true ||
    attestation.organizationTestingPermissionDoesNotGrantRedistribution !== true ||
    attestation.organizationDerivedPublicMaterialAllowed !== false ||
    attestation.legacyHistoryIncluded !== false ||
    attestation.thirdPartyObligationsRemainApplicable !== true ||
    attestation.externalMutationAuthorized !== false
  ) {
    throw new Error(
      'Owner attestation must authorize only project-owned source while excluding organization-derived material, legacy history, and external mutation.',
    );
  }
  return attestation;
}

function addFinding(findings, input) {
  const key = `${input.category}:${input.id ?? ''}`;
  const existing = findings.get(key) ?? {
    category: input.category,
    id: input.id ?? null,
    occurrences: 0,
    paths: new Set(),
    commits: new Set(),
  };
  existing.occurrences += input.occurrences ?? 1;
  if (input.path) existing.paths.add(normalizePath(input.path));
  if (input.commit) existing.commits.add(input.commit);
  findings.set(key, existing);
}

function scanText(input) {
  const { text, path, commit, policy, findings } = input;
  for (const { category, expression } of credentialPatterns) {
    expression.lastIndex = 0;
    const matches = [...text.matchAll(expression)];
    if (matches.length > 0 && !allowed(policy, category, path)) {
      addFinding(findings, { category, path, commit, occurrences: matches.length });
    }
  }

  if (publicDocument(path)) {
    publicDocumentPathPattern.lastIndex = 0;
    const matches = [...text.matchAll(publicDocumentPathPattern)];
    if (matches.length > 0) {
      addFinding(findings, {
        category: 'concrete_absolute_path_in_public_document',
        path,
        commit,
        occurrences: matches.length,
      });
    }
  }

  const fingerprints = new Map(
    policy.sensitiveTextFingerprints.map((entry) => [`${entry.length}:${entry.sha256}`, entry]),
  );
  tokenPattern.lastIndex = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const fingerprint = fingerprints.get(`${token.length}:${sha256(token)}`);
    if (fingerprint) {
      addFinding(findings, {
        category: 'private_material_fingerprint',
        id: fingerprint.id,
        path,
        commit,
      });
    }
  }
}

function summarizeFindings(findings, includeLocations) {
  return [...findings.values()]
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        String(left.id).localeCompare(String(right.id)),
    )
    .map((entry) => ({
      category: entry.category,
      id: entry.id,
      occurrences: entry.occurrences,
      pathCount: entry.paths.size,
      commitCount: entry.commits.size,
      ...(includeLocations ? { paths: [...entry.paths].sort() } : {}),
    }));
}

async function gitOutput(args) {
  const { stdout } = await execFile(
    git,
    ['-c', `safe.directory=${repositoryRoot.replaceAll('\\', '/')}`, ...args],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    },
  );
  return stdout;
}

async function currentPaths() {
  return (await gitOutput(['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
    .split('\0')
    .map(normalizePath)
    .filter(Boolean);
}

async function packagePaths() {
  const cache = resolve(repositoryRoot, '.tmp/public-release-npm-cache');
  const { stdout } = await execFile(
    process.execPath,
    [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cache],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !Array.isArray(parsed[0].files)) {
    throw new Error('npm pack returned an unexpected candidate manifest.');
  }
  return parsed[0].files.map(({ path }) => normalizePath(path)).sort();
}

async function scanPaths(paths, policy, root = repositoryRoot) {
  const findings = new Map();
  let candidateFiles = 0;
  let scannedTextFiles = 0;
  let skippedBinaryFiles = 0;

  for (const path of [...new Set(paths)].sort()) {
    let bytes;
    try {
      bytes = await readFile(resolve(root, path));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    candidateFiles += 1;
    if (generatedPathPattern.test(path)) {
      addFinding(findings, { category: 'unexpected_generated_artifact', path });
    }
    if (sensitiveFilePattern.test(path)) {
      addFinding(findings, { category: 'sensitive_file_name', path });
    }
    const extension = extname(path).toLowerCase();
    if (!alwaysTextExtensions.has(extension) && bytes.includes(0)) {
      skippedBinaryFiles += 1;
      continue;
    }
    if (bytes.includes(0)) {
      skippedBinaryFiles += 1;
      continue;
    }
    scannedTextFiles += 1;
    scanText({ text: bytes.toString('utf8'), path, policy, findings });
  }

  return {
    status: findings.size === 0 ? 'pass' : 'fail',
    candidateFiles,
    scannedTextFiles,
    skippedBinaryFiles,
    findings: summarizeFindings(findings, true),
  };
}

async function stagedPaths(root) {
  const paths = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
      ({ name: left }, { name: right }) => left.localeCompare(right),
    )) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Staged public tree contains symbolic link ${normalizePath(relative(root, path))}.`,
        );
      }
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(normalizePath(relative(root, path)));
      else throw new Error(`Staged public tree contains unsupported entry ${path}.`);
    }
  }
  await visit(root);
  return paths;
}

async function auditStaged(path, policy) {
  if (!path) throw new Error('The --staged mode requires a candidate source directory.');
  const root = await realpath(resolve(repositoryRoot, path));
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || root === (await realpath(repositoryRoot))) {
    throw new Error('The staged audit requires a separate candidate source directory.');
  }
  try {
    await lstat(resolve(root, '.git'));
    throw new Error('The staged public tree must not contain .git history.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return scanPaths(await stagedPaths(root), policy, root);
}

async function auditCurrent(policy) {
  const [treePaths, releasePaths] = await Promise.all([currentPaths(), packagePaths()]);
  const [currentTree, releaseCandidate] = await Promise.all([
    scanPaths(treePaths, policy),
    scanPaths(releasePaths, policy),
  ]);
  return { currentTree, releaseCandidate };
}

async function auditHistory(policy) {
  const publicationStrategy = policy.historyPublicationStrategy;
  if (
    publicationStrategy?.status !== 'selected' ||
    publicationStrategy.strategy !== 'sanitized_new_public_repository_without_legacy_history' ||
    publicationStrategy.selectedAt !== '2026-09-10' ||
    publicationStrategy.includeLegacyHistory !== false ||
    publicationStrategy.rewriteLegacyHistory !== false
  ) {
    throw new Error(
      'Public-history policy must select a sanitized new repository without legacy history or rewriting.',
    );
  }

  const [commitCountText, patch] = await Promise.all([
    gitOutput(['rev-list', '--count', '--all']),
    gitOutput(['log', '--all', '--no-ext-diff', '--no-color', '--format=__AUDIT_COMMIT__%H', '-p']),
  ]);
  const findings = new Map();
  let commit = null;
  let oldPath = null;
  let path = null;

  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith('__AUDIT_COMMIT__')) {
      commit = line.slice('__AUDIT_COMMIT__'.length);
      oldPath = null;
      path = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      oldPath = line === '--- /dev/null' ? null : normalizePath(line.slice(6));
      continue;
    }
    if (line.startsWith('+++ ')) {
      path = line === '+++ /dev/null' ? oldPath : normalizePath(line.slice(6));
      continue;
    }
    if (!path || !commit || (!line.startsWith('+') && !line.startsWith('-'))) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    scanText({ text: line.slice(1), path, commit, policy, findings });
  }

  const summarized = summarizeFindings(findings, false);
  const findingsDetected = summarized.length > 0;
  return {
    status: findingsDetected ? 'excluded_by_selected_strategy' : 'pass',
    evidenceState: findingsDetected ? 'findings_detected' : 'no_findings',
    publicationDisposition: findingsDetected
      ? 'excluded_by_selected_strategy'
      : 'eligible_but_not_selected',
    commitCount: Number.parseInt(commitCountText.trim(), 10),
    findings: summarized,
    historyRewritePerformed: false,
    recommendedStrategy: findingsDetected
      ? 'sanitized_new_public_repository_without_legacy_history'
      : null,
    selectedStrategy: publicationStrategy.strategy,
    strategySelectedAt: publicationStrategy.selectedAt,
    legacyHistoryIncluded: publicationStrategy.includeLegacyHistory,
  };
}

async function buildReport(policy) {
  const attestation = validateOwnershipPublicationAttestation(policy);
  const [{ currentTree, releaseCandidate }, history] = await Promise.all([
    auditCurrent(policy),
    auditHistory(policy),
  ]);
  return {
    schemaVersion: '1.1.0',
    generatedAt: '2026-09-10',
    policy: {
      path: relative(repositoryRoot, policyPath).replaceAll('\\', '/'),
      sha256: sha256(await readFile(policyPath)),
      redactionBoundary:
        'Findings contain categories, stable non-secret IDs, and counts; matched values are never written.',
    },
    currentTree,
    releaseCandidate,
    history,
    ownershipAndPublication: {
      status: 'owner_attestation_recorded',
      recordedAt: attestation.recordedAt,
      projectOwnedSourceAuthorized: true,
      organizationDerivedMaterialDisposition: 'prohibited_from_public_surfaces',
      legacyHistoryIncluded: false,
      thirdPartyObligations: 'remain_applicable',
      exactExternalPublicationAuthorized: false,
    },
    publicRepositoryPlan: {
      status: 'selected_execution_deferred',
      strategy: policy.historyPublicationStrategy.strategy,
      sourceRepositoryHistoryDisposition: 'remain_private',
      legacyHistoryIncluded: false,
      externalRepositoryCreated: false,
      publicationAuthorized: false,
    },
    publicationAuthorized: false,
  };
}

function currentPassed(report) {
  return report.currentTree.status === 'pass' && report.releaseCandidate.status === 'pass';
}

function printCurrent(report) {
  process.stdout.write(
    `Current tree: ${report.currentTree.status} (${report.currentTree.candidateFiles} files); ` +
      `npm candidate: ${report.releaseCandidate.status} (${report.releaseCandidate.candidateFiles} files).\n`,
  );
  if (!currentPassed(report)) {
    for (const finding of [...report.currentTree.findings, ...report.releaseCandidate.findings]) {
      process.stderr.write(
        `Finding ${finding.category}${finding.id ? `/${finding.id}` : ''}: ` +
          `${finding.occurrences} occurrence(s) in ${finding.pathCount} path(s).\n`,
      );
    }
  }
}

function printHistory(history) {
  process.stdout.write(
    `Git history evidence: ${history.evidenceState}; publication disposition: ` +
      `${history.publicationDisposition} (${history.commitCount} commits, ` +
      `${history.findings.length} finding categories/IDs); rewrite performed: no.\n`,
  );
}

function historyDispositionPassed(history) {
  return history.status === 'pass' || history.status === 'excluded_by_selected_strategy';
}

const policy = JSON.parse(await readFile(policyPath, 'utf8'));
validateOwnershipPublicationAttestation(policy);
const mode = process.argv[2] ?? '--current';

if (mode === '--current') {
  const current = await auditCurrent(policy);
  const report = { ...current };
  printCurrent(report);
  if (!currentPassed(report)) process.exitCode = 1;
} else if (mode === '--history') {
  const history = await auditHistory(policy);
  printHistory(history);
  if (!historyDispositionPassed(history)) process.exitCode = 2;
} else if (mode === '--write-report') {
  let report = await buildReport(policy);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  report = await buildReport(policy);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  printCurrent(report);
  printHistory(report.history);
  process.stdout.write(`Wrote ${relative(repositoryRoot, reportPath)}.\n`);
  if (!currentPassed(report)) process.exitCode = 1;
} else if (mode === '--check-report') {
  const expected = `${JSON.stringify(await buildReport(policy), null, 2)}\n`;
  const actual = await readFile(reportPath, 'utf8');
  if (expected !== actual) {
    throw new Error(
      'Public-release audit report is stale. Run the write-report mode and review it.',
    );
  }
  const report = JSON.parse(actual);
  printCurrent(report);
  printHistory(report.history);
  if (!currentPassed(report)) process.exitCode = 1;
} else if (mode === '--staged') {
  const staged = await auditStaged(process.argv[3], policy);
  process.stdout.write(
    `Staged public tree: ${staged.status} (${staged.candidateFiles} files, no .git history).\n`,
  );
  for (const finding of staged.findings) {
    process.stderr.write(
      `Finding ${finding.category}${finding.id ? `/${finding.id}` : ''}: ` +
        `${finding.occurrences} occurrence(s) in ${finding.pathCount} path(s).\n`,
    );
  }
  if (staged.status !== 'pass') process.exitCode = 1;
} else {
  throw new Error(
    `Unknown mode ${mode}; expected --current, --history, --write-report, --check-report, or --staged <directory>.`,
  );
}
