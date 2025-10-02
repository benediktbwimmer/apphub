export type ModuleServiceRegistrationDefinition = {
  basePath?: string;
  tags?: string[];
  defaultPort?: number | null;
  metadata?: Record<string, unknown> | null;
  ui?: Record<string, unknown> | null;
  envTemplate?: Record<string, string> | null;
};

export type ModuleServiceRuntimeDefinition = {
  host: string;
  port: number;
  baseUrl: string;
  healthEndpoint: string;
  env: Record<string, string>;
};

export type ModuleServiceTargetDefinition = {
  name: string;
  version?: string | null;
  fingerprint?: string | null;
};

export type ModuleServiceArtifactDefinition = {
  path: string;
  storage: string;
  checksum: string;
};

export interface ModuleServiceDefinition {
  slug: string;
  displayName?: string | null;
  description?: string | null;
  kind: string;
  moduleId: string;
  moduleVersion: string;
  target: ModuleServiceTargetDefinition;
  artifact: ModuleServiceArtifactDefinition;
  runtime: ModuleServiceRuntimeDefinition;
  registration?: ModuleServiceRegistrationDefinition;
}
