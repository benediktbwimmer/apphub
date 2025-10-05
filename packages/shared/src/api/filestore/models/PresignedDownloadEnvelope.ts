/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type PresignedDownloadEnvelope = {
  data: {
    /**
     * Presigned URL to download the file directly from the backend.
     */
    url: string;
    /**
     * Timestamp when the presigned URL expires.
     */
    expiresAt: string;
    /**
     * HTTP headers that must be supplied when invoking the presigned URL.
     */
    headers: Record<string, string>;
    /**
     * HTTP method to use for the presigned request.
     */
    method: string;
  };
};

