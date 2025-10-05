/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * Metadata sourced from service manifests and configuration files.
 */
export type ServiceManifestMetadata = {
  /**
   * Location of the manifest entry that populated this service.
   */
  source?: string | null;
  /**
   * All manifest files that contributed to this service definition.
   */
  sources?: Array<string>;
  /**
   * Whether the manifest, runtime state, or config file selected the effective base URL.
   */
  baseUrlSource?: 'manifest' | 'runtime' | 'config' | null;
  openapiPath?: string | null;
  healthEndpoint?: string | null;
  workingDir?: string | null;
  devCommand?: string | null;
  /**
   * Environment variables declared for the service in manifests, including placeholder metadata.
   */
  env?: (string | number | boolean | Record<string, any>) | null | null;
  /**
   * IDs of apps that are linked to this service through service networks.
   */
  apps?: Array<string> | null;
  /**
   * Timestamp indicating when this manifest version was applied.
   */
  appliedAt?: string;
};

