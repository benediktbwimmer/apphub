import { spawn } from 'node:child_process';
import process from 'node:process';

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowNonZeroExit?: boolean;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(command: string[], options: RunCommandOptions = {}): Promise<RunCommandResult> {
  const child = spawn(command[0], command.slice(1), {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...(options.env ?? {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
  }

  const exitCode: number = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 0));
  });

  if (!options.allowNonZeroExit && exitCode !== 0) {
    throw new Error(`Command failed (${command.join(' ')}), exit ${exitCode}\n${stderr || stdout}`);
  }

  return { stdout, stderr, exitCode };
}
