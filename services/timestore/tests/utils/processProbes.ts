import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function killPort(port: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      return;
    }
    const { stdout } = await execAsync(`lsof -i :${port} -t || true`);
    const pids = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.warn('[timestore:testEnv] failed to kill port', { port, error });
  }
}

export function listActiveChildProcesses(): NodeJS.ChildProcess[] {
  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  const children: NodeJS.ChildProcess[] = [];
  for (const handle of handles) {
    if ((handle as { constructor?: { name?: string } }).constructor?.name === 'ChildProcess') {
      children.push(handle as NodeJS.ChildProcess);
    }
  }
  return children;
}
