import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { format, resolveConfig } from 'prettier';

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, '..');
const policyPath = resolve(repositoryRoot, 'packaging/release/release-integrity-policy.json');
const reportPath = resolve(
  repositoryRoot,
  'packaging/release/dependency-vulnerability-report.json',
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function dateOnly(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} must be an ISO calendar date.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || dateOnly(date) !== value) {
    throw new Error(`${label} is not a valid calendar date.`);
  }
  return date;
}

function parseArguments(arguments_) {
  let input = null;
  const flags = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const entry = arguments_[index];
    if (entry === '--input') {
      input = arguments_[index + 1];
      if (!input) throw new Error('--input requires a repository-relative JSON file.');
      index += 1;
    } else {
      flags.push(entry);
    }
  }
  const live = flags.includes('--live');
  const write = flags.includes('--write');
  const check = flags.includes('--check');
  if (flags.some((entry) => !['--live', '--write', '--check'].includes(entry))) {
    throw new Error('Usage: audit-dependencies.mjs --check | --live [--write]');
  }
  if (input && (live || write || check)) {
    throw new Error('--input is an isolated fixture-evaluation mode.');
  }
  if (input) return { live: false, write: false, input };
  if ((check && live) || (write && !live) || (!check && !live)) {
    throw new Error('Usage: audit-dependencies.mjs --check | --live [--write]');
  }
  return { live, write, input: null };
}

function validatePolicy(policy) {
  if (policy.schemaVersion !== '1.0.0') throw new Error('Unknown release-integrity policy.');
  const audit = policy.vulnerabilityAudit;
  if (audit.source !== 'pnpm_registry_audit') throw new Error('Unknown vulnerability source.');
  if (!Number.isInteger(audit.maximumReportAgeDays) || audit.maximumReportAgeDays < 1) {
    throw new Error('Vulnerability report age must be a positive integer.');
  }
  if (JSON.stringify([...audit.blockingSeverities].sort()) !== '["critical","high"]') {
    throw new Error('High and critical findings must be the blocking severities.');
  }
}

function validateExceptions(document, policy, today) {
  if (document.schemaVersion !== '1.0.0' || !Array.isArray(document.exceptions)) {
    throw new Error('Invalid vulnerability-exception document.');
  }
  const keys = new Set();
  for (const [index, exception] of document.exceptions.entries()) {
    for (const field of policy.vulnerabilityAudit.requiredExceptionFields) {
      const value = exception[field];
      if (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0)
      ) {
        throw new Error(`Vulnerability exception ${index} is missing ${field}.`);
      }
    }
    if (!policy.vulnerabilityAudit.blockingSeverities.includes(exception.severity)) {
      throw new Error(`Vulnerability exception ${index} has a non-blocking severity.`);
    }
    if (
      !Array.isArray(exception.affectedSurfaces) ||
      !Array.isArray(exception.compensatingControls)
    ) {
      throw new Error(
        `Vulnerability exception ${index} must use array-valued controls and surfaces.`,
      );
    }
    if (
      [...exception.affectedSurfaces, ...exception.compensatingControls].some(
        (entry) => typeof entry !== 'string' || entry.trim() === '',
      )
    ) {
      throw new Error(`Vulnerability exception ${index} contains an empty control or surface.`);
    }
    const reviewed = parseDate(exception.reviewedOn, `Exception ${index} reviewedOn`);
    const expiry = parseDate(exception.expiresOn, `Exception ${index} expiresOn`);
    if (expiry < reviewed)
      throw new Error(`Vulnerability exception ${index} expires before review.`);
    if (expiry < parseDate(today, 'Audit date')) {
      throw new Error(`Vulnerability exception ${index} expired on ${exception.expiresOn}.`);
    }
    const key = `${exception.advisoryId}\0${exception.package}`;
    if (keys.has(key)) throw new Error(`Duplicate vulnerability exception for ${key}.`);
    keys.add(key);
  }
  return new Map(
    document.exceptions.map((entry) => [`${entry.advisoryId}\0${entry.package}`, entry]),
  );
}

function normalizeSeverity(value) {
  const severity = String(value ?? 'unknown').toLowerCase();
  if (!['info', 'low', 'moderate', 'high', 'critical'].includes(severity)) {
    throw new Error(`Unknown advisory severity ${severity}.`);
  }
  return severity;
}

