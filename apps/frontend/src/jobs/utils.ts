import type { BundleEditorFile } from './api';

export type FileState = {
  path: string;
  contents: string;
  encoding: 'utf8' | 'base64';
  executable: boolean;
  readOnly: boolean;
};

export type EditorBaseline = {
  files: FileState[];
  manifestText: string;
  manifestPath: string;
  entryPoint: string;
  capabilityFlags: string[];
};

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function normalizeCapabilityFlags(raw: string): string[] {
  const entries = raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return normalizeCapabilityFlagArray(entries);
}

export function normalizeCapabilityFlagArray(flags: string[]): string[] {
  const unique = new Map<string, string>();
  for (const flag of flags) {
    const trimmed = flag.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  }
  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
}

export function inferLanguage(path: string | null | undefined): string {
  if (!path) {
    return 'plaintext';
  }
  if (path.endsWith('.json')) {
    return 'json';
  }
  if (path.endsWith('.ts') || path.endsWith('.tsx')) {
    return 'typescript';
  }
  if (path.endsWith('.js') || path.endsWith('.jsx')) {
    return 'javascript';
  }
  if (path.endsWith('.py')) {
    return 'python';
  }
  return 'plaintext';
}

export function buildInitialFiles(files: BundleEditorFile[]): FileState[] {
  return files
    .map((file) => ({
      path: file.path,
      contents: file.contents,
      encoding: file.encoding,
      executable: Boolean(file.executable),
      readOnly: file.encoding !== 'utf8'
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function cloneFileState(file: FileState): FileState {
  return {
    path: file.path,
    contents: file.contents,
    encoding: file.encoding,
    executable: file.executable,
    readOnly: file.readOnly
  };
}

export function filesEqual(a: FileState[], b: FileState[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.path !== right.path ||
      left.contents !== right.contents ||
      left.encoding !== right.encoding ||
      left.executable !== right.executable
    ) {
      return false;
    }
  }
  return true;
}
