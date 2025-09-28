import { spawn } from 'node:child_process';

export type KubectlResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type RunKubectlOptions = {
  stdin?: string;
  env?: NodeJS.ProcessEnv;
};

export function runKubectl(args: string[], options: RunKubectlOptions = {}): Promise<KubectlResult> {
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

export async function applyManifest(
  manifest: Record<string, unknown> | { items: Record<string, unknown>[] },
  namespace?: string
): Promise<KubectlResult> {
  const args = ['apply', '-f', '-'];
  if (namespace) {
    args.push('--namespace', namespace);
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
