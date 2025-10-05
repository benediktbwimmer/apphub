/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_41 } from './def_41';
export type BundleEditorResponse = {
  data: {
    job: def_41;
    binding: {
      /**
       * Slug of the bundle bound to the job.
       */
      slug: string;
      /**
       * Version of the bundle referenced by the job entry point.
       */
      version: string;
      /**
       * Optional export name used when requiring the bundle entry point.
       */
      exportName?: string | null;
    };
    bundle: {
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
      /**
       * Arbitrary JSON value.
       */
      manifest?: (string | number | boolean | Record<string, any>) | null;
      /**
       * Arbitrary JSON value.
       */
      metadata: (string | number | boolean | Record<string, any>) | null;
      publishedBy?: {
        subject: string | null;
        kind: string | null;
        tokenHash: string | null;
      } | null;
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
    editor: {
      /**
       * Relative path of the bundle entry point file.
       */
      entryPoint: string;
      /**
       * Path to the manifest file within the bundle.
       */
      manifestPath: string;
      /**
       * Arbitrary JSON value.
       */
      manifest: (string | number | boolean | Record<string, any>) | null;
      files: Array<{
        /**
         * Relative path of the file inside the bundle.
         */
        path: string;
        /**
         * File contents encoded as UTF-8 text or base64.
         */
        contents: string;
        /**
         * Encoding of the contents value. Defaults to utf8 when omitted.
         */
        encoding?: 'utf8' | 'base64';
        /**
         * Whether the file should be marked as executable in the generated bundle.
         */
        executable?: boolean;
      }>;
    };
    /**
     * Arbitrary JSON value.
     */
    aiBuilder: (string | number | boolean | Record<string, any>) | null;
    /**
     * History of AI generated bundle versions associated with this job.
     */
    history: Array<{
      slug: string;
      version: string;
      /**
       * Checksum of the generated artifact.
       */
      checksum?: string;
      regeneratedAt?: string;
    }>;
    /**
     * Source used to build the current editor suggestion.
     */
    suggestionSource: 'metadata' | 'artifact';
    /**
     * Previously published bundle versions available for selection.
     */
    availableVersions: Array<{
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
      /**
       * Arbitrary JSON value.
       */
      manifest?: (string | number | boolean | Record<string, any>) | null;
      /**
       * Arbitrary JSON value.
       */
      metadata: (string | number | boolean | Record<string, any>) | null;
      publishedBy?: {
        subject: string | null;
        kind: string | null;
        tokenHash: string | null;
      } | null;
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
    }>;
  };
};

