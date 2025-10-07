export type ModuleResourceType =
  | 'service'
  | 'service-network'
  | 'workflow-definition'
  | 'workflow-run'
  | 'job-definition'
  | 'job-run'
  | 'asset'
  | 'event'
  | 'view'
  | 'metric';

export type ModuleSummary = {
  id: string;
  displayName: string | null;
  description: string | null;
  keywords: string[];
  latestVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ModuleResourceContext = {
  moduleId: string;
  moduleVersion: string | null;
  resourceType: ModuleResourceType;
  resourceId: string;
  resourceSlug: string | null;
  resourceName: string | null;
  resourceVersion: string | null;
  isShared: boolean;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ModuleResourcesResponse = {
  moduleId: string;
  resourceType: ModuleResourceType | null;
  resources: ModuleResourceContext[];
};
