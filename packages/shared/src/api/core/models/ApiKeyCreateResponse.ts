/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_71 } from './def_71';
export type ApiKeyCreateResponse = {
  data: {
    key: def_71;
    /**
     * Full API key token. This value is only returned once at creation time.
     */
    token: string;
  };
};

