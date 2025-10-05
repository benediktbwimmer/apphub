/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_73 } from './def_73';
export type ApiKeyCreateResponse = {
  data: {
    key: def_73;
    /**
     * Full API key token. This value is only returned once at creation time.
     */
    token: string;
  };
};

