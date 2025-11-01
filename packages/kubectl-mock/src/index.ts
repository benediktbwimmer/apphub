import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SCRIPT_SOURCE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const stateFile = process.env.KUBECTL_MOCK_STATE_FILE;
if (!stateFile) {
  console.error('KUBECTL_MOCK_STATE_FILE env var is required for kubectl mock');
  process.exit(1);
}

function loadState() {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        jobs: parsed.jobs ?? {},
        deployments: parsed.deployments ?? {},
        services: parsed.services ?? {},
        ingresses: parsed.ingresses ?? {}
      };
    }
  } catch {}
  return { jobs: {}, deployments: {}, services: {}, ingresses: {} };
}

function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

function parseManifestPayload(payload) {
  if (!payload || typeof payload !== 'string') {
    return [];
  }
  const trimmed = payload.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      return parsed.items;
    }
    return [parsed];
  } catch (err) {
    console.error('kubectl-mock failed to parse manifest:', err);
    process.exit(1);
  }
}

function normalizeKind(value) {
  return String(value ?? '').toLowerCase();
}

function ensureNamespace(stateSection, namespace) {
  if (!stateSection[namespace]) {
    stateSection[namespace] = {};
  }
  return stateSection[namespace];
}

function parseNamespaceAndArgs(argv) {
  let namespace = process.env.KUBECTL_MOCK_DEFAULT_NAMESPACE || 'default';
  const filtered = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--namespace' || token === '-n') {
      namespace = argv[index + 1] ?? namespace;
      index += 1;
      continue;
    }
    filtered.push(token);
  }
  return { namespace, args: filtered };
}

function parseKindName(token, fallbackName) {
  if (!token) {
    return { kind: '', name: '' };
  }
  if (token.includes('/')) {
    const [kind, name] = token.split('/', 2);
    return { kind: kind ?? '', name: name ?? '' };
  }
  return { kind: token, name: fallbackName ?? '' };
}

function handleApply(argv) {
  const { namespace, args } = parseNamespaceAndArgs(argv);
  let manifestIndex = -1;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-f' || token === '--filename') {
      manifestIndex = index + 1;
      break;
    }
  }
  if (manifestIndex === -1) {
    console.error('kubectl-mock apply missing -f');
    process.exit(1);
  }
  const target = args[manifestIndex] ?? '-';
  let payload = '';
  if (target === '-' || !target) {
    payload = fs.readFileSync(0, 'utf8');
  } else {
    payload = fs.readFileSync(path.resolve(target), 'utf8');
  }

  const resources = parseManifestPayload(payload);
  const state = loadState();

  for (const resource of resources) {
    if (!resource || typeof resource !== 'object') {
      continue;
    }
    const metadata = resource.metadata ?? {};
    const kind = normalizeKind(resource.kind);
    const name = String(metadata.name ?? '').trim();
    const resourceNamespace = String(metadata.namespace ?? namespace ?? '').trim() || 'default';
    if (!name) {
      continue;
    }
    switch (kind) {
      case 'job': {
        const jobs = ensureNamespace(state.jobs, resourceNamespace);
        const annotations = (metadata && metadata.annotations) || {};
        const customLogs = typeof annotations['kubectl-mock/logs'] === 'string'
          ? annotations['kubectl-mock/logs']
          : null;
        const defaultLogs = typeof process.env.KUBECTL_MOCK_DEFAULT_LOGS === 'string'
          ? process.env.KUBECTL_MOCK_DEFAULT_LOGS
          : null;
        jobs[name] = {
          status: 'Succeeded',
          logs: customLogs ?? defaultLogs ?? '[kubectl-mock] job ' + name + ' completed\\n',
          manifest: resource
        };
        break;
      }
      case 'deployment': {
        const deployments = ensureNamespace(state.deployments, resourceNamespace);
        deployments[name] = {
          status: 'Available',
          manifest: resource
        };
        break;
      }
      case 'service': {
        const services = ensureNamespace(state.services, resourceNamespace);
        services[name] = {
          manifest: resource
        };
        break;
      }
      case 'ingress': {
        const ingresses = ensureNamespace(state.ingresses, resourceNamespace);
        ingresses[name] = {
          manifest: resource
        };
        break;
      }
      default:
        break;
    }
  }

  saveState(state);
  process.exit(0);
}

function removeResource(state, namespace, collectionKey, name) {
  const collection = state[collectionKey];
  if (!collection) {
    return;
  }
  const scoped = collection[namespace];
  if (!scoped) {
    return;
  }
  delete scoped[name];
}

function handleDelete(argv) {
  const { namespace, args } = parseNamespaceAndArgs(argv);
  const state = loadState();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token || token.startsWith('-')) {
      continue;
    }
    const { kind, name } = parseKindName(token, args[index + 1]);
    const normalizedKind = normalizeKind(kind);
    if (!name) {
      continue;
    }
    switch (normalizedKind) {
      case 'job':
        removeResource(state, namespace, 'jobs', name);
        break;
      case 'deployment':
        removeResource(state, namespace, 'deployments', name);
        break;
      case 'service':
        removeResource(state, namespace, 'services', name);
        break;
      case 'ingress':
        removeResource(state, namespace, 'ingresses', name);
        break;
      default:
        break;
    }
  }
  saveState(state);
  process.exit(0);
}

