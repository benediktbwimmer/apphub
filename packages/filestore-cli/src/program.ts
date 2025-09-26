import { Command } from 'commander';
import { FilestoreClient } from '@apphub/filestore-client';
import type { FilestoreEvent, FilestoreReconciliationReason } from '@apphub/shared/filestoreEvents';

const DEFAULT_BASE_URL = process.env.FILESTORE_BASE_URL ?? 'http://127.0.0.1:4200';
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.FILESTORE_HTTP_TIMEOUT_MS ?? '', 10) || 10_000;

type GlobalOptions = {
  baseUrl?: string;
  token?: string;
  tokenEnv?: string;
  json?: boolean;
  principal?: string;
};

function resolveToken(options: GlobalOptions): string | undefined {
  if (options.token) {
    return options.token;
  }
  if (options.tokenEnv) {
    const value = process.env[options.tokenEnv];
    if (value) {
      return value;
    }
  }
  if (process.env.FILESTORE_TOKEN) {
    return process.env.FILESTORE_TOKEN;
  }
  return undefined;
}

function resolveBaseUrl(options: GlobalOptions): string {
  return options.baseUrl ?? process.env.FILESTORE_BASE_URL ?? DEFAULT_BASE_URL;
}

function formatOutput(payload: unknown, asJson: boolean | undefined): void {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(payload);
}

function createClient(options: GlobalOptions): FilestoreClient {
  const token = resolveToken(options);
  return new FilestoreClient({
    baseUrl: resolveBaseUrl(options),
    token,
    defaultHeaders: {},
    userAgent: 'filestore-cli/0.1.0',
    fetchTimeoutMs: DEFAULT_TIMEOUT_MS
  });
}

async function handleCreateDirectory(
  client: FilestoreClient,
  options: GlobalOptions,
  backendMountId: string,
  path: string,
  metadata: string | undefined
): Promise<void> {
  let metadataPayload: Record<string, unknown> | undefined;
  if (metadata) {
    try {
      metadataPayload = JSON.parse(metadata);
    } catch (err) {
      throw new Error(`Failed to parse metadata JSON: ${(err as Error).message}`);
    }
  }
  const response = await client.createDirectory({
    backendMountId: Number.parseInt(backendMountId, 10),
    path,
    metadata: metadataPayload,
    principal: options.principal
  });
  formatOutput(response, options.json);
}

async function handleDeleteNode(
  client: FilestoreClient,
  options: GlobalOptions,
  backendMountId: string,
  path: string,
  recursive: boolean
): Promise<void> {
  const response = await client.deleteNode({
    backendMountId: Number.parseInt(backendMountId, 10),
    path,
    recursive,
    principal: options.principal
  });
  formatOutput(response, options.json);
}

async function handleStatNode(
  client: FilestoreClient,
  options: GlobalOptions,
  backendMountId: string,
  path: string
): Promise<void> {
  const node = await client.getNodeByPath({
    backendMountId: Number.parseInt(backendMountId, 10),
    path
  });
  formatOutput(node, options.json);
}

async function handleEnqueueReconciliation(
  client: FilestoreClient,
  options: GlobalOptions,
  backendMountId: string,
  path: string,
  reason: string,
  nodeId: number | undefined,
  detectChildren: boolean,
  requestedHash: boolean
): Promise<void> {
  const normalizedReason = (['drift', 'audit', 'manual'] as FilestoreReconciliationReason[]).includes(
    reason as FilestoreReconciliationReason
  )
    ? (reason as FilestoreReconciliationReason)
    : 'manual';
  const result = await client.enqueueReconciliation({
    backendMountId: Number.parseInt(backendMountId, 10),
    path,
    nodeId: nodeId ?? null,
    reason: normalizedReason,
    detectChildren,
    requestedHash
  });
  formatOutput(result, options.json);
}

