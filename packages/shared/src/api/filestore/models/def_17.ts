/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_17 = {
  /**
   * Preferred download strategy for the file.
   */
  mode: 'stream' | 'presign';
  /**
   * URL to stream the file through the filestore service.
   */
  streamUrl: string;
  /**
   * Link to request a presigned download if supported.
   */
  presignUrl: string | null;
  /**
   * Indicates whether byte-range requests are supported.
   */
  supportsRange: boolean;
  /**
   * Known size of the file when available.
   */
  sizeBytes: number | null;
  /**
   * Checksum recorded for the file content.
   */
  checksum: string | null;
  /**
   * Content hash recorded for the file content.
   */
  contentHash: string | null;
  /**
   * Suggested filename for downloads.
   */
  filename: string | null;
};

