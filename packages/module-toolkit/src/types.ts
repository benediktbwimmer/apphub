export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue }
  | JsonValue[];

export type BuildLiteral = {
  type: 'literal';
  value: JsonValue;
};

export type BuildTemplate = {
  type: 'template';
  template: string;
};

export type BuildResult = BuildLiteral | BuildTemplate;

export interface BuildContext<TSettings> {
  settings: TSettings;
}
