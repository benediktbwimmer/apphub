export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type WorkflowDefinitionTemplate = {
  slug: string;
  defaultParameters?: JsonValue;
  metadata?: JsonValue;
  [key: string]: unknown;
};
