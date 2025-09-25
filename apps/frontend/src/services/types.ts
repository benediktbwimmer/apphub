export type ServiceManifestMetadata = {
  source?: string | null;
  sources?: string[];
  baseUrlSource?: 'manifest' | 'runtime' | 'config' | null;
  openapiPath?: string | null;
  healthEndpoint?: string | null;
  workingDir?: string | null;
  devCommand?: string | null;
  env?: unknown;
  apps?: string[];
  appliedAt?: string;
};

export type ServiceRuntimeMetadata = {
  repositoryId?: string;
  launchId?: string | null;
  instanceUrl?: string | null;
  baseUrl?: string | null;
  previewUrl?: string | null;
  host?: string | null;
  port?: number | null;
  containerIp?: string | null;
  containerPort?: number | null;
  containerBaseUrl?: string | null;
  source?: string | null;
  status?: 'running' | 'stopped';
  updatedAt?: string | null;
};

export type ServiceMetadata = {
  resourceType?: 'service';
  manifest?: ServiceManifestMetadata | null;
  config?: unknown;
  runtime?: ServiceRuntimeMetadata | null;
  linkedApps?: string[] | null;
  notes?: string | null;
};

export type ServiceSummary = {
  id: string;
  slug: string;
  displayName: string | null;
  kind: string | null;
  baseUrl: string | null;
  status: string;
  statusMessage: string | null;
  capabilities: unknown;
  metadata: ServiceMetadata | null;
  lastHealthyAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ServicesResponseSuccess = {
  data?: ServiceSummary[];
};

type ServicesResponseError = {
  error?: unknown;
};

export type ServicesResponse = ServicesResponseSuccess | ServicesResponseError;
