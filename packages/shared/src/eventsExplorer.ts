import type { WorkflowEventSeverity } from './coreEvents';

type NullableString = string | null | undefined;

export type EventSavedViewFilters = {
  type?: NullableString;
  source?: NullableString;
  correlationId?: NullableString;
  severity?: WorkflowEventSeverity[];
  from?: NullableString;
  to?: NullableString;
  jsonPath?: NullableString;
  limit?: number | null;
};

export type EventSavedViewVisibility = 'private' | 'shared';

export type EventSavedViewOwnerKind = 'user' | 'service';

export type EventSavedViewAnalytics = {
  windowSeconds: number;
  totalEvents: number;
  errorEvents: number;
  eventRatePerMinute: number;
  errorRatio: number;
  generatedAt: string;
  sampledCount: number;
  sampleLimit: number;
  truncated: boolean;
};

export type EventSavedViewRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  filters: EventSavedViewFilters;
  visibility: EventSavedViewVisibility;
  appliedCount: number;
  sharedCount: number;
  lastAppliedAt: string | null;
  lastSharedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerKey: string;
  ownerSubject: string;
  ownerKind: EventSavedViewOwnerKind;
  ownerUserId: string | null;
  analytics: EventSavedViewAnalytics | null;
};

export type EventSavedViewCreateInput = {
  name: string;
  description?: string | null;
  filters: EventSavedViewFilters;
  visibility?: EventSavedViewVisibility;
};

export type EventSavedViewUpdateInput = Partial<{
  name: string;
  description: string | null;
  filters: EventSavedViewFilters;
  visibility: EventSavedViewVisibility;
}>;

export type EventSavedViewOwner = {
  key: string;
  userId: string | null;
  subject: string;
  kind: EventSavedViewOwnerKind;
  tokenHash: string | null;
};

