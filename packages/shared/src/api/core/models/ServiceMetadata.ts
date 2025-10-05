/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_31 } from './def_31';
import type { def_32 } from './def_32';
/**
 * Structured metadata describing how a service is sourced, linked, and executed.
 */
export type ServiceMetadata = {
  /**
   * Discriminator indicating this metadata payload represents a service resource.
   */
  resourceType?: 'service';
  manifest?: def_31 | null;
  /**
   * Raw metadata block forwarded from manifests or config files.
   */
  config?: (string | number | boolean | Record<string, any>) | null | null;
  runtime?: def_32 | null;
  /**
   * Explicit list of app IDs linked to this service beyond manifest hints.
   */
  linkedApps?: Array<string> | null;
  notes?: string | null;
};

