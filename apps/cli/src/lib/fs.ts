import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function readFile(targetPath: string): Promise<Buffer> {
  return fs.readFile(targetPath);
}

export async function writeFile(targetPath: string, data: string | NodeJS.ArrayBufferView): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, data);
}

export async function removeDir(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
