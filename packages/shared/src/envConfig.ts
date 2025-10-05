import { z } from 'zod';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export type EnvSource = Record<string, string | undefined>;

export type LoadEnvConfigOptions = {
  env?: EnvSource;
  context?: string;
};

export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvConfigError';
  }
}

type EnvIssueTarget = {
  path: (string | number)[];
  message: string;
};

function formatIssue({ path, message }: EnvIssueTarget): string {
  const location = path.length > 0 ? path.join('.') : '<root>';
  return `${location}: ${message}`;
}

function formatErrorMessage(context: string, issues: EnvIssueTarget[]): string {
  const header = `[${context}] Invalid environment configuration`;
  const details = issues.map((issue) => `  • ${formatIssue(issue)}`).join('\n');
  return `${header}\n${details}`;
}

export function loadEnvConfig<T>(schema: z.ZodType<T>, options?: LoadEnvConfigOptions): T {
  const envSource: EnvSource = { ...(options?.env ?? process.env) };
  const context = options?.context ?? 'apphub';

  const result = schema.safeParse(envSource);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message
    }));
    throw new EnvConfigError(formatErrorMessage(context, issues));
  }

  return result.data;
}

function describe(name: string | number | undefined, description?: string): string {
  if (description) {
    return description;
  }
  if (typeof name === 'string' && name.length > 0) {
    return name;
  }
  if (typeof name === 'number') {
    return name.toString();
  }
  return 'value';
}

type RequiredOption = {
  required?: boolean;
};

type DefaultOption<T> = {
  defaultValue?: T;
};

type DescriptionOption = {
  description?: string;
};

const DEFAULT_LIST_SEPARATOR = /[,\s]+/;

export type BooleanVarOptions = RequiredOption &
  DefaultOption<boolean> &
  DescriptionOption & {
    truthyValues?: string[];
    falsyValues?: string[];
  };

export function booleanVar(options?: BooleanVarOptions) {
  const truthy = new Set((options?.truthyValues ?? [...TRUE_VALUES]).map((value) => value.toLowerCase()));
  const falsy = new Set((options?.falsyValues ?? [...FALSE_VALUES]).map((value) => value.toLowerCase()));

  return z.union([z.string(), z.boolean()]).nullable().optional().transform((value, ctx) => {
    const pathName = ctx.path.length > 0 ? ctx.path[ctx.path.length - 1] : undefined;
    const description = describe(pathName, options?.description);

    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      if (options?.defaultValue !== undefined) {
        return options.defaultValue;
      }
      if (options?.required) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing required ${description}` });
        return z.NEVER;
      }
      return undefined;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (truthy.has(normalized)) {
      return true;
    }
    if (falsy.has(normalized)) {
      return false;
    }

    const accepted = [...truthy, ...falsy]
      .map((entry) => `'${entry}'`)
      .join(', ');
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid ${description}. Accepted boolean values: ${accepted}`
    });
    return z.NEVER;
  });
}

export type IntegerVarOptions = RequiredOption &
  DefaultOption<number> &
  DescriptionOption & {
    min?: number;
    max?: number;
  };

export function integerVar(options?: IntegerVarOptions) {
  return z.union([z.string(), z.number()]).nullable().optional().transform((value, ctx) => {
    const pathName = ctx.path.length > 0 ? ctx.path[ctx.path.length - 1] : undefined;
    const description = describe(pathName, options?.description);

    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      if (options?.defaultValue !== undefined) {
        return options.defaultValue;
      }
      if (options?.required) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing required ${description}` });
        return z.NEVER;
      }
      return undefined;
    }

    const parsed = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected ${description} to be an integer`
      });
      return z.NEVER;
    }

    if (options?.min !== undefined && parsed < options.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${description} must be >= ${options.min}`
      });
      return z.NEVER;
    }

    if (options?.max !== undefined && parsed > options.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${description} must be <= ${options.max}`
      });
      return z.NEVER;
    }

    return parsed;
  });
}

export type NumberVarOptions = RequiredOption &
  DefaultOption<number> &
  DescriptionOption & {
    min?: number;
    max?: number;
  };

export function numberVar(options?: NumberVarOptions) {
  return z.union([z.string(), z.number()]).nullable().optional().transform((value, ctx) => {
    const pathName = ctx.path.length > 0 ? ctx.path[ctx.path.length - 1] : undefined;
    const description = describe(pathName, options?.description);

    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      if (options?.defaultValue !== undefined) {
        return options.defaultValue;
      }
      if (options?.required) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing required ${description}` });
        return z.NEVER;
      }
      return undefined;
    }

    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected ${description} to be a number`
      });
      return z.NEVER;
    }

    if (options?.min !== undefined && parsed < options.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${description} must be >= ${options.min}`
      });
      return z.NEVER;
    }

    if (options?.max !== undefined && parsed > options.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${description} must be <= ${options.max}`
      });
      return z.NEVER;
    }

    return parsed;
  });
}

