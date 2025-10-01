"use strict";

const { promises: fs } = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 120000;

function resolveProxyUrl() {
  const raw = process.env.APPHUB_CODEX_PROXY_URL;
  const base = raw && raw.trim().length > 0 ? raw.trim() : "http://host.docker.internal:3030";
  return base.replace(/\/$/, "");
}

function resolveProxyHeaders() {
  const headers = {
    "content-type": "application/json",
    "x-apphub-source": "ai-orchestrator-handler"
  };
  const token = process.env.APPHUB_CODEX_PROXY_TOKEN;
  if (token && token.trim().length > 0) {
    headers.authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

async function ensureFetch() {
  if (typeof fetch === "function") {
    return fetch;
  }
  throw new Error("Fetch API is not available in this runtime. Node.js 18+ is required.");
}

async function invokeProxy(options) {
  const doFetch = await ensureFetch();
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs + 5000);

  try {
    const response = await doFetch(`${resolveProxyUrl()}/v1/codex/generate`, {
      method: "POST",
      headers: resolveProxyHeaders(),
      body: JSON.stringify({
        mode: options.mode,
        operatorRequest: options.prompt,
        metadataSummary: options.metadataSummary,
        additionalNotes: options.notes ?? null,
        timeoutMs
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      let detail;
      try {
        detail = await response.json();
      } catch {
        detail = await response.text();
      }
      const message = detail && typeof detail === "object" ? JSON.stringify(detail) : String(detail);
      throw new Error(`Codex proxy request failed (${response.status}): ${message}`);
    }

    return response.json();
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error("Codex proxy request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
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

  const response = await invokeProxy(options);
  if (!response || typeof response.output !== 'string') {
    throw new Error('Codex proxy returned an invalid payload');
  }

  return {
    raw: response.output,
    stdout: typeof response.stdout === 'string' ? response.stdout : '',
    stderr: typeof response.stderr === 'string' ? response.stderr : '',
    summary: typeof response.summary === 'string' ? response.summary : ''
  };
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
