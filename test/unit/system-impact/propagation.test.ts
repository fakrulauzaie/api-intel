import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../../src/analysis/scan-repository.js';
import {
  buildSystemReportDocument,
  renderOfflineSystemImpactReport,
} from '../../../src/system-report/index.js';
import {
  compareSystemAnalyses,
  propagateConditionalSystemImpact,
  serializeCanonicalSystemImpact,
  SystemImpactPropagationError,
  validateSystemImpactDocument,
} from '../../../src/system-impact/index.js';
import {
  assertValidSystemTopologyManifest,
  stitchSystemAnalyses,
  type SystemTopologyManifest,
} from '../../../src/system-analysis/index.js';
import {
  writeFakeNestCommon,
  writeFakeNestCore,
  writeFakeNestMicroservices,
  writeFakeNestTypeOrm,
  writeFakeRedlock,
  writeFakeRxjs,
  writeFakeTypeOrm,
} from '../../helpers/nest-project.js';
import {
  createTestTypeScriptProject,
  writeBasicTsconfig,
  type TestTypeScriptProject,
} from '../../helpers/typescript-project.js';

async function scanSource(source: string, name: string) {
  const project = await createTestTypeScriptProject();
  await Promise.all([
    writeFakeNestCommon(project),
    writeFakeNestCore(project),
    writeFakeNestMicroservices(project),
    writeFakeNestTypeOrm(project),
    writeFakeRedlock(project),
    writeFakeRxjs(project),
    writeFakeTypeOrm(project),
  ]);
  await project.write(`src/${name}.ts`, source);
  await writeBasicTsconfig(project);
  return { project, analysis: (await scanRepository({ repositoryRoot: project.path })).analysis };
}

function services(
  api: Awaited<ReturnType<typeof scanSource>>['analysis'],
  worker: Awaited<ReturnType<typeof scanSource>>['analysis'],
) {
  return [
    { namespace: 'report-api', artifactLabel: 'report-api.json', analysis: api },
    { namespace: 'report-worker', artifactLabel: 'report-worker.json', analysis: worker },
  ] as const;
}

function comparisonInput(
  beforeSystem: ReturnType<typeof stitchSystemAnalyses>,
  afterSystem: ReturnType<typeof stitchSystemAnalyses>,
  topology: SystemTopologyManifest,
) {
  const observations = [
    { namespace: 'report-api', state: 'available' as const },
    { namespace: 'report-worker', state: 'available' as const },
  ];
  return {
    systemName: 'report-system',
    before: {
      label: 'baseline',
      document: beforeSystem,
      services: observations,
      topology: { state: 'available' as const, manifest: topology },
    },
    after: {
      label: 'current',
      document: afterSystem,
      services: observations,
      topology: { state: 'available' as const, manifest: topology },
    },
  };
}

async function fixtureSources() {
  return Promise.all([
    readFile('test/fixtures/system-report/report-api.ts.txt', 'utf8'),
    readFile('test/fixtures/system-report/report-worker.ts.txt', 'utf8'),
    readFile('test/fixtures/system-report/report-system.topology.json', 'utf8'),
  ]);
}

async function cleanup(projects: readonly TestTypeScriptProject[]): Promise<void> {
  await Promise.all(projects.map((project) => project.cleanup()));
}