export function normalizePnpmAudit(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('pnpm audit did not return an object.');
  }
  const advisoryValues = Object.values(raw.advisories ?? {});
  const advisories = advisoryValues
    .map((entry) => {
      const findings = Array.isArray(entry.findings) ? entry.findings : [];
      const versions = [
        ...new Set(findings.map(({ version }) => String(version)).filter(Boolean)),
      ].sort();
      const developmentOnly = findings.length > 0 && findings.every(({ dev }) => dev === true);
      return {
        advisoryId: String(entry.github_advisory_id ?? entry.id),
        registryId: String(entry.id),
        package: String(entry.module_name),
        severity: normalizeSeverity(entry.severity),
        title: String(entry.title),
        vulnerableVersions: String(entry.vulnerable_versions),
        patchedVersions: String(entry.patched_versions),
        affectedVersions: versions,
        scope: developmentOnly ? 'development' : 'production_or_mixed',
        url: String(entry.url),
      };
    })
    .sort(
      (left, right) =>
        left.advisoryId.localeCompare(right.advisoryId) ||
        left.package.localeCompare(right.package),
    );
  const counts = raw.metadata?.vulnerabilities;
  if (counts === null || typeof counts !== 'object') {
    throw new Error('pnpm audit response has no vulnerability summary.');
  }
  return {
    advisories,
    registrySummary: Object.fromEntries(
      ['info', 'low', 'moderate', 'high', 'critical'].map((severity) => [
        severity,
        Number(counts[severity] ?? 0),
      ]),
    ),
    dependencyCounts: {
      production: Number(raw.metadata?.dependencies ?? 0),
      development: Number(raw.metadata?.devDependencies ?? 0),
      optional: Number(raw.metadata?.optionalDependencies ?? 0),
      total: Number(raw.metadata?.totalDependencies ?? 0),
    },
  };
}

export function evaluateAdvisories(normalized, exceptions, policy) {
  const blocking = new Set(policy.vulnerabilityAudit.blockingSeverities);
  const records = normalized.advisories.map((advisory) => {
    const exception = exceptions.get(`${advisory.advisoryId}\0${advisory.package}`);
    if (exception && exception.severity !== advisory.severity) {
      throw new Error(
        `Exception severity ${exception.severity} does not match ${advisory.advisoryId} severity ${advisory.severity}.`,
      );
    }
    return {
      ...advisory,
      disposition: blocking.has(advisory.severity)
        ? exception
          ? 'accepted_exception'
          : 'unreviewed_blocker'
        : 'reported_non_blocking',
      exceptionExpiresOn: exception?.expiresOn ?? null,
    };
  });
  const highCriticalTotal = records.filter(({ severity }) => blocking.has(severity)).length;
  const unreviewedHighCritical = records.filter(
    ({ disposition }) => disposition === 'unreviewed_blocker',
  ).length;
  return { records, highCriticalTotal, unreviewedHighCritical };
}

