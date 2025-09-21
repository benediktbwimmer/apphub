"use strict";

const { spawn } = require("node:child_process");
const { promises: fs } = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const OUTPUT_FILENAME = 'suggestion.json';
const DEFAULT_TIMEOUT_MS = 120000;

function resolveCodexExecutable() {
  const override = process.env.APPHUB_CODEX_CLI;
  return override && override.trim().length > 0 ? override.trim() : 'codex';
}

function resolveAdditionalArgs() {
  const raw = process.env.APPHUB_CODEX_EXEC_OPTS;
  if (!raw) {
    return [];
  }
  return raw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

async function prepareWorkspace(options) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-bundle-'));
  const instructionsPath = path.join(workspace, 'instructions.md');
  const contextDir = path.join(workspace, 'context');
  const outputDir = path.join(workspace, 'output');
  await fs.mkdir(contextDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const promptParts = [
    '# AppHub Workflow Spec Task',
    `Mode: ${options.mode.toUpperCase()}`,
    'Review the context files inside ./context.',
    'Write the resulting JSON to ./output/suggestion.json. Do not print the JSON to stdout.',
    'Use two-space indentation.',
    options.notes || ''
  ].filter(Boolean);

  await fs.writeFile(instructionsPath, `${promptParts.join('\n\n')}\n`, 'utf8');
  await fs.writeFile(path.join(contextDir, 'prompt.txt'), options.prompt, 'utf8');
  await fs.writeFile(path.join(contextDir, 'metadata.md'), options.metadataSummary, 'utf8');

  return {
    workspace,
    instructionsPath,
    outputPath: path.join(outputDir, OUTPUT_FILENAME)
  };
}

async function cleanup(workspace) {
  try {
    await fs.rm(workspace, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

async function runCodex(options) {
  if (process.env.APPHUB_CODEX_MOCK_DIR) {
    const file = options.mode === 'job'
      ? path.join(process.env.APPHUB_CODEX_MOCK_DIR, 'job.json')
      : path.join(process.env.APPHUB_CODEX_MOCK_DIR, 'workflow.json');
    const content = await fs.readFile(file, 'utf8');
    return { raw: content, stdout: '', stderr: '', summary: '' };
  }

  const setup = await prepareWorkspace(options);
  const command = resolveCodexExecutable();
  const args = ['exec', ...resolveAdditionalArgs(), setup.instructionsPath];
  const stdout = [];
  const stderr = [];

  const child = spawn(command, args, {
    cwd: setup.workspace,
    env: {
      ...process.env,
      CODEX_NO_COLOR: '1',
      CODEX_SUPPRESS_SPINNER: '1',
      APPHUB_CODEX_OUTPUT_DIR: path.join(setup.workspace, 'output')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
      reject(new Error('Codex CLI timed out'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => stdout.push(chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Codex CLI exited with status ${code}`));
      }
    });
  });

  const raw = await fs.readFile(setup.outputPath, 'utf8');
  let summary = '';
  try {
    summary = await fs.readFile(path.join(path.dirname(setup.outputPath), 'summary.txt'), 'utf8');
  } catch {
    summary = '';
  }

  if (!process.env.APPHUB_CODEX_DEBUG_WORKSPACES) {
    await cleanup(setup.workspace);
  }

  return { raw, stdout: stdout.join(''), stderr: stderr.join(''), summary };
}

exports.handler = async function handler(context) {
  const params = context && context.parameters ? context.parameters : {};
  const prompt = typeof params.prompt === 'string' ? params.prompt : '';
  if (!prompt) {
    throw new Error('prompt parameter is required');
  }
  const metadataSummary = typeof params.metadataSummary === 'string'
    ? params.metadataSummary
    : 'No metadata summary provided.';
  const notes = typeof params.additionalNotes === 'string' ? params.additionalNotes : '';
  const mode = params.mode === 'job' ? 'job' : 'workflow';
  const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined;

  context.logger('Generating suggestion via Codex CLI', { mode });

  const result = await runCodex({
    mode,
    prompt,
    metadataSummary,
    notes,
    timeoutMs
  });

  let suggestion = null;
  let parseError = null;
  try {
    suggestion = JSON.parse(result.raw);
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  await context.update({
    metrics: {
      mode,
      parseError: Boolean(parseError)
    }
  });

  return {
    status: parseError ? 'failed' : 'succeeded',
    result: {
      mode,
      raw: result.raw,
      suggestion,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: result.summary,
      parseError
    }
  };
};
