import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const contractPath = resolve(repositoryRoot, 'packaging/release/published-alpha-contract.json');
const verifierPath = resolve(repositoryRoot, 'scripts/verify-package-install.mjs');

function parseArguments() {
  const arguments_ = process.argv.slice(2);
  let resultFile = `.tmp/published-release-verification/${process.platform}-node-${process.versions.node}.json`;
  while (arguments_.length > 0) {
    const name = arguments_.shift();
    const value = arguments_.shift();
    if (name !== '--result-file' || value === undefined || value.startsWith('--')) {
      throw new Error(
        'Usage: node scripts/verify-published-release.mjs [--result-file <repository-relative-path>]',
      );
    }
    resultFile = value;
  }
  const resolved = resolve(repositoryRoot, resultFile);
  const relativeResult = relative(repositoryRoot, resolved);
  if (relativeResult === '' || relativeResult.startsWith('..') || isAbsolute(relativeResult)) {
    throw new Error('--result-file must remain beneath the repository root.');
  }
  return { resultFile: relativeResult.replaceAll('\\', '/'), resolvedResultFile: resolved };
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json, application/json',
      'User-Agent': 'api-intel-published-release-verifier',
      ...headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Published metadata request failed with HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} drifted: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

async function verifyNpmMetadata(contract) {
  const escapedName = contract.npm.packageName.replace('/', '%2f');
  const document = await fetchJson(`${contract.npm.registry}${escapedName}`);
  requireEqual(document['dist-tags']?.alpha, contract.npm.version, 'npm alpha dist-tag');
  if (contract.npm.bootstrapLatestRequired) {
    requireEqual(
      document['dist-tags']?.latest,
      contract.npm.version,
      'npm bootstrap latest dist-tag',
    );
  }
  const version = document.versions?.[contract.npm.version];
  if (version === undefined) throw new Error('The exact npm prerelease version is absent.');
  requireEqual(version.name, contract.npm.packageName, 'npm package name');
  requireEqual(version.version, contract.npm.version, 'npm package version');
  requireEqual(version.dist?.tarball, contract.npm.tarball, 'npm tarball URL');
  requireEqual(version.dist?.shasum, contract.npm.shasum, 'npm tarball SHA-1');
  requireEqual(version.dist?.integrity, contract.npm.integrity, 'npm tarball integrity');
  requireEqual(version.license, 'Apache-2.0', 'npm package license');
  requireEqual(
    version.repository?.url,
    'git+https://github.com/fakrulauzaie/api-intel.git',
    'npm repository URL',
  );
  requireEqual(
    version.homepage,
    'https://github.com/fakrulauzaie/api-intel#readme',
    'npm homepage',
  );
  requireEqual(
    version.bugs?.url,
    'https://github.com/fakrulauzaie/api-intel/issues',
    'npm issue URL',
  );
  requireEqual(version.engines?.node, '>=22.13 <25', 'npm Node.js engine range');
  return {
    packageSpec: contract.npm.packageSpec,
    alpha: document['dist-tags'].alpha,
    latest: document['dist-tags'].latest,
    tarball: version.dist.tarball,
    shasum: version.dist.shasum,
    integrity: version.dist.integrity,
  };
}

