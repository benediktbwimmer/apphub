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
