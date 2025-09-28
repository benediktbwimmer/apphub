declare module '@google-cloud/storage' {
  export type StorageOptions = any;
  export type Bucket = any;
  export class Storage {
    constructor(options?: StorageOptions);
    bucket(name: string): Bucket;
  }
}

declare module '@azure/storage-blob' {
  export class StorageSharedKeyCredential {
    constructor(...args: any[]);
  }
  export class ContainerClient {
    constructor(...args: any[]);
    getBlockBlobClient(name: string): any;
  }
  export class BlobServiceClient {
    constructor(...args: any[]);
    static fromConnectionString(connectionString: string, credential?: StorageSharedKeyCredential): BlobServiceClient;
    getContainerClient(name: string): ContainerClient;
  }
}

declare module 's3rver' {
  interface S3rverOptions {
    address?: string;
    port?: number;
    silent?: boolean;
    resetOnClose?: boolean;
    directory?: string;
    allowMismatchedSignatures?: boolean;
    configureBuckets?: Array<{ name: string; configs?: Array<string | Buffer> }>;
  }

  export default class S3rver {
    constructor(options?: S3rverOptions);
    run(): Promise<unknown>;
    close(): Promise<void>;
  }
}