export type StringVarOptions = RequiredOption &
  DefaultOption<string> &
  DescriptionOption & {
    trim?: boolean;
    allowEmpty?: boolean;
    pattern?: RegExp;
    lowercase?: boolean;
  };

export function stringVar(options?: StringVarOptions) {
  return z.string().optional().transform((value, ctx) => {
    const pathName = ctx.path.length > 0 ? ctx.path[ctx.path.length - 1] : undefined;
    const description = describe(pathName, options?.description);

    if (value === undefined) {
      if (options?.defaultValue !== undefined) {
        return options.lowercase ? options.defaultValue.toLowerCase() : options.defaultValue;
      }
      if (options?.required) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing required ${description}` });
        return z.NEVER;
      }
      return undefined;
    }

    const raw = options?.trim === false ? value : value.trim();
    const normalized = options?.lowercase ? raw.toLowerCase() : raw;

    if (!options?.allowEmpty && normalized.length === 0) {
      if (options?.required) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${description} must not be empty` });
        return z.NEVER;
      }
      return undefined;
    }

    if (options?.pattern && !options.pattern.test(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${description} does not match expected pattern`
      });
      return z.NEVER;
    }

    return normalized;
  });
}

export type StringListOptions = RequiredOption &
  DefaultOption<string[]> &
  DescriptionOption & {
    separator?: RegExp | string;
    unique?: boolean;
    lowercase?: boolean;
  };

export function stringListVar(options?: StringListOptions) {
  return z.union([z.string(), z.array(z.string())]).nullable().optional().transform((value, ctx) => {
    const pathName = ctx.path.length > 0 ? ctx.path[ctx.path.length - 1] : undefined;
    const description = describe(pathName, options?.description);

    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      if (options?.defaultValue !== undefined) {
        return options.lowercase
          ? options.defaultValue.map((entry) => entry.toLowerCase())
          : options.defaultValue;
      }
      if (options?.required) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing required ${description}` });
        return z.NEVER;
      }
      return [];
    }

    const separator = options?.separator ?? DEFAULT_LIST_SEPARATOR;
    const list = Array.isArray(value)
      ? value
      : value
          .split(separator)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);

    const normalized = options?.lowercase ? list.map((entry) => entry.toLowerCase()) : list;

    if (options?.unique) {
      return Array.from(new Set(normalized));
    }

    return normalized;
  });
}

export type StringSetOptions = StringListOptions;

export function stringSetVar(options?: StringSetOptions) {
  return stringListVar(options).transform((values) => new Set(values));
}

export type JsonVarOptions<T> = RequiredOption &
  DefaultOption<T> &
  DescriptionOption & {
    schema?: z.ZodType<T>;
  };

export function jsonVar<T = unknown>(options?: JsonVarOptions<T>) {
  const schema = options?.schema ?? (z.unknown() as z.ZodType<T>);

  return z.union([z.string(), z.record(z.any())]).nullable().optional().transform((value, ctx) => {
    const pathName = ctx.path.length > 0 ? ctx.path[ctx.path.length - 1] : undefined;
    const description = describe(pathName, options?.description);

    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      if (options?.defaultValue !== undefined) {
        return options.defaultValue;
      }
      if (options?.required) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing required ${description}` });
        return z.NEVER;
      }
      return undefined;
    }

    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      const result = schema.safeParse(parsed);
      if (!result.success) {
        const [firstIssue] = result.error.issues;
        const message = firstIssue?.message ?? 'does not match expected structure';
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${description} ${message}`
        });
        return z.NEVER;
      }
      return result.data;
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Failed to parse ${description} as JSON`
      });
      return z.NEVER;
    }
  });
}

export type HostPortOptions = {
  defaultHost?: string;
  defaultPort?: number;
  hostDescription?: string;
  portDescription?: string;
  minPort?: number;
  maxPort?: number;
};

export const hostVar = (options?: HostPortOptions) =>
  stringVar({
    defaultValue: options?.defaultHost ?? '127.0.0.1',
    description: options?.hostDescription ?? 'host'
  });

export const portVar = (options?: HostPortOptions) =>
  integerVar({
    defaultValue: options?.defaultPort ?? 3000,
    min: options?.minPort ?? 1,
    max: options?.maxPort ?? 65535,
    description: options?.portDescription ?? 'port'
  });

export const envParsers = {
  boolean: booleanVar,
  integer: integerVar,
  number: numberVar,
  string: stringVar,
  stringList: stringListVar,
  stringSet: stringSetVar,
  json: jsonVar,
  host: hostVar,
  port: portVar
};
