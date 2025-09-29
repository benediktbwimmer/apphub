declare module 'chokidar' {
  export interface Watcher {
    add(paths: string | readonly string[]): void;
    close(): Promise<void>;
    on(event: 'add', callback: (path: string) => void): this;
    on(event: 'change', callback: (path: string) => void): this;
    on(event: 'error', callback: (error: Error) => void): this;
    on(event: 'ready', callback: () => void): this;
  }

  export interface WatchOptions {
    ignoreInitial?: boolean;
    awaitWriteFinish?: {
      stabilityThreshold?: number;
      pollInterval?: number;
    };
    depth?: number;
  }

  export function watch(paths: string | readonly string[], options?: WatchOptions): Watcher;

  const chokidar: {
    watch: typeof watch;
  };

  export default chokidar;
}
