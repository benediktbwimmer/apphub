import type { EventSchemaRecord, EventSchemaStatus, JsonValue } from '../db/types';

export type RegisterEventSchemaInput = {
  eventType: string;
  schema: JsonValue;
  version?: number;
  status?: EventSchemaStatus;
  metadata?: JsonValue | null;
  author?: string | null;
};

export type ResolveEventSchemaOptions = {
  version?: number;
  statuses?: EventSchemaStatus[];
};

export type ResolvedEventSchema = {
  record: EventSchemaRecord;
  validate: (payload: unknown) => { valid: true } | { valid: false; errors: string[] };
};
