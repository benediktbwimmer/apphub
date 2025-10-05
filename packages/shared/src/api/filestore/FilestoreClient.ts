/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BaseHttpRequest } from './core/BaseHttpRequest';
import type { OpenAPIConfig } from './core/OpenAPI';
import { FetchHttpRequest } from './core/FetchHttpRequest';
import { BackendMountsService } from './services/BackendMountsService';
import { EventsService } from './services/EventsService';
import { FilesService } from './services/FilesService';
import { NodesService } from './services/NodesService';
import { ReconciliationService } from './services/ReconciliationService';
import { SystemService } from './services/SystemService';
type HttpRequestConstructor = new (config: OpenAPIConfig) => BaseHttpRequest;
export class FilestoreClient {
  public readonly backendMounts: BackendMountsService;
  public readonly events: EventsService;
  public readonly files: FilesService;
  public readonly nodes: NodesService;
  public readonly reconciliation: ReconciliationService;
  public readonly system: SystemService;
  public readonly request: BaseHttpRequest;
  constructor(config?: Partial<OpenAPIConfig>, HttpRequest: HttpRequestConstructor = FetchHttpRequest) {
    this.request = new HttpRequest({
      BASE: config?.BASE ?? 'http://localhost:4300',
      VERSION: config?.VERSION ?? '1.0.0',
      WITH_CREDENTIALS: config?.WITH_CREDENTIALS ?? false,
      CREDENTIALS: config?.CREDENTIALS ?? 'include',
      TOKEN: config?.TOKEN,
      USERNAME: config?.USERNAME,
      PASSWORD: config?.PASSWORD,
      HEADERS: config?.HEADERS,
      ENCODE_PATH: config?.ENCODE_PATH,
    });
    this.backendMounts = new BackendMountsService(this.request);
    this.events = new EventsService(this.request);
    this.files = new FilesService(this.request);
    this.nodes = new NodesService(this.request);
    this.reconciliation = new ReconciliationService(this.request);
    this.system = new SystemService(this.request);
  }
}

