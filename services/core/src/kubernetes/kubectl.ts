import { spawn } from 'node:child_process';

export type KubectlResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type RunKubectlOptions = {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
};

type KubectlInvoker = (args: string[], options?: RunKubectlOptions) => Promise<KubectlResult>;

const namespaceCache = new Set<string>();

const DEFAULT_ERROR_PREFIX = 'Failed to ensure namespace';

function spawnKubectl(args: string[], options: RunKubectlOptions = {}): Promise<KubectlResult> {
  return new Promise((resolve) => {
    const child = spawn('kubectl', args, {
      env: options.env ?? process.env
    });

    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });

    child.on('error', (err) => {
      const message = (err as Error).message ?? 'kubectl execution failed';
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${message}`.trim() });
    });
  });
}

let kubectlRunner: KubectlInvoker = spawnKubectl;

export function runKubectl(args: string[], options: RunKubectlOptions = {}): Promise<KubectlResult> {
  return kubectlRunner(args, options);
}

function normalizeNamespace(namespace: string): string {
  return namespace.trim();
}

async function ensureNamespaceExists(namespace: string): Promise<KubectlResult | null> {
  const normalized = normalizeNamespace(namespace);
  if (!normalized) {
    return null;
  }
  if (namespaceCache.has(normalized)) {
    return null;
  }

  const lookupResult = await runKubectl(['get', 'namespace', normalized]);
  if (lookupResult.exitCode === 0) {
    namespaceCache.add(normalized);
    return null;
  }

  const createResult = await runKubectl(['create', 'namespace', normalized]);
  if (createResult.exitCode === 0 || createResult.stderr.includes('AlreadyExists')) {
    namespaceCache.add(normalized);
    return null;
  }

  return {
    exitCode: createResult.exitCode ?? 1,
    stdout: createResult.stdout,
    stderr:
      createResult.stderr || `${DEFAULT_ERROR_PREFIX} "${normalized}" – kubectl create namespace failed`
  };
}

export async function applyManifest(
  manifest: Record<string, unknown> | { items: Record<string, unknown>[] },
  namespace?: string
): Promise<KubectlResult> {
  const args = ['apply', '-f', '-'];
  if (namespace) {
    const normalized = normalizeNamespace(namespace);
    if (normalized) {
      const ensureResult = await ensureNamespaceExists(normalized);
      if (ensureResult) {
        return ensureResult;
      }
      args.push('--namespace', normalized);
    }
  }
  const payload = JSON.stringify(manifest);
  return runKubectl(args, { stdin: payload });
}

export async function deleteResource(
  kind: string,
  name: string,
  namespace?: string,
  extraArgs: string[] = []
): Promise<KubectlResult> {
  const args = ['delete', `${kind}/${name}`];
  args.push(...extraArgs);
  if (namespace) {
    args.push('--namespace', namespace);
  }
  return runKubectl(args);
}

export function __setKubectlRunnerForTests(runner: KubectlInvoker): void {
  kubectlRunner = runner;
}

export function __resetKubectlTestState(): void {
  kubectlRunner = spawnKubectl;
  namespaceCache.clear();
}