function handleWait(argv) {
  const { namespace, args } = parseNamespaceAndArgs(argv);
  const state = loadState();
  for (const token of args) {
    if (!token || token.startsWith('-')) {
      continue;
    }
    const { kind, name } = parseKindName(token);
    if (normalizeKind(kind) !== 'job' || !name) {
      continue;
    }
    const jobs = state.jobs?.[namespace];
    const job = jobs?.[name];
    if (job && job.status === 'Succeeded') {
      process.exit(0);
    }
    if (job && job.status === 'Failed') {
      process.exit(1);
    }
  }
  process.exit(1);
}

function handleLogs(argv) {
  const { namespace, args } = parseNamespaceAndArgs(argv);
  const state = loadState();
  for (const token of args) {
    if (!token || token.startsWith('-')) {
      continue;
    }
    const { kind, name } = parseKindName(token);
    if (normalizeKind(kind) !== 'job' || !name) {
      continue;
    }
    const jobs = state.jobs?.[namespace];
    const job = jobs?.[name];
    const logs = job?.logs ?? ('[kubectl-mock] no logs for job ' + name + '\\n');
    process.stdout.write(logs);
    process.exit(0);
  }
  process.exit(1);
}

function handleRollout(argv) {
  if (argv[0] !== 'status') {
    process.exit(0);
  }
  const { namespace, args } = parseNamespaceAndArgs(argv.slice(1));
  const state = loadState();
  for (const token of args) {
    if (!token || token.startsWith('-')) {
      continue;
    }
    const { kind, name } = parseKindName(token);
    if (normalizeKind(kind) !== 'deployment' || !name) {
      continue;
    }
    const deployments = state.deployments?.[namespace];
    const deployment = deployments?.[name];
    if (deployment) {
      process.exit(0);
    }
  }
  process.exit(1);
}

function handleGet(argv) {
  const { namespace, args } = parseNamespaceAndArgs(argv);
  if (args.length === 0) {
    process.exit(1);
  }
  const primary = args[0];
  const { kind, name } = parseKindName(primary, args[1]);
  const normalizedKind = normalizeKind(kind);
  const wantsJson = args.includes('-o') && args.includes('json');
  const state = loadState();

  function emitJson(payload) {
    process.stdout.write(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  switch (normalizedKind) {
    case 'job': {
      const jobs = state.jobs?.[namespace] ?? {};
      const entry = name ? jobs[name] : null;
      if (wantsJson) {
        emitJson({
          metadata: { name, namespace },
          status: entry ? { succeeded: entry.status === 'Succeeded' ? 1 : 0 } : {}
        });
      }
      process.exit(entry ? 0 : 1);
      break;
    }
    case 'deployment': {
      const deployments = state.deployments?.[namespace] ?? {};
      const entry = name ? deployments[name] : null;
      if (wantsJson) {
        emitJson({ metadata: { name, namespace }, status: entry ? { availableReplicas: 1 } : {} });
      }
      process.exit(entry ? 0 : 1);
      break;
    }
    default:
      process.exit(0);
  }
}

(function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.exit(0);
  }
  const command = argv[0];
  const rest = argv.slice(1);
  switch (command) {
    case 'apply':
      handleApply(rest);
      break;
    case 'delete':
      handleDelete(rest);
      break;
    case 'wait':
      handleWait(rest);
      break;
    case 'logs':
      handleLogs(rest);
      break;
    case 'rollout':
      handleRollout(rest);
      break;
    case 'get':
      handleGet(rest);
      break;
    default:
      process.exit(0);
  }
})();
`;

export class KubectlMock {
  private tempDir: string | null = null;
  private running = false;
  private previousStateEnv: string | undefined;
  private stateFile: string | null = null;

  async start(): Promise<{ pathPrefix: string }> {
    if (this.running) {
      throw new Error('KubectlMock already running');
    }

    const dir = await mkdtemp(path.join(os.tmpdir(), 'kubectl-mock-'));
    this.tempDir = dir;
    this.stateFile = path.join(dir, 'state.json');
    await writeFile(this.stateFile, JSON.stringify({ jobs: {}, deployments: {}, services: {}, ingresses: {} }), 'utf8');

    const scriptPath = path.join(dir, 'kubectl');
    await writeFile(scriptPath, SCRIPT_SOURCE, 'utf8');
    await chmod(scriptPath, 0o755);

    this.previousStateEnv = process.env.KUBECTL_MOCK_STATE_FILE;
    process.env.KUBECTL_MOCK_STATE_FILE = this.stateFile;

    this.running = true;
    return { pathPrefix: dir };
  }

  async stop(): Promise<void> {
    if (this.previousStateEnv === undefined) {
      delete process.env.KUBECTL_MOCK_STATE_FILE;
    } else {
      process.env.KUBECTL_MOCK_STATE_FILE = this.previousStateEnv;
    }
    this.previousStateEnv = undefined;

    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true });
      this.tempDir = null;
    }
    this.stateFile = null;
    this.running = false;
  }
}
