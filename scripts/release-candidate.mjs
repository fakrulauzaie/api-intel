import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';

const repositoryRoot = resolve(import.meta.dirname, '..');
const policyPath = resolve(repositoryRoot, 'packaging/release/release-integrity-policy.json');
const publicInputsPath = resolve(repositoryRoot, 'packaging/release/public-release-inputs.json');
const publicChecksumsPath = resolve(repositoryRoot, 'packaging/release/PUBLIC_SHA256SUMS');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function parseMode(arguments_) {
  if (
    arguments_.length !== 1 ||
    !['--check', '--write', '--check-public', '--write-public'].includes(arguments_[0])
  ) {
    throw new Error('Usage: release-candidate.mjs --check|--write|--check-public|--write-public');
  }
  return arguments_[0];
}

function normalize(path) {
  return path.replaceAll('\\', '/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function packagePurl(name, version) {
  const path = name.startsWith('@')
    ? name
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')
    : encodeURIComponent(name);
  return `pkg:npm/${path}@${encodeURIComponent(version)}`;
}

function sbomFor(manifest, inventory, lockfileSha256) {
  const components = inventory.packages.map((entry) => ({
    type: 'library',
    'bom-ref': packagePurl(entry.name, entry.version),
    name: entry.name,
    version: entry.version,
    purl: packagePurl(entry.name, entry.version),
    licenses: [{ license: { id: entry.declaredLicense } }],
    properties: [
      { name: 'api-intel:dependency-scope', value: entry.scope },
      { name: 'api-intel:direct-dependency', value: String(entry.direct) },
    ],
  }));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      tools: {
        components: [
          {
            type: 'application',
            name: 'api-intel-release-candidate',
            version: manifest.version,
          },
        ],
      },
      component: {
        type: 'application',
        'bom-ref': packagePurl(manifest.name, manifest.version),
        group: manifest.name.startsWith('@') ? manifest.name.split('/')[0] : undefined,
        name: manifest.name.includes('/') ? manifest.name.split('/').at(-1) : manifest.name,
        version: manifest.version,
        purl: packagePurl(manifest.name, manifest.version),
        licenses: [{ license: { id: manifest.license } }],
      },
      properties: [
        { name: 'api-intel:lockfile', value: 'pnpm-lock.yaml' },
        { name: 'api-intel:lockfile-sha256', value: lockfileSha256 },
        {
          name: 'api-intel:scope',
          value: 'source, build, and package-manager runtime dependencies; no OCI base/OS packages',
        },
      ],
    },
    components,
  };
}

async function formattedJson(value, path) {
  const prettierConfig = (await resolveConfig(path)) ?? {};
  return format(JSON.stringify(value), { ...prettierConfig, filepath: path });
}

async function assertOrWrite(path, generated, mode, staleMessage) {
  if (mode === '--write') {
    await writeFile(path, generated, 'utf8');
    return;
  }
  const retained = await readFile(path, 'utf8');
  if (retained !== generated) throw new Error(staleMessage);
}

