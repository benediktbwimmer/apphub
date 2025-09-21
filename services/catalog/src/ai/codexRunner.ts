import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type CodexGenerationMode = 'workflow' | 'job' | 'job-with-bundle';

export type CodexGenerationOptions = {
  mode: CodexGenerationMode;
  operatorRequest: string;
  metadataSummary: string;
  additionalNotes?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type CodexGenerationResult = {
  workspace: string;
  outputPath: string;
  output: string;
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_FILENAME = 'suggestion.json';

function resolveCodexExecutable(): string {
  const override = process.env.APPHUB_CODEX_CLI?.trim();
  if (override) {
    return override;
  }
  return 'codex';
}

function resolveAdditionalArgs(): string[] {
  const raw = process.env.APPHUB_CODEX_EXEC_OPTS;
  if (!raw) {
    return [];
  }
  return raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

async function prepareWorkspace(options: CodexGenerationOptions): Promise<{
  directory: string;
  instructionsPath: string;
  outputPath: string;
}> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-codex-'));
  const instructionsPath = path.join(workspace, 'instructions.md');
  const contextDir = path.join(workspace, 'context');
  const outputDir = path.join(workspace, 'output');
  await fs.mkdir(contextDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const promptSections = [
    '# AppHub AI Builder Task',
    `Session: ${randomUUID()}`,
    'You are operating inside the AppHub Codex integration workspace. Generate a candidate definition for the operator.',
    `Mode: ${options.mode.toUpperCase()}`,
    '1. Inspect the context files under `./context/`. They summarise available jobs, services, and workflows.',
    '2. Produce a JSON definition that satisfies the platform constraints for the selected mode.',
    `3. Write the JSON payload to \`./output/${OUTPUT_FILENAME}\`. Do not print the JSON to stdout.`,
    '4. Ensure the JSON is pretty-printed with two-space indentation.',
    options.additionalNotes?.trim() ?? '',
    'When the suggestion is ready, append a short summary to `./output/summary.txt` describing key choices.',
    options.mode === 'job-with-bundle'
      ? [
          'For job-with-bundle mode, `suggestion.json` must contain an object with the shape:',
          '{',
          '  "job": { /* job definition matching the AppHub schema */ },',
          '  "bundle": {',
          '    "slug": "...",',
          '    "version": "...",',
          '    "entryPoint": "index.js",',
          '    "manifestPath": "manifest.json",',
          '    "manifest": { /* bundle manifest JSON */ },',
          '    "capabilityFlags": ["optional", "flags"],',
          '    "files": [',
          '      { "path": "index.js", "contents": "// handler source", "encoding": "utf8", "executable": false }',
          '    ]',
          '  }',
          '}',
          'When producing bundle files, ensure every entry is included in the `files` array and referenced relative to the bundle root.',
          'You may add optional fields like `metadata` where suitable.'
        ].join('\n')
      : ''
  ].filter(Boolean);

  const promptBody = `${promptSections.join('\n\n')}\n`;
  await fs.writeFile(instructionsPath, promptBody, { encoding: 'utf8' });

  const metadataPath = path.join(contextDir, 'metadata.md');
  const normalizedRequest = options.operatorRequest.trim() || 'Operator did not provide a description.';
  const normalizedSummary = options.metadataSummary.trim() || 'No catalog metadata was supplied.';
  await fs.writeFile(
    metadataPath,
    `# Operator Request\n\n${normalizedRequest}\n\n# Catalog Snapshot\n\n${normalizedSummary}\n`,
    { encoding: 'utf8' }
  );

  return {
    directory: workspace,
    instructionsPath,
    outputPath: path.join(outputDir, OUTPUT_FILENAME)
  };
}

async function readOutputFile(outputPath: string): Promise<string> {
  const content = await fs.readFile(outputPath, { encoding: 'utf8' });
  return content.trim();
}

async function cleanupWorkspace(workspace: string): Promise<void> {
  try {
    await fs.rm(workspace, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
}

function buildCodexArgs(instructionsPath: string): string[] {
  return ['exec', ...resolveAdditionalArgs(), instructionsPath];
}

export async function runCodexGeneration(options: CodexGenerationOptions): Promise<CodexGenerationResult> {
  const mockDir = process.env.APPHUB_CODEX_MOCK_DIR;
  if (mockDir) {
    const fileName =
      options.mode === 'workflow'
        ? 'workflow.json'
        : options.mode === 'job-with-bundle'
        ? 'job-with-bundle.json'
        : 'job.json';
    const mockPath = path.join(mockDir, fileName);
    const mockContent = await fs.readFile(mockPath, { encoding: 'utf8' });
    return {
      workspace: mockDir,
      outputPath: mockPath,
      output: mockContent,
      stdout: '',
      stderr: ''
    } satisfies CodexGenerationResult;
  }

  const workspace = await prepareWorkspace(options);
  const command = resolveCodexExecutable();
  const args = buildCodexArgs(workspace.instructionsPath);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  try {
    const child = spawn(command, args, {
      cwd: workspace.directory,
      env: {
        ...process.env,
        CODEX_NO_COLOR: '1',
        CODEX_SUPPRESS_SPINNER: '1',
        APPHUB_CODEX_OUTPUT_DIR: path.join(workspace.directory, 'output')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let timeout: NodeJS.Timeout | null = null;
    const killChild = () => {
      if (child.killed) {
        return;
      }
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000);
    };

    await new Promise<void>((resolve, reject) => {
      if (options.signal) {
        if (options.signal.aborted) {
          killChild();
          reject(options.signal.reason ?? new Error('Codex generation aborted'));
          return;
        }
        options.signal.addEventListener('abort', () => {
          killChild();
          reject(options.signal?.reason ?? new Error('Codex generation aborted'));
        });
      }

      timeout = setTimeout(() => {
        killChild();
        reject(new Error('Codex generation timed out'));
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk.toString('utf8'));
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString('utf8'));
      });

      child.on('error', (err) => {
        reject(err);
      });

      child.on('close', (code) => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Codex CLI exited with status ${code ?? 'unknown'}`));
        }
      });
    });

    const output = await readOutputFile(workspace.outputPath);
    return {
      workspace: workspace.directory,
      outputPath: workspace.outputPath,
      output,
      stdout: stdoutChunks.join(''),
      stderr: stderrChunks.join('')
    } satisfies CodexGenerationResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(`Codex generation failed: ${message}`);
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  } finally {
    if (!process.env.APPHUB_CODEX_DEBUG_WORKSPACES) {
      await cleanupWorkspace(workspace.directory);
    }
  }
}
