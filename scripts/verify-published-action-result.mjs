import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const workspace = await realpath(process.env.GITHUB_WORKSPACE ?? repositoryRoot);
const artifactPath = process.env.API_INTEL_ACTION_ARTIFACT_PATH;
if (!artifactPath) throw new Error('API_INTEL_ACTION_ARTIFACT_PATH is required.');
const artifactRoot = await realpath(artifactPath);
const artifactRelative = relative(workspace, artifactRoot);
if (artifactRelative === '' || artifactRelative.startsWith('..') || isAbsolute(artifactRelative)) {
  throw new Error('The published Action artifact escaped GITHUB_WORKSPACE.');
}

const contract = JSON.parse(
  await readFile(
    resolve(repositoryRoot, 'packaging/release/published-alpha-contract.json'),
    'utf8',
  ),
);
const expected = JSON.parse(
  await readFile(
    resolve(repositoryRoot, 'test/fixtures/github-action/controlled/expected.json'),
    'utf8',
  ),
);
const [manifest, recipe, evaluation, summary, graph] = await Promise.all([
  readJson('manifest.json'),
  readJson('ci-scan-recipe.json'),
  readJson('ci-evaluation.json'),
  readFile(resolve(artifactRoot, 'github-summary.md'), 'utf8'),
  readFile(resolve(artifactRoot, 'api-intel-graph.html')),
]);
if (recipe.engine?.distributionFingerprint !== contract.githubAction.distributionFingerprint) {
  throw new Error('The hosted Action recipe reported a different distribution fingerprint.');
}
if (evaluation.outcome !== expected.outcome || !summary.includes(expected.addedEndpoint)) {
  throw new Error('The hosted Action result did not satisfy the frozen semantic expectation.');
}
const manifestPaths = manifest.files.map(({ path }) => path).sort();
for (const required of expected.requiredArtifacts.filter((path) => path !== 'manifest.json')) {
  if (!manifestPaths.includes(required)) {
    throw new Error(`The hosted Action manifest omits ${required}.`);
  }
}
for (const entry of manifest.files) {
  const bytes = await readFile(resolve(artifactRoot, entry.path));
  const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (bytes.byteLength !== entry.bytes || contentHash !== entry.contentHash) {
    throw new Error(`The hosted Action artifact drifted for ${entry.path}.`);
  }
}
const graphText = graph.toString('utf8');
if (
  !graphText.includes('<meta name="api-intel-graph-schema"') ||
  /<(?:script|link)\b[^>]+(?:src|href)=["']https?:/iu.test(graphText)
) {
  throw new Error('The hosted Action graph is not the expected self-contained artifact.');
}
process.stdout.write(
  `Published Action verified: ${expected.addedEndpoint}; ` +
    `${manifest.files.length + 1} files; ${contract.githubAction.distributionFingerprint}.\n`,
);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(artifactRoot, path), 'utf8'));
}
