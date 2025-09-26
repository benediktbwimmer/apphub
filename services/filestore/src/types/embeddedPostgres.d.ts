declare module 'embedded-postgres' {
  interface EmbeddedPostgresOptions {
    databaseDir?: string;
    port?: number;
    user?: string;
    password?: string;
    persistent?: boolean;
    initdbFlags?: string[];
    postgresFlags?: string[];
    onLog?: (message: string) => void;
    onError?: (error: Error | string) => void;
  }

  export default class EmbeddedPostgres {
    constructor(options?: EmbeddedPostgresOptions);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
  }
}
