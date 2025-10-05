/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_0 } from './def_0';
export type def_27 = {
  data: {
    /**
     * Indicates whether an idempotency key short-circuited the command.
     */
    idempotent: boolean;
    /**
     * Identifier of the journal entry generated for this command.
     */
    journalEntryId: number;
    node: any | null;
    /**
     * Command-specific payload describing the work performed.
     */
    result: Record<string, def_0>;
  };
};

