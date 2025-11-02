declare module 'parquetjs-lite' {
  export type ParquetField = {
    type: string;
    optional?: boolean;
    repeated?: boolean;
    compression?: string;
  };

  export type ParquetSchemaDefinition = Record<string, ParquetField>;

  export class ParquetSchema {
    constructor(schema: ParquetSchemaDefinition);
  }

  export type ParquetRow = Record<string, unknown>;

  export class ParquetWriter {
    static openFile(schema: ParquetSchema, filePath: string, options?: Record<string, unknown>): Promise<ParquetWriter>;
    appendRow(row: ParquetRow): Promise<void>;
    close(): Promise<void>;
  }
}
