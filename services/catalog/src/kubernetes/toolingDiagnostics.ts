import fs from 'node:fs';
import path from 'node:path';
import { runKubectl, type KubectlResult } from './kubectl';

type DiagnosticsStatus = 'ok' | 'error';

export type KubectlDiagnostics = {
  status: DiagnosticsStatus;
  version?: string;
  warnings: string[];
  error?: string;
  details?: string;
  result: KubectlResult;
};

function parseKubectlVersion(output: string): string | undefined {
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      clientVersion?: { gitVersion?: string; gitCommit?: string };
    };
    if (parsed?.clientVersion?.gitVersion) {
      return parsed.clientVersion.gitVersion;
    }
    if (parsed?.clientVersion?.gitCommit) {
      return parsed.clientVersion.gitCommit;
    }
  } catch {
    // Fallback to parsing plain text (kubectl < 1.26 without --output=json support)
    const match = trimmed.match(/GitVersion:\s*v?(\S+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function expandKubeconfigEntries(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function existingPaths(entries: string[]): string[] {
  return entries.filter((entry) => {
    try {
      return fs.existsSync(entry);
    } catch {
      return false;
    }
  });
}

function hasServiceAccountCredentials(): boolean {
  const base = process.env.KUBERNETES_SERVICE_ACCOUNT_PATH ?? '/var/run/secrets/kubernetes.io/serviceaccount';
  const tokenPath = path.join(base, 'token');
  const caPath = path.join(base, 'ca.crt');
  try {
    return fs.existsSync(tokenPath) && fs.existsSync(caPath);
  } catch {
    return false;
  }
}

function describeKubectlError(result: KubectlResult): string {
  if (result.exitCode === null) {
    if (result.stderr.includes('ENOENT')) {
      return 'kubectl binary not found on PATH. Install kubectl (>=1.27) in the runtime image.';
    }
    return 'kubectl command failed to spawn.';
  }
  const stderr = result.stderr.trim();
  if (!stderr) {
    return `kubectl exited with status ${result.exitCode ?? 'unknown'}`;
  }
  return stderr;
}

export async function checkKubectlDiagnostics(): Promise<KubectlDiagnostics> {
  const result = await runKubectl(['version', '--client', '--output=json']);
  const warnings: string[] = [];

  const kubeconfigEntries = expandKubeconfigEntries(process.env.KUBECONFIG);
  const kubeconfigFiles = existingPaths(kubeconfigEntries);
  const hasServiceAccount = hasServiceAccountCredentials();

  if (kubeconfigEntries.length > 0 && kubeconfigFiles.length === 0) {
    warnings.push('KUBECONFIG is set but none of the referenced files are readable.');
  }
  if (kubeconfigEntries.length === 0 && !hasServiceAccount) {
    warnings.push('No Kubernetes credentials detected. Mount a kubeconfig or in-cluster service account.');
  }

  if (result.exitCode === 0) {
    const version = parseKubectlVersion(result.stdout);
    const stderr = result.stderr.trim();
    if (stderr) {
      warnings.push(`kubectl wrote to stderr during version check: ${stderr}`);
    }
    return {
      status: 'ok',
      version,
      warnings,
      error: undefined,
      details: undefined,
      result
    };
  }

  const error = describeKubectlError(result);
  return {
    status: 'error',
    warnings,
    version: undefined,
    error,
    details: result.stderr.trim() || result.stdout.trim() || undefined,
    result
  };
}
