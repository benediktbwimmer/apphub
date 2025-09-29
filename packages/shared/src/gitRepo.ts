import { promises as fs } from 'node:fs';
import path from 'node:path';

export type LocalRepoResolution = {
  repoRoot: string;
  sourceLabelBase: string;
  commit: string | null;
};

export type LocalRepoOverrideOptions = {
  allowedRemotes?: string[];
  candidateRoots?: string[];
  requireExamplesDir?: boolean;
};

const DEFAULT_REMOTE_ALLOWLIST = [
  'https://github.com/benediktbwimmer/apphub.git',
  'git@github.com:benediktbwimmer/apphub.git'
];

function parseList(value?: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function normalizeRepoRemote(repoUrl: string): string | null {
  const trimmed = repoUrl.trim();
  if (!trimmed) {
    return null;
  }
  const withoutPrefix = trimmed.replace(/^git\+/, '');

  if (withoutPrefix.startsWith('git@')) {
    const match = withoutPrefix.match(/^git@([^:]+):(.+)$/);
    if (!match) {
      return null;
    }
    const host = match[1].toLowerCase();
    const pathPart = match[2].replace(/\.git$/i, '').replace(/^\/+/, '').replace(/\/+$/, '');
    return `${host}/${pathPart.toLowerCase()}`;
  }

  try {
    const url = new URL(withoutPrefix);
    const host = url.host.toLowerCase();
    const pathname = url.pathname.replace(/\.git$/i, '').replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
    return pathname ? `${host}/${pathname}` : host;
  } catch {
    return withoutPrefix.replace(/\.git$/i, '').replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
  }
}

async function directoryContainsExamples(dir: string): Promise<boolean> {
  try {
    const stats = await fs.stat(path.join(dir, 'examples'));
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function buildAllowedRemotes(options: LocalRepoOverrideOptions): Set<string> {
  const remotes = new Set<string>();
  for (const candidate of DEFAULT_REMOTE_ALLOWLIST) {
    const normalized = normalizeRepoRemote(candidate);
    if (normalized) {
      remotes.add(normalized);
    }
  }
  for (const candidate of parseList(process.env.APPHUB_LOCAL_REPO_REMOTES)) {
    const normalized = normalizeRepoRemote(candidate);
    if (normalized) {
      remotes.add(normalized);
    }
  }
  for (const candidate of options.allowedRemotes ?? []) {
    const normalized = normalizeRepoRemote(candidate);
    if (normalized) {
      remotes.add(normalized);
    }
  }
  return remotes;
}

function buildCandidateRoots(options: LocalRepoOverrideOptions): string[] {
  const candidates = new Set<string>();

  for (const entry of parseList(process.env.APPHUB_LOCAL_REPO_ROOTS)) {
    candidates.add(path.resolve(entry));
  }
  if (process.env.APPHUB_REPO_ROOT) {
    candidates.add(path.resolve(process.env.APPHUB_REPO_ROOT));
  }
  for (const entry of options.candidateRoots ?? []) {
    candidates.add(path.resolve(entry));
  }

  candidates.add(process.cwd());
  candidates.add(path.resolve(process.cwd(), '..'));
  candidates.add(path.resolve(__dirname, '..', '..', '..'));
  candidates.add(path.resolve(__dirname, '..', '..', '..', '..'));

  const resolved: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const normalized = path.resolve(candidate);
    const root = path.parse(normalized).root;
    if (normalized === root) {
      continue;
    }
    resolved.push(normalized);
  }
  return resolved;
}

export async function readGitHeadCommit(repoRoot: string): Promise<string | null> {
  const headPath = path.join(repoRoot, '.git', 'HEAD');
  try {
    const headContents = await fs.readFile(headPath, 'utf8');
    const refMatch = headContents.match(/^ref:\s*(.+)$/m);
    if (refMatch) {
      const refPath = path.join(repoRoot, '.git', refMatch[1]);
      const refContents = await fs.readFile(refPath, 'utf8');
      const sha = refContents.trim();
      return sha.length > 0 ? sha : null;
    }
    const directSha = headContents.trim();
    return directSha.length > 0 ? directSha : null;
  } catch {
    return null;
  }
}

export async function resolveLocalRepoOverride(
  repoUrl: string | null | undefined,
  options: LocalRepoOverrideOptions = {}
): Promise<LocalRepoResolution | null> {
  if (!repoUrl) {
    return null;
  }

  const normalizedRemote = normalizeRepoRemote(repoUrl);
  if (!normalizedRemote) {
    return null;
  }

  const allowedRemotes = buildAllowedRemotes(options);
  if (allowedRemotes.size > 0 && !allowedRemotes.has(normalizedRemote)) {
    return null;
  }

  const candidateRoots = buildCandidateRoots(options);
  for (const candidate of candidateRoots) {
    try {
      const stats = await fs.stat(candidate);
      if (!stats.isDirectory()) {
        continue;
      }

      if (options.requireExamplesDir !== false) {
        const hasExamples = await directoryContainsExamples(candidate);
        if (!hasExamples) {
          continue;
        }
      }

      const commit = await readGitHeadCommit(candidate);
      const baseLabel = `path:${candidate}`;
      return {
        repoRoot: candidate,
        sourceLabelBase: commit ? `${baseLabel}#${commit}` : baseLabel,
        commit
      } satisfies LocalRepoResolution;
    } catch {
      continue;
    }
  }

  return null;
}