async function fileRecord(path, publicManifestBytes) {
  const bytes =
    path === 'package.json' && publicManifestBytes !== undefined
      ? publicManifestBytes
      : await readFile(resolve(repositoryRoot, path));
  return { path: normalize(path), bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function validateVersions({
  manifest,
  distribution,
  packageContents,
  inventory,
  vulnerability,
  changelog,
}) {
  const versions = new Map([
    ['package.json', manifest.version],
    ['packaging/npm/distribution-contract.json', distribution.packageVersion],
    ['packaging/npm/package-contents.json', packageContents.package.version],
    ['docs/legal/dependency-license-inventory.json', inventory.project.version],
    ['packaging/release/dependency-vulnerability-report.json', vulnerability.package.version],
  ]);
  const mismatches = [...versions].filter(([, version]) => version !== manifest.version);
  if (mismatches.length > 0) {
    throw new Error(
      `Package-version drift: ${mismatches.map(([path, version]) => `${path}=${version}`).join(', ')}.`,
    );
  }
  if (!new RegExp(`^## ${escapeRegExp(manifest.version)}(?:\\s|$)`, 'mu').test(changelog)) {
    throw new Error(`CHANGELOG.md has no release heading for ${manifest.version}.`);
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const [
    policy,
    manifest,
    distribution,
    packageContents,
    inventory,
    vulnerability,
    changelog,
    lockfile,
  ] = await Promise.all([
    readJson(policyPath),
    readJson(resolve(repositoryRoot, 'package.json')),
    readJson(resolve(repositoryRoot, 'packaging/npm/distribution-contract.json')),
    readJson(resolve(repositoryRoot, 'packaging/npm/package-contents.json')),
    readJson(resolve(repositoryRoot, 'docs/legal/dependency-license-inventory.json')),
    readJson(resolve(repositoryRoot, 'packaging/release/dependency-vulnerability-report.json')),
    readFile(resolve(repositoryRoot, 'CHANGELOG.md'), 'utf8'),
    readFile(resolve(repositoryRoot, 'pnpm-lock.yaml')),
  ]);
  if (policy.schemaVersion !== '1.0.0') throw new Error('Unknown release-integrity policy.');
  if (manifest.name !== policy.package) throw new Error('Release policy package identity drifted.');
  const explicitPublic = mode === '--check-public' || mode === '--write-public';
  const stagedPublicCandidate =
    process.env.API_INTEL_PUBLIC_CANDIDATE === '1' || !Object.hasOwn(manifest, 'private');
  const publicRelease = explicitPublic || stagedPublicCandidate;
  if (stagedPublicCandidate) {
    if (Object.hasOwn(manifest, 'private')) {
      throw new Error('The staged public candidate must omit the private manifest property.');
    }
  } else if (manifest.private !== policy.sourceManifestMustRemainPrivateBeforeO5) {
    throw new Error('The private source-manifest publication guard drifted.');
  }
  const releaseManifest = { ...manifest };
  if (publicRelease) delete releaseManifest.private;
  const publicManifestBytes = publicRelease
    ? Buffer.from(`${JSON.stringify(releaseManifest, null, 2)}\n`)
    : undefined;
  const writeMode = mode === '--write' || mode === '--write-public';
  if (
    vulnerability.summary?.status !== 'pass' ||
    vulnerability.summary.unreviewedHighCritical !== 0
  ) {
    throw new Error('The retained dependency vulnerability decision does not pass.');
  }
  validateVersions({
    manifest,
    distribution,
    packageContents,
    inventory,
    vulnerability,
    changelog,
  });

  const sbomPath = resolve(repositoryRoot, policy.releaseEvidence.sbom);
  const sbom = sbomFor(releaseManifest, inventory, sha256(lockfile));
  const sbomText = await formattedJson(sbom, sbomPath);
  await assertOrWrite(
    sbomPath,
    sbomText,
    writeMode ? '--write' : '--check',
    'Source dependency SBOM is stale; run pnpm run release:integrity:write.',
  );

  const evidencePaths = [
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'CHANGELOG.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'docs/legal/dependency-license-inventory.json',
    'docs/legal/redistribution-audit.md',
    'packaging/npm/distribution-contract.json',
    'packaging/npm/package-contents.json',
    'packaging/npm/public-package-contents.json',
    'packaging/npm/runtime-contract.json',
    'packaging/npm/clean-room-contract.json',
    'packaging/npm/clean-room-install-report.json',
    'packaging/release/provider-artifact-contract.json',
    'packaging/release/reproducible-artifacts.json',
    'packaging/release/release-integrity-policy.json',
    'packaging/release/public-alpha-candidate-contract.json',
    'packaging/release/vulnerability-exceptions.json',
    'packaging/release/dependency-vulnerability-report.json',
    policy.releaseEvidence.sbom,
    'scripts/audit-dependencies.mjs',
    'scripts/audit-public-release.mjs',
    'scripts/audit-third-party-licenses.mjs',
    'scripts/package-manager-cli.mjs',
    'scripts/verify-npm-package.mjs',
    'scripts/verify-package-install.mjs',
    'scripts/verify-package-runtime.mjs',
    'scripts/verify-provider-artifacts.mjs',
    'scripts/release-candidate.mjs',
    'scripts/release-dry-run.mjs',
    'scripts/stage-public-alpha-candidate.mjs',
    'docs/alpha-release-candidate.md',
    'docs/releases/0.1.0-alpha.1.md',
    'eslint.config.mjs',
    'vitest.config.ts',
    'tsconfig.json',
    'tsconfig.build.json',
    'action.yml',
    'templates/api-intel/template.yml',
    'packaging/gitlab/Dockerfile',
    '.github/workflows/ci.yml',
  ];
  const evidence = await Promise.all(
    evidencePaths.map((path) => fileRecord(path, publicManifestBytes)),
  );
  const providerArtifacts = await readJson(
    resolve(repositoryRoot, policy.releaseEvidence.providerArtifacts),
  );
  const inputs = {
    schemaVersion: '1.0.0',
    package: {
      name: releaseManifest.name,
      version: releaseManifest.version,
      private: releaseManifest.private,
    },
    source: {
      revisionResolution: 'release_dry_run_runtime',
      treeFingerprintResolution: 'release_dry_run_runtime',
      cleanTreeRequiredForPublication: true,
      expectedTag: `${policy.versioning.tagPrefix}${releaseManifest.version}`,
    },
    toolchain: {
      declaredNodeRange: releaseManifest.engines.node,
      sourceCiNodeVersions: ['22.13.1', '24.20.0'],
      packageManager: releaseManifest.packageManager,
      npmCli: '10.9.2',
      ncc: releaseManifest.devDependencies['@vercel/ncc'],
      typescript: releaseManifest.dependencies.typescript,
    },
    evidence,
    providerFingerprints: Object.fromEntries(
      Object.entries(providerArtifacts.providers).map(([name, provider]) => [
        name,
        provider.fingerprint,
      ]),
    ),
    npmArchive: packageContents.archive,
    qualification: {
      sbomScope: policy.releaseEvidence.sbomScope,
      ociBaseAndOsPackagesIncluded: policy.releaseEvidence.ociBaseAndOsPackagesIncluded,
      externalPublicationAuthorizedByThisDocument: false,
    },
  };
  const inputsRelativePath = publicRelease
    ? 'packaging/release/public-release-inputs.json'
    : policy.releaseEvidence.inputs;
  const inputsPath = publicRelease ? publicInputsPath : resolve(repositoryRoot, inputsRelativePath);
  const inputsText = await formattedJson(inputs, inputsPath);
  await assertOrWrite(
    inputsPath,
    inputsText,
    writeMode ? '--write' : '--check',
    publicRelease
      ? 'Public release input manifest is stale; run pnpm run release:public-integrity:write.'
      : 'Release input manifest is stale; run pnpm run release:integrity:write.',
  );

  const checksumPaths = [...new Set([...evidencePaths, inputsRelativePath])].sort();
  const checksumRecords = await Promise.all(
    checksumPaths.map((path) => fileRecord(path, publicManifestBytes)),
  );
  const checksumText = `${checksumRecords
    .map(({ path, sha256: digest }) => `${digest}  ${path}`)
    .join('\n')}\n`;
  const checksumPath = publicRelease
    ? publicChecksumsPath
    : resolve(repositoryRoot, policy.releaseEvidence.checksums);
  await assertOrWrite(
    checksumPath,
    checksumText,
    writeMode ? '--write' : '--check',
    publicRelease
      ? 'Public release checksums are stale; run pnpm run release:public-integrity:write.'
      : 'Release checksums are stale; run pnpm run release:integrity:write.',
  );

  process.stdout.write(
    writeMode
      ? 'Wrote deterministic SBOM, release inputs, and SHA-256 ledger.\n'
      : `Release integrity evidence verified: ${checksumRecords.length} content-addressed inputs.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