describe('Phase P4.2 conditional cross-service impact', () => {
  it('propagates a local endpoint change only through declared-realm candidates to worker effects', async () => {
    const [apiSource, workerSource, topologyText] = await fixtureSources();
    const [beforeApi, afterApi, beforeWorker, afterWorker] = await Promise.all([
      scanSource(apiSource, 'api'),
      scanSource(apiSource.replace('requested: true', 'requested: false'), 'api'),
      scanSource(workerSource, 'worker'),
      scanSource(workerSource, 'worker'),
    ]);
    try {
      const topology = assertValidSystemTopologyManifest(JSON.parse(topologyText));
      const beforeServices = services(beforeApi.analysis, beforeWorker.analysis);
      const afterServices = services(afterApi.analysis, afterWorker.analysis);
      const beforeSystem = stitchSystemAnalyses({
        systemName: 'report-system',
        services: beforeServices,
        topology,
      });
      const afterSystem = stitchSystemAnalyses({
        systemName: 'report-system',
        services: afterServices,
        topology,
      });
      const comparison = compareSystemAnalyses(
        comparisonInput(beforeSystem, afterSystem, topology),
      );
      const result = propagateConditionalSystemImpact({
        comparison,
        before: { system: beforeSystem, services: beforeServices },
        after: { system: afterSystem, services: afterServices },
      });

      expect(result.schemaVersion).toBe('2.0.0');
      expect(result.propagation.classification).toBe('distributed_conditional');
      expect(result.propagation.sourceArtifacts).toHaveLength(4);
      expect(
        result.propagation.sourceArtifacts.every(({ contentFingerprint }) =>
          /^sha256:[a-f0-9]{64}$/u.test(contentFingerprint),
        ),
      ).toBe(true);
      expect(result.propagation.seeds).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'impacted_http_endpoint',
            serviceNamespace: 'report-api',
          }),
        ]),
      );
      expect(result.propagation.paths.length).toBeGreaterThanOrEqual(2);
      expect(result.propagation.paths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            effects: expect.arrayContaining([
              expect.objectContaining({
                kind: 'table',
                label: 'WRITE table report_job',
                causalClass: 'distributed_conditional',
              }),
              expect.objectContaining({
                kind: 'resource',
                technology: 'redlock',
                causalClass: 'distributed_conditional',
              }),
            ]),
          }),
        ]),
      );
      expect(result.propagation.graphOverlays).toHaveLength(2);
      expect(
        result.propagation.graphOverlays.flatMap(({ edges }) => edges).map(({ kind }) => kind),
      ).toEqual(
        expect.arrayContaining([
          'conditional_route',
          'conditional_candidate',
          'conditional_effect',
        ]),
      );
      expect(validateSystemImpactDocument(result)).toEqual({ success: true, data: result });
      const report = buildSystemReportDocument({ system: afterSystem, services: afterServices });
      const html = await renderOfflineSystemImpactReport(
        { report, impact: result, side: 'after' },
        'window.cytoscape = function () {};',
      );
      expect(html).toContain('Potential impact');
      expect(html).toContain('distributed-conditional effect');
      expect(html).toContain('Potential-impact overlay');
      expect(html).toContain("connect-src 'none'");
      expect(html).not.toMatch(/(?:src|href)\s*=\s*["']\s*(?:https?:|\/\/)/iu);

      const reordered = propagateConditionalSystemImpact({
        comparison,
        before: { system: beforeSystem, services: [...beforeServices].reverse() },
        after: { system: afterSystem, services: [...afterServices].reverse() },
      });
      expect(serializeCanonicalSystemImpact(reordered)).toBe(
        serializeCanonicalSystemImpact(result),
      );
      const scrambled = {
        ...result,
        propagation: {
          ...result.propagation,
          seeds: [...result.propagation.seeds].reverse().map((seed) => ({
            ...seed,
            evidenceIds: [...seed.evidenceIds].reverse(),
          })),
          paths: [...result.propagation.paths].reverse().map((path) => ({
            ...path,
            effects: [...path.effects].reverse(),
            diagnosticIds: [...path.diagnosticIds].reverse(),
          })),
          graphOverlays: [...result.propagation.graphOverlays].reverse(),
        },
      };
      expect(serializeCanonicalSystemImpact(scrambled)).toBe(
        serializeCanonicalSystemImpact(result),
      );
      expect(
        validateSystemImpactDocument({
          ...result,
          propagation: {
            ...result.propagation,
            summary: { ...result.propagation.summary, effects: 999 },
          },
        }),
      ).toMatchObject({
        success: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: 'SUMMARY_MISMATCH' })]),
      });
      const pathBounded = propagateConditionalSystemImpact({
        comparison,
        before: { system: beforeSystem, services: beforeServices },
        after: { system: afterSystem, services: afterServices },
        limits: { maxPaths: 1 },
      });
      expect(pathBounded.propagation.paths).toHaveLength(1);
      expect(pathBounded.propagation.summary.pathsOmitted).toBeGreaterThan(0);
    } finally {
      await cleanup([
        beforeApi.project,
        afterApi.project,
        beforeWorker.project,
        afterWorker.project,
      ]);
    }
  }, 60_000);

  it('keeps target-only candidates non-traversable and rejects mismatched source provenance', async () => {
    const [apiSource, workerSource] = await fixtureSources();
    const [beforeApi, afterApi, worker] = await Promise.all([
      scanSource(apiSource, 'api'),
      scanSource(apiSource.replace('requested: true', 'requested: false'), 'api'),
      scanSource(workerSource, 'worker'),
    ]);
    try {
      const beforeServices = services(beforeApi.analysis, worker.analysis);
      const afterServices = services(afterApi.analysis, worker.analysis);
      const beforeSystem = stitchSystemAnalyses({
        systemName: 'report-system',
        services: beforeServices,
      });
      const afterSystem = stitchSystemAnalyses({
        systemName: 'report-system',
        services: afterServices,
      });
      const observations = [
        { namespace: 'report-api', state: 'available' as const },
        { namespace: 'report-worker', state: 'available' as const },
      ];
      const comparison = compareSystemAnalyses({
        systemName: 'report-system',
        before: {
          label: 'baseline',
          document: beforeSystem,
          services: observations,
          topology: { state: 'not_present' },
        },
        after: {
          label: 'current',
          document: afterSystem,
          services: observations,
          topology: { state: 'not_present' },
        },
      });
      const result = propagateConditionalSystemImpact({
        comparison,
        before: { system: beforeSystem, services: beforeServices },
        after: { system: afterSystem, services: afterServices },
      });
      expect(result.propagation.paths).toEqual([]);
      expect(result.propagation.seeds).toEqual([]);

      expect(() =>
        propagateConditionalSystemImpact({
          comparison,
          before: { system: beforeSystem, services: beforeServices },
          after: {
            system: afterSystem,
            services: [
              {
                namespace: 'report-api',
                analysis: worker.analysis,
              },
              afterServices[1],
            ],
          },
        }),
      ).toThrow(SystemImpactPropagationError);
    } finally {
      await cleanup([beforeApi.project, afterApi.project, worker.project]);
    }
  }, 60_000);

  it('caps retained effects and terminates a broker cascade cycle deterministically', async () => {
    const [apiSource, workerSource, topologyText] = await fixtureSources();
    const cyclicWorker = workerSource
      .replace(
        "import { Controller, Injectable, Module } from '@nestjs/common';",
        "import { Controller, Inject, Injectable, Module } from '@nestjs/common';",
      )
      .replace('  MessagePattern,', '  ClientProxy,\n  ClientsModule,\n  MessagePattern,')
      .replace(
        "import Redlock from 'redlock';",
        "import Redlock from 'redlock';\nimport { firstValueFrom } from 'rxjs';",
      )
      .replace(
        '    private readonly locks: ReportLockService,',
        "    private readonly locks: ReportLockService,\n    @Inject('REPORT_QUEUE') private readonly client: ClientProxy,",
      )
      .replace(
        '  handle(@Payload() payload: unknown): Promise<void> {',
        "  handle(@Payload() payload: unknown): Promise<void> {\n    void firstValueFrom(this.client.send('report.generate', payload));",
      )
      .replace(
        '  imports: [TypeOrmModule.forFeature([ReportJob])],',
        "  imports: [\n    TypeOrmModule.forFeature([ReportJob]),\n    ClientsModule.register([{ name: 'REPORT_QUEUE', transport: Transport.RMQ }]),\n  ],",
      );
    const [beforeApi, afterApi, worker] = await Promise.all([
      scanSource(apiSource, 'api'),
      scanSource(apiSource.replace('requested: true', 'requested: false'), 'api'),
      scanSource(cyclicWorker, 'worker'),
    ]);
    try {
      const topologyJson = JSON.parse(topologyText) as SystemTopologyManifest;
      const topology = assertValidSystemTopologyManifest({
        ...topologyJson,
        bindings: [
          ...topologyJson.bindings,
          {
            ...topologyJson.bindings[0]!,
            serviceNamespace: 'report-worker',
          },
        ],
      });
      const beforeServices = services(beforeApi.analysis, worker.analysis);
      const afterServices = services(afterApi.analysis, worker.analysis);
      const beforeSystem = stitchSystemAnalyses({
        systemName: 'report-system',
        services: beforeServices,
        topology,
      });
      const afterSystem = stitchSystemAnalyses({
        systemName: 'report-system',
        services: afterServices,
        topology,
      });
      const comparison = compareSystemAnalyses(
        comparisonInput(beforeSystem, afterSystem, topology),
      );
      const result = propagateConditionalSystemImpact({
        comparison,
        before: { system: beforeSystem, services: beforeServices },
        after: { system: afterSystem, services: afterServices },
        limits: { maxHops: 4, maxEffectsPerPath: 1 },
      });
      expect(result.propagation.summary.cyclesTruncated).toBeGreaterThan(0);
      expect(result.propagation.summary.effectsOmitted).toBeGreaterThan(0);
      expect(result.propagation.paths.some(({ truncation }) => truncation === 'cycle')).toBe(true);
      expect(result.propagation.paths.every(({ effects }) => effects.length <= 1)).toBe(true);
    } finally {
      await cleanup([beforeApi.project, afterApi.project, worker.project]);
    }
  }, 60_000);
});
