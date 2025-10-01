import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

type ScratchGuardOptions = {
  allowedPrefixes?: string[];
};

function resolvePrefixes(options?: ScratchGuardOptions): string[] {
  const envPrefixes = process.env.APPHUB_SCRATCH_PREFIXES
    ? process.env.APPHUB_SCRATCH_PREFIXES.split(':').map((entry) => entry.trim()).filter(Boolean)
    : [];
  const scratchRoot = process.env.APPHUB_SCRATCH_ROOT?.trim();
  const defaults = scratchRoot ? [scratchRoot] : [`${os.tmpdir()}/apphub-`];
  return [...(options?.allowedPrefixes ?? []), ...envPrefixes, ...defaults]
    .map((prefix) => prefix.replace(/\/+$/, ''))
    .map((prefix) => path.resolve(prefix));
}

function isAllowed(targetPath: string, prefixes: string[]): boolean {
  const resolved = path.resolve(targetPath);
  return prefixes.some((prefix) => resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`));
}

function raise(targetPath: string, prefixes: string[]): never {
  const message = `Writes outside scratch space are not permitted (attempted: ${targetPath}). Allowed prefixes: ${prefixes.join(', ')}`;
  throw new Error(message);
}

type FsPromisifiedMethod = (...args: any[]) => Promise<unknown>;

type FsMethod = (...args: any[]) => unknown;

function wrapPromiseMethod<T extends FsPromisifiedMethod>(method: T, prefixes: string[]): T {
  return (async (...args: Parameters<T>) => {
    const targetArg = args[0];
    if (typeof targetArg === 'string' || Buffer.isBuffer(targetArg) || targetArg instanceof URL) {
      if (!isAllowed(String(targetArg), prefixes)) {
        raise(String(targetArg), prefixes);
      }
    }
    return method.apply(fsPromises, args);
  }) as T;
}

function wrapSyncMethod<T extends FsMethod>(method: T, prefixes: string[]): T {
  return ((...args: Parameters<T>) => {
    const targetArg = args[0];
    if (typeof targetArg === 'string' || Buffer.isBuffer(targetArg) || targetArg instanceof URL) {
      if (!isAllowed(String(targetArg), prefixes)) {
        raise(String(targetArg), prefixes);
      }
    }
    return method.apply(fs, args);
  }) as T;
}

export function enforceScratchOnlyWrites(options?: ScratchGuardOptions): void {
  const prefixes = resolvePrefixes(options);

  (fsPromises as unknown as Record<string, FsPromisifiedMethod>).writeFile = wrapPromiseMethod(fsPromises.writeFile.bind(fsPromises), prefixes);
  (fsPromises as unknown as Record<string, FsPromisifiedMethod>).appendFile = wrapPromiseMethod(fsPromises.appendFile.bind(fsPromises), prefixes);
  (fsPromises as unknown as Record<string, FsPromisifiedMethod>).mkdir = wrapPromiseMethod(fsPromises.mkdir.bind(fsPromises), prefixes);
  (fsPromises as unknown as Record<string, FsPromisifiedMethod>).rm = wrapPromiseMethod(fsPromises.rm.bind(fsPromises), prefixes);
  (fsPromises as unknown as Record<string, FsPromisifiedMethod>).rmdir = wrapPromiseMethod(fsPromises.rmdir.bind(fsPromises), prefixes);
  (fsPromises as unknown as Record<string, FsPromisifiedMethod>).rename = wrapPromiseMethod(fsPromises.rename.bind(fsPromises), prefixes);
  (fsPromises as unknown as Record<string, FsPromisifiedMethod>).copyFile = wrapPromiseMethod(fsPromises.copyFile.bind(fsPromises), prefixes);

  (fs as unknown as Record<string, FsMethod>).writeFileSync = wrapSyncMethod(fs.writeFileSync.bind(fs), prefixes);
  (fs as unknown as Record<string, FsMethod>).appendFileSync = wrapSyncMethod(fs.appendFileSync.bind(fs), prefixes);
  (fs as unknown as Record<string, FsMethod>).mkdirSync = wrapSyncMethod(fs.mkdirSync.bind(fs), prefixes);
  (fs as unknown as Record<string, FsMethod>).rmSync = wrapSyncMethod(fs.rmSync.bind(fs), prefixes);
  (fs as unknown as Record<string, FsMethod>).rmdirSync = wrapSyncMethod(fs.rmdirSync.bind(fs), prefixes);
  (fs as unknown as Record<string, FsMethod>).renameSync = wrapSyncMethod(fs.renameSync.bind(fs), prefixes);
  (fs as unknown as Record<string, FsMethod>).copyFileSync = wrapSyncMethod(fs.copyFileSync.bind(fs), prefixes);

  const originalCreateWriteStream = fs.createWriteStream.bind(fs);
  fs.createWriteStream = ((
    targetPath: fs.PathLike,
    options?: Parameters<typeof fs.createWriteStream>[1]
  ) => {
    if (typeof targetPath === 'string' || targetPath instanceof URL) {
      if (!isAllowed(String(targetPath), prefixes)) {
        raise(String(targetPath), prefixes);
      }
    }
    return originalCreateWriteStream(targetPath, options);
  }) as typeof fs.createWriteStream;
}