async function auditWithPnpm() {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) {
    throw new Error('Live audit must be invoked through `pnpm run audit:dependencies:live`.');
  }
  try {
    const { stdout } = await execFile(pnpmCli, ['audit', '--json'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (typeof error?.stdout === 'string' && error.stdout.trim().startsWith('{')) {
      return JSON.parse(error.stdout);
    }
    throw error;
  }
}

async function buildReport(raw, policy, policyBytes, exceptionDocument, exceptionBytes, today) {
  const normalized = normalizePnpmAudit(raw);
  const exceptions = validateExceptions(exceptionDocument, policy, today);
  const evaluated = evaluateAdvisories(normalized, exceptions, policy);
  const packageManifest = await readJson(resolve(repositoryRoot, 'package.json'));
  const lockfileBytes = await readFile(resolve(repositoryRoot, policy.vulnerabilityAudit.lockfile));
  return {
    schemaVersion: '1.0.0',
    package: { name: packageManifest.name, version: packageManifest.version },
    source: policy.vulnerabilityAudit.source,
    reviewedOn: today,
    expiresOn: addDays(today, policy.vulnerabilityAudit.maximumReportAgeDays),
    inputs: {
      lockfile: policy.vulnerabilityAudit.lockfile,
      lockfileSha256: sha256(lockfileBytes),
      policySha256: sha256(policyBytes),
      exceptionsSha256: sha256(exceptionBytes),
      packageManager: packageManifest.packageManager,
    },
    policy: {
      blockingSeverities: policy.vulnerabilityAudit.blockingSeverities,
      maximumReportAgeDays: policy.vulnerabilityAudit.maximumReportAgeDays,
    },
    summary: {
      ...normalized.registrySummary,
      highCriticalTotal: evaluated.highCriticalTotal,
      acceptedExceptions: evaluated.records.filter(
        ({ disposition }) => disposition === 'accepted_exception',
      ).length,
      unreviewedHighCritical: evaluated.unreviewedHighCritical,
      status: evaluated.unreviewedHighCritical === 0 ? 'pass' : 'fail',
    },
    dependencyCounts: normalized.dependencyCounts,
    advisories: evaluated.records,
  };
}

async function validateRetained(report, policy, policyBytes, exceptionBytes, today) {
  if (report.schemaVersion !== '1.0.0') throw new Error('Unknown vulnerability report.');
  parseDate(report.reviewedOn, 'Vulnerability report reviewedOn');
  const expiry = parseDate(report.expiresOn, 'Vulnerability report expiresOn');
  if (expiry < parseDate(today, 'Current date')) {
    throw new Error(
      `Vulnerability report expired on ${report.expiresOn}; run pnpm run audit:dependencies:write.`,
    );
  }
  const lockfile = await readFile(resolve(repositoryRoot, policy.vulnerabilityAudit.lockfile));
  if (report.inputs?.lockfileSha256 !== sha256(lockfile)) {
    throw new Error('Vulnerability report is stale for pnpm-lock.yaml.');
  }
  if (report.inputs?.policySha256 !== sha256(policyBytes)) {
    throw new Error('Vulnerability report is stale for the release-integrity policy.');
  }
  if (report.inputs?.exceptionsSha256 !== sha256(exceptionBytes)) {
    throw new Error('Vulnerability report is stale for the exception ledger.');
  }
  if (report.summary?.unreviewedHighCritical !== 0 || report.summary?.status !== 'pass') {
    throw new Error('Unreviewed high/critical dependency vulnerabilities block release integrity.');
  }
}

async function serialize(value, path) {
  const prettierConfig = (await resolveConfig(path)) ?? {};
  return format(JSON.stringify(value), { ...prettierConfig, filepath: path });
}

async function main() {
  const mode = parseArguments(process.argv.slice(2));
  const today = dateOnly();
  const [policyBytes, exceptionBytes] = await Promise.all([
    readFile(policyPath),
    readFile(resolve(repositoryRoot, 'packaging/release/vulnerability-exceptions.json')),
  ]);
  const policy = JSON.parse(policyBytes.toString('utf8'));
  const exceptionDocument = JSON.parse(exceptionBytes.toString('utf8'));
  validatePolicy(policy);
  validateExceptions(exceptionDocument, policy, today);

  if (mode.input) {
    const absoluteInput = resolve(repositoryRoot, mode.input);
    const relativeInput = relative(repositoryRoot, absoluteInput);
    if (relativeInput === '' || relativeInput.startsWith('..')) {
      throw new Error('--input must remain inside the repository.');
    }
    const generated = await buildReport(
      await readJson(absoluteInput),
      policy,
      policyBytes,
      exceptionDocument,
      exceptionBytes,
      today,
    );
    if (generated.summary.unreviewedHighCritical !== 0) {
      const blockers = generated.advisories
        .filter(({ disposition }) => disposition === 'unreviewed_blocker')
        .map(({ advisoryId, package: name, severity }) => `${advisoryId}:${name}:${severity}`);
      throw new Error(`Unreviewed dependency vulnerabilities: ${blockers.join(', ')}.`);
    }
    process.stdout.write(
      'Dependency audit fixture contains no unreviewed high/critical findings.\n',
    );
    return;
  }

  if (!mode.live) {
    const report = await readJson(reportPath);
    await validateRetained(report, policy, policyBytes, exceptionBytes, today);
    process.stdout.write(
      `Dependency vulnerability report passes: ${report.summary.unreviewedHighCritical} unreviewed high/critical findings; valid through ${report.expiresOn}.\n`,
    );
    return;
  }

  const generated = await buildReport(
    await auditWithPnpm(),
    policy,
    policyBytes,
    exceptionDocument,
    exceptionBytes,
    today,
  );
  if (generated.summary.unreviewedHighCritical !== 0) {
    const blockers = generated.advisories
      .filter(({ disposition }) => disposition === 'unreviewed_blocker')
      .map(({ advisoryId, package: name, severity }) => `${advisoryId}:${name}:${severity}`);
    throw new Error(`Unreviewed dependency vulnerabilities: ${blockers.join(', ')}.`);
  }
  const serialized = await serialize(generated, reportPath);
  if (mode.write) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, serialized, 'utf8');
    process.stdout.write(`Wrote ${relative(repositoryRoot, reportPath)}.\n`);
    return;
  }
  const retained = await readJson(reportPath);
  await validateRetained(retained, policy, policyBytes, exceptionBytes, today);
  const retainedProjection = JSON.stringify({
    dependencyCounts: retained.dependencyCounts,
    advisories: retained.advisories,
  });
  const generatedProjection = JSON.stringify({
    dependencyCounts: generated.dependencyCounts,
    advisories: generated.advisories,
  });
  if (retainedProjection !== generatedProjection) {
    throw new Error(
      'Live advisory result differs from the reviewed report; refresh and review it.',
    );
  }
  process.stdout.write('Live dependency advisory result matches the reviewed report.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
