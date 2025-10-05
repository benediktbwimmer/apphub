/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_53 = {
  id: string;
  bundleId: string;
  slug: string;
  version: string;
  /**
   * SHA-256 checksum of the stored artifact.
   */
  checksum: string;
  /**
   * Capability flags declared by the bundle.
   */
  capabilityFlags: Array<string>;
  /**
   * Indicates whether further edits to this version are allowed.
   */
  immutable: boolean;
  /**
   * Lifecycle status of the bundle version.
   */
  status: string;
  artifact: {
    /**
     * Where the bundle artifact is stored.
     */
    storage: string;
    /**
     * MIME type reported for the bundle artifact.
     */
    contentType: string;
    /**
     * Size of the bundle artifact in bytes.
     */
    size: number;
  };
  manifest?: ((string | number | boolean | Record<string, any>) | null);
  metadata: ((string | number | boolean | Record<string, any>) | null);
  publishedBy?: any | null;
  publishedAt?: string | null;
  deprecatedAt?: string | null;
  replacedAt?: string | null;
  replacedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  download?: {
    url: string;
    expiresAt: string;
    storage: string;
    kind: string;
  };
};