async function handleTailEvents(client: FilestoreClient, options: GlobalOptions, eventTypes: string[]): Promise<void> {
  const types = eventTypes.length > 0 ? (eventTypes as FilestoreEvent['type'][]) : undefined;
  const abortController = new AbortController();
  const stop = () => {
    abortController.abort();
    process.off('SIGINT', stop);
  };
  process.on('SIGINT', stop);

  try {
    for await (const event of client.streamEvents({ signal: abortController.signal, eventTypes: types })) {
      if (options.json) {
        console.log(JSON.stringify(event));
      } else {
        console.log(`[${event.type}] ${JSON.stringify(event.data)}`);
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      return;
    }
    throw err;
  } finally {
    process.off('SIGINT', stop);
  }
}

type CliDependencies = {
  clientFactory?: (options: GlobalOptions) => FilestoreClient;
};

export function createInterface(deps: CliDependencies = {}): Command {
  const clientFactory = deps.clientFactory ?? createClient;
  const program = new Command();
  program
    .name('filestore')
    .description('CLI for interacting with the Filestore service')
    .option('--base-url <url>', 'Filestore base URL')
    .option('--token <token>', 'Authentication token')
    .option('--token-env <env>', 'Environment variable that contains the token')
    .option('--json', 'Output raw JSON responses')
    .option('--principal <principal>', 'Upstream principal header for audit trails');

  program
    .command('directories:create')
    .description('Create a directory on a backend mount')
    .argument('<backendMountId>', 'Backend mount identifier')
    .argument('<path>', 'Directory path')
    .option('--metadata <json>', 'Optional metadata JSON object')
    .action(async (backendMountId: string, path: string, cmdOptions: { metadata?: string }) => {
      const options = program.opts<GlobalOptions>();
      const client = clientFactory(options);
      await handleCreateDirectory(client, options, backendMountId, path, cmdOptions.metadata);
    });

  program
    .command('nodes:delete')
    .description('Delete a node by path')
    .argument('<backendMountId>', 'Backend mount identifier')
    .argument('<path>', 'Node path')
    .option('--recursive', 'Recursively delete directories', false)
    .action(async (backendMountId: string, path: string, cmdOptions: { recursive?: boolean }) => {
      const options = program.opts<GlobalOptions>();
      const client = clientFactory(options);
      await handleDeleteNode(client, options, backendMountId, path, Boolean(cmdOptions.recursive));
    });

  program
    .command('nodes:stat')
    .description('Retrieve metadata for a node by path')
    .argument('<backendMountId>', 'Backend mount identifier')
    .argument('<path>', 'Node path')
    .action(async (backendMountId: string, path: string) => {
      const options = program.opts<GlobalOptions>();
      const client = clientFactory(options);
      await handleStatNode(client, options, backendMountId, path);
    });

  program
    .command('reconcile:enqueue')
    .description('Enqueue a reconciliation job for a path')
    .argument('<backendMountId>', 'Backend mount identifier')
    .argument('<path>', 'Node path')
    .option('--node-id <id>', 'Existing node identifier', (value) => Number.parseInt(value, 10))
    .option('--reason <reason>', 'Reason for reconciliation (drift|audit|manual)', 'manual')
    .option('--detect-children', 'Request child detection during reconciliation', false)
    .option('--requested-hash', 'Request content hashing during reconciliation', false)
    .action(async (
      backendMountId: string,
      path: string,
      cmdOptions: { nodeId?: number; reason?: string; detectChildren?: boolean; requestedHash?: boolean }
    ) => {
      const options = program.opts<GlobalOptions>();
      const client = clientFactory(options);
      await handleEnqueueReconciliation(
        client,
        options,
        backendMountId,
        path,
        cmdOptions.reason ?? 'manual',
        cmdOptions.nodeId,
        Boolean(cmdOptions.detectChildren),
        Boolean(cmdOptions.requestedHash)
      );
    });

  program
    .command('events:tail')
    .description('Tail filestore events (SSE)')
    .option('--event <type...>', 'Filter specific event types (repeatable)')
    .action(async (cmdOptions: { event?: string[] }) => {
      const options = program.opts<GlobalOptions>();
      const client = clientFactory(options);
      await handleTailEvents(client, options, cmdOptions.event ?? []);
    });

  return program;
}
