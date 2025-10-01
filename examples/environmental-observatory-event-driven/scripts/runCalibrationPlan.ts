import process from 'node:process';

import { loadObservatoryConfig } from '../shared/config';

function parseArgs(argv: string[]): {
  instrumentId: string;
  effectiveAt: string;
  calibrationId?: string;
  metastoreVersion?: number;
  planId?: string;
  planPath?: string;
} {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = 'true';
    }
  }

  const instrumentId = (args.instrument ?? args.instrumentId ?? '').trim();
  const effectiveAt = (args.effectiveAt ?? '').trim();
  if (!instrumentId || !effectiveAt) {
    throw new Error('Usage: tsx runCalibrationPlan.ts --instrument <instrument_id> --effectiveAt <ISO timestamp> [--calibration-id <id>] [--metastore-version <number>] [--plan-id <id>] [--plan-path <path>]');
  }

  const calibrationId = (args['calibration-id'] ?? args.calibrationId ?? '').trim() || undefined;
  const metastoreVersionRaw = (args['metastore-version'] ?? args.metastoreVersion ?? '').trim();
  const metastoreVersion = metastoreVersionRaw ? Number(metastoreVersionRaw) : undefined;
  if (metastoreVersionRaw && !Number.isFinite(metastoreVersion as number)) {
    throw new Error(`Invalid metastore version '${metastoreVersionRaw}'. Expected a number.`);
  }

  const planId = (args['plan-id'] ?? args.planId ?? '').trim() || undefined;
  const planPath = (args['plan-path'] ?? args.planPath ?? '').trim() || undefined;

  return { instrumentId, effectiveAt, calibrationId, metastoreVersion, planId, planPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadObservatoryConfig();

  const coreBaseUrl = config.core?.baseUrl ?? 'http://127.0.0.1:4000';
  const coreToken = config.core?.apiToken ?? 'dev-token';
  const filestoreBaseUrl = config.filestore.baseUrl ?? 'http://127.0.0.1:4300';
  const plansPrefix = config.filestore.plansPrefix ?? 'datasets/observatory/calibrations/plans';
  const metastoreBaseUrl = config.metastore?.baseUrl ?? 'http://127.0.0.1:4100';
  const metastoreNamespace = config.metastore?.namespace ?? 'observatory.calibrations';
  const metastoreAuthToken = config.metastore?.authToken ?? null;

  const requestBody = {
    parameters: {
      filestoreBaseUrl,
      filestoreBackendId: config.filestore.backendMountId,
      filestoreToken: config.filestore.token ?? null,
      filestorePrincipal: 'observatory-calibration-planner',
      plansPrefix,
      coreBaseUrl,
      coreApiToken: coreToken,
      metastoreBaseUrl,
      metastoreNamespace,
      metastoreAuthToken,
      planId: args.planId,
      planPath: args.planPath,
      calibrations: [
        {
          calibrationId: args.calibrationId,
          instrumentId: args.instrumentId,
          effectiveAt: new Date(args.effectiveAt).toISOString(),
          metastoreVersion: args.metastoreVersion ?? null
        }
      ]
    }
  } as const;

  const response = await fetch(`${coreBaseUrl.replace(/\/+$/, '')}/jobs/observatory-calibration-planner/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${coreToken}`,
      'user-agent': 'observatory-calibration-plan-cli/0.1.0'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Planner request failed (${response.status} ${response.statusText}): ${detail}`);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    data?: {
      id?: string;
      status?: string;
      output?: Record<string, unknown> | null;
    };
  };

  const runId = payload.data?.id ?? 'unknown';
  const status = payload.data?.status ?? 'unknown';
  console.log(`Planner job queued (runId=${runId}, status=${status}).`);
  if (payload.data?.output) {
    console.log(JSON.stringify(payload.data.output, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
