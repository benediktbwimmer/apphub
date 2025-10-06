export interface ModuleMetadata {
  /** Unique machine-readable name, e.g. `observatory`. */
  name: string;
  /** Semantic version of the module definition. */
  version: string;
  /** Optional human-friendly display name. */
  displayName?: string;
  /** Optional descriptive summary. */
  description?: string;
  /** Optional tags that describe the module. */
  keywords?: string[];
}

export interface ValueDescriptor<TValue> {
  /** Default value used when the caller does not specify overrides. */
  defaults?: TValue;
  /** Optional resolver to coerce raw input (e.g. JSON) into the typed representation. */
  resolve?: (raw: unknown) => TValue;
}
