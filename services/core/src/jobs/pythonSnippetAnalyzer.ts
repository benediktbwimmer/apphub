import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

import type { JsonValue } from '../db/types';

export type PythonSnippetAnalysis = {
  handlerName: string;
  handlerIsAsync: boolean;
  inputModel: {
    name: string;
    schema: JsonValue;
  };
  outputModel: {
    name: string;
    schema: JsonValue;
  };
};

export class PythonSnippetAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonSnippetAnalysisError';
  }
}

function resolveAnalyzerPath(): string {
  const compiled = path.resolve(__dirname, './snippets/pythonSnippetAnalyzer.py');
  if (existsSync(compiled)) {
    return compiled;
  }
  return path.resolve(__dirname, '../../src/jobs/snippets/pythonSnippetAnalyzer.py');
}

async function createTempSnippet(snippet: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-python-snippet-'));
  const filePath = path.join(tempDir, `${randomUUID()}.py`);
  await fs.writeFile(filePath, snippet, 'utf8');
  return {
    path: filePath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

export async function analyzePythonSnippet(snippet: string, options?: { timeoutMs?: number }): Promise<PythonSnippetAnalysis> {
  if (!snippet.trim()) {
    throw new PythonSnippetAnalysisError('Snippet cannot be empty');
  }

  const analyzerPath = resolveAnalyzerPath();
  const { path: snippetPath, cleanup } = await createTempSnippet(snippet);
  try {
    const analysis = await runAnalyzer(analyzerPath, snippetPath, options);
    if (!analysis.ok) {
      throw new PythonSnippetAnalysisError(analysis.error?.message ?? 'Snippet analysis failed');
    }
    if (!analysis.handlerName || !analysis.inputModel || !analysis.outputModel) {
      throw new PythonSnippetAnalysisError('Analyzer returned incomplete metadata');
    }
    return {
      handlerName: analysis.handlerName,
      handlerIsAsync: Boolean(analysis.handlerIsAsync),
      inputModel: {
        name: String(analysis.inputModel.name || ''),
        schema: analysis.inputModel.schema as JsonValue
      },
      outputModel: {
        name: String(analysis.outputModel.name || ''),
        schema: analysis.outputModel.schema as JsonValue
      }
    } satisfies PythonSnippetAnalysis;
  } finally {
    await cleanup();
  }
}

type AnalyzerSuccess = {
  ok: true;
  handlerName: string;
  handlerIsAsync?: boolean;
  inputModel: {
    name: string;
    schema: JsonValue;
  };
  outputModel: {
    name: string;
    schema: JsonValue;
  };
};

type AnalyzerFailure = {
  ok: false;
  error?: {
    message?: string;
    details?: string;
  };
};

type AnalyzerPayload = AnalyzerSuccess | AnalyzerFailure;

async function runAnalyzer(scriptPath: string, snippetPath: string, options?: { timeoutMs?: number }): Promise<AnalyzerPayload> {
  return new Promise<AnalyzerPayload>((resolve, reject) => {
    const child = spawn('python3', [scriptPath, snippetPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timeoutMs = Math.max(1_000, Math.min(options?.timeoutMs ?? 10_000, 60_000));
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new PythonSnippetAnalysisError('Snippet analysis timed out'));
    }, timeoutMs);

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', () => {
      clearTimeout(timeout);
      if (!stdout.trim()) {
        if (stderr.trim()) {
          return reject(new PythonSnippetAnalysisError(stderr.trim()));
        }
        return reject(new PythonSnippetAnalysisError('Analyzer produced no output'));
      }
      try {
        const payload = JSON.parse(stdout) as AnalyzerPayload;
        resolve(payload);
      } catch (err) {
        reject(
          new PythonSnippetAnalysisError(
            `Failed to parse analyzer output: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    });
  });
}
