import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compareAnalysisDocuments } from '../dist/comparison/compare.js';
import { analyzePotentialImpact } from '../dist/impact/analyze.js';
import { evaluatePolicies } from '../dist/policy/evaluate.js';
import { normalizePolicyConfiguration } from '../dist/policy/config.js';
import {
  evaluateCiArtifacts,
  renderCiEvaluationMarkdown,
  serializeCiEvaluationDocument,
  projectCiAnnotations,
  serializeCiAnnotationStream,
} from '../dist/ci-evaluation/index.js';

async function run() {
  console.log('Loading baseline and candidate analyses...');
  const baseline = JSON.parse(await readFile('.tmp/before/analysis.json', 'utf8'));
  const candidate = JSON.parse(await readFile('.tmp/after/analysis.json', 'utf8'));

  console.log('Computing diff, impact, and policies...');
  const comparison = compareAnalysisDocuments(baseline, candidate);
  const impact = analyzePotentialImpact(baseline, candidate);
  const policyResults = evaluatePolicies({
    analysis: candidate,
    baseline,
    configuration: normalizePolicyConfiguration({
      version: 1,
      rules: { 'no-new-diagnostics': 'error' },
    }),
  });

  console.log('Running Milestone P2 CI Evaluation...');
  const evaluation = evaluateCiArtifacts({
    baseline,
    candidate,
    comparison,
    impact,
    policyResults,
  });

  const outputDir = resolve('.tmp/ci-evaluation-output');
  await mkdir(outputDir, { recursive: true });

  // 1. Write Machine JSON
  await writeFile(
    resolve(outputDir, 'ci-evaluation.json'),
    serializeCiEvaluationDocument(evaluation),
    'utf8',
  );

  // 2. Write PR Markdown Summary
  await writeFile(
    resolve(outputDir, 'ci-evaluation.md'),
    renderCiEvaluationMarkdown(evaluation),
    'utf8',
  );

  // 3. Write Provider-Neutral JSONL Annotations
  const annotations = projectCiAnnotations(evaluation);
  await writeFile(
    resolve(outputDir, 'ci-annotations.jsonl'),
    serializeCiAnnotationStream(annotations),
    'utf8',
  );

  console.log('\n--- Evaluation Summary ---');
  console.log(`Outcome: ${evaluation.outcome}`);
  console.log(`Direct Endpoint Changes: ${evaluation.summary.endpointChanges}`);
  console.log(`Impacted Endpoints: ${evaluation.summary.impactedEndpoints}`);
  console.log(`Policy Violations: ${evaluation.summary.policyViolations}`);
  console.log(`Generated Annotations: ${annotations.length}`);
  console.log(`\nArtifacts written to: ${outputDir}`);
}

run().catch(console.error);
