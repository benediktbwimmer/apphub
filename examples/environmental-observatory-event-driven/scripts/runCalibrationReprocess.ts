import process from 'node:process';

import { loadObservatoryConfig } from '../shared/config';

function parseArgs(argv: string[]): {
  planId?: string;
  planPath?: string;
  mode: 'all' | 'selected';
  selectedPartitions: string[];
  pollIntervalMs?: number;
} {
  const args: Record<string, string[]> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      if (!args[key]) {
        args[key] = [];
      }
      args[key].push(next);
      index += 1;
    } else {
      args[key] = ['true'];
    }
  }

  const planId = args['plan-id']?.[0] ?? args.planId?.[0];
  const planPath = args['plan-path']?.[0] ?? args.planPath?.[0];
  if (!planId && !planPath) {
    throw new Error('Usage: tsx runCalibrationReprocess.ts --plan-id <id> [--plan-path <filestore path>] [--mode all|selected] [--partition <minute|partitionKey>] [--poll-interval <ms>]');
  }

  const modeRaw = args.mode?.[0] ?? 'all';
  const mode = modeRaw === 'selected' ? 'selected' : 'all';
  const selectedPartitions = (args.partition ?? args.partitions ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);

  const pollIntervalRaw = args['poll-interval']?.[0] ?? args.pollInterval?.[0];
  const pollIntervalMs = pollIntervalRaw ? Number(pollIntervalRaw) : undefined;
  if (pollIntervalRaw && (!Number.isFinite(pollIntervalMs as number) || (pollIntervalMs as number) < 250)) {
    throw new Error(`Invalid poll interval '${pollIntervalRaw}'. Expected a number >= 250.`);
  }

  return { planId, planPath, mode, selectedPartitions, pollIntervalMs };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadObservatoryConfig();

  const coreBaseUrl = config.core?.baseUrl ?? 'http://127.0.0.1:4000';
  const coreToken = config.core?.apiToken ?? 'dev-token';
  const filestoreBaseUrl = config.filestore.baseUrl ?? 'http://127.0.0.1:4300';
  const metastoreBaseUrl = config.metastore?.baseUrl ?? null;
  const metastoreNamespace = config.metastore?.namespace ?? 'observatory.reprocess.plans';
  const metastoreAuthToken = config.metastore?.authToken ?? null;

  const requestBody = {
    parameters: {
      planId: args.planId,
      planPath: args.planPath,
      mode: args.mode,
      selectedPartitions: args.selectedPartitions,
      pollIntervalMs: args.pollIntervalMs,
      coreBaseUrl,
      coreApiToken: coreToken,
      filestoreBaseUrl,
      filestoreBackendId: config.filestore.backendMountId,
      filestoreToken: config.filestore.token ?? null,
      filestorePrincipal: 'observatory-calibration-reprocessor',
      metastoreBaseUrl,
      metastoreNamespace,
      metastoreAuthToken
    }
  } as const;

  const response = await fetch(`${coreBaseUrl.replace(/\/+$/, '')}/workflows/observatory-calibration-reprocess/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${coreToken}`,
      'user-agent': 'observatory-calibration-reprocess-cli/0.1.0'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Reprocess workflow request failed (${response.status} ${response.statusText}): ${detail}`);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    data?: {
      id?: string;
      status?: string;
      partitionKey?: string | null;
      parameters?: Record<string, unknown> | null;
    };
  };

  const runId = payload.data?.id ?? 'unknown';
  const status = payload.data?.status ?? 'unknown';
  console.log(`Reprocess workflow queued (runId=${runId}, status=${status}).`);
  if (payload.data?.parameters) {
    console.log('Submitted parameters:');
    console.log(JSON.stringify(payload.data.parameters, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
