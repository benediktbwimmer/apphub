/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ModuleArtifactUploadRequest = {
  moduleId: string;
  moduleVersion: string;
  displayName?: string | null;
  description?: string | null;
  keywords?: Array<string>;
  manifest: Record<string, any>;
  artifact: {
    filename?: string;
    contentType?: string;
    /**
     * Base64-encoded module bundle contents.
     */
    data: string;
  };
};

