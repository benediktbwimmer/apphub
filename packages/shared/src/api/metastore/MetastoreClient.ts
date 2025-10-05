/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BaseHttpRequest } from './core/BaseHttpRequest';
import type { OpenAPIConfig } from './core/OpenAPI';
import { FetchHttpRequest } from './core/FetchHttpRequest';
import { FilestoreService } from './services/FilestoreService';
import { NamespacesService } from './services/NamespacesService';
import { RecordsService } from './services/RecordsService';
import { SchemasService } from './services/SchemasService';
import { StreamsService } from './services/StreamsService';
import { SystemService } from './services/SystemService';
type HttpRequestConstructor = new (config: OpenAPIConfig) => BaseHttpRequest;
export class MetastoreClient {
  public readonly filestore: FilestoreService;
  public readonly namespaces: NamespacesService;
  public readonly records: RecordsService;
  public readonly schemas: SchemasService;
  public readonly streams: StreamsService;
  public readonly system: SystemService;
  public readonly request: BaseHttpRequest;
  constructor(config?: Partial<OpenAPIConfig>, HttpRequest: HttpRequestConstructor = FetchHttpRequest) {
    this.request = new HttpRequest({
      BASE: config?.BASE ?? 'http://127.0.0.1:4100',
      VERSION: config?.VERSION ?? '0.1.0',
      WITH_CREDENTIALS: config?.WITH_CREDENTIALS ?? false,
      CREDENTIALS: config?.CREDENTIALS ?? 'include',
      TOKEN: config?.TOKEN,
      USERNAME: config?.USERNAME,
      PASSWORD: config?.PASSWORD,
      HEADERS: config?.HEADERS,
      ENCODE_PATH: config?.ENCODE_PATH,
    });
    this.filestore = new FilestoreService(this.request);
    this.namespaces = new NamespacesService(this.request);
    this.records = new RecordsService(this.request);
    this.schemas = new SchemasService(this.request);
    this.streams = new StreamsService(this.request);
    this.system = new SystemService(this.request);
  }
}

