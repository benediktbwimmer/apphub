/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_22 = {
  data: {
    /**
     * Saved view identifier.
     */
    id: string;
    /**
     * Slug used to reference the saved view.
     */
    slug: string;
    /**
     * Display name for the saved view.
     */
    name: string;
    description?: string | null;
    filters: {
      type?: string;
      source?: string;
      correlationId?: string;
      from?: string;
      to?: string;
      jsonPath?: string;
      severity?: Array<'critical' | 'error' | 'warning' | 'info' | 'debug'>;
      limit?: number;
    };
    visibility: 'private' | 'shared';
    appliedCount: number;
    sharedCount: number;
    lastAppliedAt?: string | null;
    lastSharedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    owner: {
      key: string;
      subject: string;
      kind: 'user' | 'service';
      userId?: string | null;
    };
    analytics?: any | null;
  };
};

