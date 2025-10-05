/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_10 } from './def_10';
import type { def_6 } from './def_6';
import type { def_7 } from './def_7';
export type def_13 = {
  data: {
    /**
     * Repository identifier.
     */
    id: string;
    name: string;
    description: string;
    /**
     * Git or HTTP URL where the repository is hosted.
     */
    repoUrl: string;
    dockerfilePath: string;
    updatedAt: string;
    ingestStatus: 'seed' | 'pending' | 'processing' | 'ready' | 'failed';
    ingestError?: string | null;
    ingestAttempts: number;
    latestBuild?: (def_6 | null);
    latestLaunch?: (def_7 | null);
    previewTiles: Array<{
      id: string;
      kind: string;
      title: string | null;
      description: string | null;
      src: string | null;
      embedUrl: string | null;
      posterUrl: string | null;
      width: number | null;
      height: number | null;
      sortOrder: number;
      source: string;
    }>;
    tags: Array<{
      /**
       * Tag key.
       */
      key: string;
      /**
       * Tag value.
       */
      value: string;
    }>;
    /**
     * Template environment variables suggested when launching the app.
     */
    launchEnvTemplates: Array<{
      /**
       * Environment variable name.
       */
      key: string;
      /**
       * Environment variable value.
       */
      value: string;
    }>;
    relevance?: (def_10 | null);
  };
};

