import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { runE2E } from '../helpers';
import { startExternalStack } from './stack';
import { startDevRunner } from './devRunner';
import { prepareObservatoryExample } from './observatory';
import { triggerGeneratorWorkflow } from './flows';
import { verifyFilestoreIngest, verifyMetastore, verifyTimestore } from './verification';
import { requestJson, waitForEndpoint } from './httpClient';

const CORE_BASE_URL = 'http://127.0.0.1:4000';
const METASTORE_BASE_URL = 'http://127.0.0.1:4100';
const TIMESTORE_BASE_URL = 'http://127.0.0.1:4200';
const FILESTORE_BASE_URL = 'http://127.0.0.1:4300';

type BenchmarkScenario = {
  name: string;
  iterations: number;
  execute: () => Promise<void>;
};

function computeStats(samples: number[]): {
  minMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
} {
  if (samples.length === 0) {
    return { minMs: 0, maxMs: 0, avgMs: 0, p95Ms: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const minMs = sorted[0];
  const maxMs = sorted[sorted.length - 1];
  const avgMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95Ms = sorted[p95Index];
  return { minMs, maxMs, avgMs, p95Ms };
}

async function runScenario(scenario: BenchmarkScenario): Promise<{ name: string; samples: number[]; stats: ReturnType<typeof computeStats> }> {
  const samples: number[] = [];
  for (let i = 0; i < scenario.iterations; i += 1) {
    const started = performance.now();
    await scenario.execute();
    const elapsed = performance.now() - started;
    samples.push(elapsed);
  }
  return {
    name: scenario.name,
    samples,
    stats: computeStats(samples)
  };
}

async function runBenchmarks(): Promise<void> {
  await waitForEndpoint(`${CORE_BASE_URL}/readyz`);
  await waitForEndpoint(`${METASTORE_BASE_URL}/readyz`);
  await waitForEndpoint(`${TIMESTORE_BASE_URL}/readyz`);
  await waitForEndpoint(`${FILESTORE_BASE_URL}/readyz`);

  const observatory = await prepareObservatoryExample();
  await verifyFilestoreIngest(observatory);
  await verifyMetastore();
  await verifyTimestore();
  await triggerGeneratorWorkflow(observatory);

  const scenarios: BenchmarkScenario[] = [
    {
      name: 'core:list-workflows',
      iterations: 25,
      execute: async () => {
        await requestJson(`${observatory.coreBaseUrl}/workflows`, {
          token: observatory.coreToken,
          expectedStatus: 200
        });
      }
    },
    {
      name: 'core:list-workflow-runs',
      iterations: 25,
      execute: async () => {
        await requestJson(`${observatory.coreBaseUrl}/workflow-runs`, {
          token: observatory.coreToken,
          expectedStatus: 200
        });
      }
    },
    {
      name: 'metastore:list-namespaces',
      iterations: 20,
      execute: async () => {
        await requestJson(`${METASTORE_BASE_URL}/namespaces`, {
          expectedStatus: 200
        });
      }
    },
    {
      name: 'filestore:list-backend-mounts',
      iterations: 20,
      execute: async () => {
        await requestJson(`${FILESTORE_BASE_URL}/v1/backend-mounts`, {
          expectedStatus: 200
        });
      }
    },
    {
      name: 'timestore:sql-schema',
      iterations: 20,
      execute: async () => {
        await requestJson(`${TIMESTORE_BASE_URL}/sql/schema`, {
          expectedStatus: 200
        });
      }
    }
  ];

  const results = [] as Awaited<ReturnType<typeof runScenario>>[];
  for (const scenario of scenarios) {
    const outcome = await runScenario(scenario);
    results.push(outcome);
    const { minMs, maxMs, avgMs, p95Ms } = outcome.stats;
    console.log(
      `${scenario.name}: avg=${avgMs.toFixed(2)}ms min=${minMs.toFixed(2)}ms max=${maxMs.toFixed(2)}ms p95=${p95Ms.toFixed(2)}ms`
    );
  }

  const outputDir = path.resolve(__dirname, '..', '..', 'benchmarks');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'observatory.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    results: results.map((entry) => ({
      name: entry.name,
      iterations: entry.samples.length,
      stats: entry.stats
    }))
  };
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Benchmark results saved to ${path.relative(process.cwd(), outputPath)}`);
}

runE2E(async (context) => {
  const reuseStack = process.env.APPHUB_E2E_SKIP_STACK === '1';
  const stack = await startExternalStack({ skipContainers: reuseStack });
  if (!reuseStack) {
    context.registerCleanup(() => stack.stop());
  }

  const devRunner = await startDevRunner({ logPrefix: '[dev]' });
  context.registerCleanup(() => devRunner.stop());

  await runBenchmarks();
}, {
  name: 'apphub-observatory-bench',
  gracePeriodMs: 2_000
});
