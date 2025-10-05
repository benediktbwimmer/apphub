/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_28 = {
  /**
   * Lowercase identifier for the app (letters, numbers, and dashes).
   */
  id: string;
  /**
   * Human readable name for the app.
   */
  name: string;
  /**
   * Short description that appears in the core.
   */
  description: string;
  /**
   * Location of the repository. Supports git, HTTP(S), and absolute filesystem paths.
   */
  repoUrl: string;
  /**
   * Repository-relative path to the Dockerfile (e.g. services/api/Dockerfile).
   */
  dockerfilePath: string;
  /**
   * Optional tags to associate with the repository.
   */
  tags?: Array<{
    /**
     * Tag key.
     */
    key: string;
    /**
     * Tag value.
     */
    value: string;
  }>;
};

