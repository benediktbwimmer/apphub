/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_15 = {
  data: {
    /**
     * Saved search identifier.
     */
    id: string;
    /**
     * Shareable slug referencing the saved search.
     */
    slug: string;
    /**
     * Human friendly label for the saved query.
     */
    name: string;
    description?: string | null;
    /**
     * Raw core search input as entered by the operator.
     */
    searchInput: string;
    /**
     * Selected ingest status filters applied when executing the saved search.
     */
    statusFilters: Array<'seed' | 'pending' | 'processing' | 'ready' | 'failed'>;
    /**
     * Preferred sort mode.
     */
    sort: 'relevance' | 'updated' | 'name';
    /**
     * Visibility of the saved search. Currently limited to private entries.
     */
    visibility: 'private';
    /**
     * Number of times the saved search has been applied.
     */
    appliedCount: number;
    /**
     * Number of share actions recorded for the saved search.
     */
    sharedCount: number;
    lastAppliedAt?: string | null;
    lastSharedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

