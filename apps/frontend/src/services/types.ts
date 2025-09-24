export type ServiceSummary = {
  id: string;
  slug: string;
  displayName: string | null;
  kind: string | null;
  baseUrl: string | null;
  status: string;
  statusMessage: string | null;
  capabilities: unknown;
  metadata: unknown;
  lastHealthyAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ServicesResponseSuccess = {
  data?: ServiceSummary[];
};

type ServicesResponseError = {
  error?: unknown;
};

export type ServicesResponse = ServicesResponseSuccess | ServicesResponseError;
