/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { BaseHttpRequest } from './core/BaseHttpRequest';
import type { OpenAPIConfig } from './core/OpenAPI';
import { FetchHttpRequest } from './core/FetchHttpRequest';
import { AppsService } from './services/AppsService';
import { AuthService } from './services/AuthService';
import { DefaultService } from './services/DefaultService';
import { EventsService } from './services/EventsService';
import { JobsService } from './services/JobsService';
import { ModulesService } from './services/ModulesService';
import { SavedSearchesService } from './services/SavedSearchesService';
import { ServicesService } from './services/ServicesService';
import { SystemService } from './services/SystemService';
import { WorkflowsService } from './services/WorkflowsService';
type HttpRequestConstructor = new (config: OpenAPIConfig) => BaseHttpRequest;
export class CoreClient {
  public readonly apps: AppsService;
  public readonly auth: AuthService;
  public readonly default: DefaultService;
  public readonly events: EventsService;
  public readonly jobs: JobsService;
  public readonly modules: ModulesService;
  public readonly savedSearches: SavedSearchesService;
  public readonly services: ServicesService;
  public readonly system: SystemService;
  public readonly workflows: WorkflowsService;
  public readonly request: BaseHttpRequest;
  constructor(config?: Partial<OpenAPIConfig>, HttpRequest: HttpRequestConstructor = FetchHttpRequest) {
    this.request = new HttpRequest({
      BASE: config?.BASE ?? 'http://127.0.0.1:4000',
      VERSION: config?.VERSION ?? '1.0.0',
      WITH_CREDENTIALS: config?.WITH_CREDENTIALS ?? false,
      CREDENTIALS: config?.CREDENTIALS ?? 'include',
      TOKEN: config?.TOKEN,
      USERNAME: config?.USERNAME,
      PASSWORD: config?.PASSWORD,
      HEADERS: config?.HEADERS,
      ENCODE_PATH: config?.ENCODE_PATH,
    });
    this.apps = new AppsService(this.request);
    this.auth = new AuthService(this.request);
    this.default = new DefaultService(this.request);
    this.events = new EventsService(this.request);
    this.jobs = new JobsService(this.request);
    this.modules = new ModulesService(this.request);
    this.savedSearches = new SavedSearchesService(this.request);
    this.services = new ServicesService(this.request);
    this.system = new SystemService(this.request);
    this.workflows = new WorkflowsService(this.request);
  }
}

