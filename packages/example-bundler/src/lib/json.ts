import path from 'node:path';
import { promises as fs } from 'node:fs';

export async function readJsonFile<T>(targetPath: string): Promise<T> {
  const buffer = await fs.readFile(targetPath, 'utf8');
  return JSON.parse(buffer) as T;
}

export async function writeJsonFile(targetPath: string, value: unknown): Promise<void> {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, json, 'utf8');
}