async function verifyGitHubMetadata(contract) {
  const repository = new URL(contract.source.repository);
  const [owner, name] = repository.pathname.split('/').filter(Boolean);
  const apiRoot = `https://api.github.com/repos/${owner}/${name}`;
  const authorization = process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {};
  const [reference, release, repositoryMetadata, securityFile, conductFile] = await Promise.all([
    fetchJson(`${apiRoot}/git/ref/tags/${encodeURIComponent(contract.source.tag)}`, authorization),
    fetchJson(`${apiRoot}/releases/tags/${encodeURIComponent(contract.source.tag)}`, authorization),
    fetchJson(apiRoot, authorization),
    fetchJson(
      `${apiRoot}/contents/SECURITY.md?ref=${encodeURIComponent(contract.source.commit)}`,
      authorization,
    ),
    fetchJson(
      `${apiRoot}/contents/CODE_OF_CONDUCT.md?ref=${encodeURIComponent(contract.source.commit)}`,
      authorization,
    ),
  ]);
  let target = reference.object;
  if (target?.type === 'tag') {
    const annotated = await fetchJson(target.url, authorization);
    target = annotated.object;
  }
  requireEqual(target?.type, 'commit', 'GitHub tag target type');
  requireEqual(target?.sha, contract.source.commit, 'GitHub tag target');
  requireEqual(release.draft, false, 'GitHub release draft state');
  requireEqual(release.prerelease, true, 'GitHub release prerelease state');
  requireEqual(release.tag_name, contract.source.tag, 'GitHub release tag');
  requireEqual(repositoryMetadata.private, false, 'GitHub repository visibility');
  requireEqual(repositoryMetadata.has_issues, true, 'GitHub Issues availability');
  const security = Buffer.from(securityFile.content, 'base64').toString('utf8');
  const conduct = Buffer.from(conductFile.content, 'base64').toString('utf8');
  if (!security.includes('GitHub Private Vulnerability Reporting')) {
    throw new Error('The immutable SECURITY.md omits Private Vulnerability Reporting.');
  }
  if (!conduct.includes('fakrulauzaie@gmail.com')) {
    throw new Error('The immutable conduct policy omits the private reporting address.');
  }
  const expectedAssets = [
    'LICENSE',
    'PUBLIC_SHA256SUMS',
    'THIRD_PARTY_NOTICES.md',
    'compatibility-and-support.md',
    'current-limitations.md',
    'fakrulauzaie-api-intel-0.1.0-alpha.1.tgz',
    'public-release-inputs.json',
    'release-candidate-manifest.json',
    'source-dependencies.cdx.json',
  ].sort();
  const actualAssets = release.assets.map(({ name: assetName }) => assetName).sort();
  requireEqual(
    JSON.stringify(actualAssets),
    JSON.stringify(expectedAssets),
    'GitHub release assets',
  );
  const npmAsset = release.assets.find(
    ({ name: assetName }) => assetName === 'fakrulauzaie-api-intel-0.1.0-alpha.1.tgz',
  );
  requireEqual(npmAsset?.digest, `sha256:${contract.npm.sha256}`, 'GitHub npm asset digest');
  return {
    repository: contract.source.repository,
    public: true,
    issuesEnabled: true,
    tag: contract.source.tag,
    commit: target.sha,
    release: release.html_url,
    prerelease: release.prerelease,
    assetCount: actualAssets.length,
    npmAssetDigest: npmAsset.digest,
    securityPolicyPublished: true,
    privateConductRoutePublished: true,
  };
}

async function runCleanRoomVerifier(contract, resultFile) {
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.GITHUB_TOKEN;
  const child = spawn(
    process.execPath,
    [
      verifierPath,
      '--smoke',
      '--package-spec',
      contract.npm.packageSpec,
      '--package-contents',
      contract.npm.inventory,
      '--expected-sha256',
      contract.npm.sha256,
      '--result-file',
      resultFile,
    ],
    {
      cwd: repositoryRoot,
      env: cleanEnvironment,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('close', (code) => resolveExit(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`Published package clean-room verifier exited ${exitCode}.`);
}

async function main() {
  const options = parseArguments();
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  const [npmMetadata, githubMetadata] = await Promise.all([
    verifyNpmMetadata(contract),
    verifyGitHubMetadata(contract),
  ]);
  await runCleanRoomVerifier(contract, options.resultFile);
  const report = JSON.parse(await readFile(options.resolvedResultFile, 'utf8'));
  report.publication = {
    verifiedAt: contract.verifiedAt,
    npm: npmMetadata,
    github: githubMetadata,
    githubAction: contract.githubAction,
    publishedSurfaces: contract.publishedSurfaces,
  };
  await writeFile(options.resolvedResultFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `Published release verified: ${contract.npm.packageSpec}; ` +
      `${githubMetadata.assetCount} GitHub assets; report ${options.resultFile}.\n`,
  );
}

await main();
