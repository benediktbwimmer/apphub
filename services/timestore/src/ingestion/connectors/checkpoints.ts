import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ConnectorCheckpointStore<State> {
  load(defaultState: State): Promise<State>;
  save(state: State): Promise<void>;
}

export class JsonFileCheckpointStore<State extends object> implements ConnectorCheckpointStore<State> {
  constructor(private readonly filePath: string) {}

  async load(defaultState: State): Promise<State> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as State;
      return { ...defaultState, ...parsed };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.warn('[timestore:connectors] failed to read checkpoint', {
          path: this.filePath,
          error: error instanceof Error ? error.message : error
        });
      }
      return defaultState;
    }
  }

  async save(state: State): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true });
    const payload = JSON.stringify(state, null, 2);
    await fs.writeFile(this.filePath, `${payload}\n`, 'utf8');
  }
}

export function defaultCheckpointPath(basePath: string, connectorId: string, suffix: string): string {
  const directory = path.dirname(basePath);
  const fileName = `${path.basename(basePath)}.${connectorId}.${suffix}`;
  return path.join(directory, fileName);
}
