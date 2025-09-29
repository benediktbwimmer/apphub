export type SavedSearchVisibility = 'private';

export type SavedSearch<TStatus extends string = string, TConfig = unknown> = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  searchInput: string;
  statusFilters: TStatus[];
  sort: string;
  category: string;
  config: TConfig;
  visibility: SavedSearchVisibility;
  appliedCount: number;
  sharedCount: number;
  lastAppliedAt: string | null;
  lastSharedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SavedSearchCreateInput<TStatus extends string = string, TConfig = unknown> = {
  name: string;
  description?: string | null;
  searchInput?: string;
  statusFilters?: TStatus[];
  sort?: string;
  category?: string;
  config?: TConfig;
};

export type SavedSearchUpdateInput<TStatus extends string = string, TConfig = unknown> = {
  name?: string;
  description?: string | null;
  searchInput?: string;
  statusFilters?: TStatus[];
  sort?: string;
  category?: string;
  config?: TConfig;
};

export type SavedSearchMutationState = {
  creating: boolean;
  applyingSlug: string | null;
  sharingSlug: string | null;
  updatingSlug: string | null;
  deletingSlug: string | null;
};
