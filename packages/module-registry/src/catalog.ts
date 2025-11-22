import fs from 'node:fs';
import path from 'node:path';

export type ModuleCatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  workspacePath: string;
  workspaceName: string;
};

const DEFAULT_MODULE_CATALOG: ModuleCatalogEntry[] = [
  {
    id: 'observatory',
    displayName: 'Observatory Module',
    description: 'Observatory ingest and analytics scenario implemented with the module toolkit.',
    workspacePath: 'modules/observatory',
    workspaceName: '@apphub/observatory-module'
  }
];

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function titleize(id: string): string {
  const cleaned = id.replace(/[-_]+/g, ' ').trim();
  if (!cleaned) {
    return id;
  }
  return cleaned
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function coerceEntry(raw: unknown, index: number): ModuleCatalogEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const workspacePath = toNonEmptyString(source.workspacePath);
  if (!workspacePath) {
    return null;
  }
  const fallbackId = toNonEmptyString(source.id) ?? `module-${index + 1}`;
  const normalizedId = fallbackId.trim().toLowerCase();
  const workspaceName =
    toNonEmptyString(source.workspaceName) ??
    (path.basename(workspacePath) || normalizedId);
  const displayName =
    toNonEmptyString(source.displayName) ?? titleize(normalizedId) ?? 'AppHub module';

  return {
    id: normalizedId,
    displayName,
    description: toNonEmptyString(source.description) ?? '',
    workspacePath,
    workspaceName
  };
}

function parseInlineCatalog(value: string): ModuleCatalogEntry[] | null {
  try {
    const parsed = JSON.parse(value);
    const moduleArray = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.modules)
        ? ((parsed as Record<string, unknown>).modules as unknown[])
        : null;

    if (moduleArray) {
      const entries: ModuleCatalogEntry[] = [];
      moduleArray.forEach((candidate, index) => {
        const entry = coerceEntry(candidate, index);
        if (entry) {
          entries.push(entry);
        }
      });
      return entries.length > 0 ? entries : null;
    }
  } catch {
    // fall through to a lightweight CSV-style parser
  }

  const specs = value
    .split(/[\n,]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (specs.length === 0) {
    return null;
  }

  const entries: ModuleCatalogEntry[] = [];
  for (const [index, spec] of specs.entries()) {
    const [idPart, pathPart] = spec.includes('=')
      ? spec.split('=', 2).map((piece) => piece.trim())
      : [null, spec];

    const workspacePath = pathPart && pathPart.trim();
    if (!workspacePath) {
      continue;
    }
    const normalizedId = (idPart && idPart.trim().toLowerCase()) || path.basename(workspacePath);
    entries.push({
      id: normalizedId,
      displayName: titleize(normalizedId),
      description: '',
      workspacePath,
      workspaceName: normalizedId
    });
  }

  return entries.length > 0 ? entries : null;
}

function loadEnvModuleCatalog(): ModuleCatalogEntry[] | null {
  const filePath = toNonEmptyString(process.env.APPHUB_MODULE_CATALOG_FILE);
  if (filePath) {
    try {
      const payload = fs.readFileSync(filePath, 'utf8');
      const parsed = parseInlineCatalog(payload);
      if (parsed?.length) {
        return parsed;
      }
    } catch {
      // ignore and fall back to inline/env defaults
    }
  }

  const inline = toNonEmptyString(process.env.APPHUB_MODULE_CATALOG);
  if (inline) {
    const parsed = parseInlineCatalog(inline);
    if (parsed?.length) {
      return parsed;
    }
  }

  return null;
}

function getModuleCatalog(): ModuleCatalogEntry[] {
  const envCatalog = loadEnvModuleCatalog();
  const source = envCatalog && envCatalog.length > 0 ? envCatalog : DEFAULT_MODULE_CATALOG;
  return source.map((entry) => ({ ...entry }));
}

export function listModules(): ModuleCatalogEntry[] {
  return getModuleCatalog();
}

export function getModuleById(id: string): ModuleCatalogEntry | null {
  const normalized = id.trim().toLowerCase();
  const entry = getModuleCatalog().find((candidate) => candidate.id === normalized);
  return entry ? { ...entry } : null;
}
