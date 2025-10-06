import { fromConstant } from './valueBuilder';
import type { ValueBuilder } from './valueBuilder';

export interface PrincipalDefinition {
  subject: string;
  scopes?: string[];
  kind?: 'service' | 'user';
  description?: string;
}

export interface SecretDefinition<TSecrets, TValue> {
  select: (secrets: TSecrets) => TValue;
  required?: boolean;
  description?: string;
}

type SecretValueType<Definition> = Definition extends SecretDefinition<any, infer TValue>
  ? TValue
  : never;

export interface ModuleSecurityConfig<
  TSecrets,
  TPrincipals extends Record<string, PrincipalDefinition>,
  TSecretDefs extends Record<string, SecretDefinition<TSecrets, any>> | undefined
> {
  principals: TPrincipals;
  secrets?: TSecretDefs;
}

export interface PrincipalHandle<
  Name extends string,
  Definition extends PrincipalDefinition
> {
  name: Name;
  definition: Definition;
  subject: Definition['subject'];
  asValueBuilder(): ValueBuilder<unknown, unknown, unknown>;
}

export interface SecretHandle<Name extends string, TSecrets, TValue> {
  name: Name;
  definition: SecretDefinition<TSecrets, TValue>;
  get(secrets: TSecrets): TValue;
  require(secrets: TSecrets): TValue;
}

export type SecretsAccessorMap<
  TSecrets,
  TSecretDefs extends Record<string, SecretDefinition<TSecrets, any>> | undefined
> = TSecretDefs extends Record<string, SecretDefinition<TSecrets, any>>
  ? {
      [Name in keyof TSecretDefs & string]: SecretAccessor<
        Name,
        TSecrets,
        TSecretDefs[Name]
      >;
    }
  : Record<string, never>;

export interface SecretAccessor<
  Name extends string,
  TSecrets,
  Definition extends SecretDefinition<TSecrets, any>
> {
  name: Name;
  required: boolean;
  exists(): boolean;
  value(): SecretValueType<Definition>;
  require(): NonNullable<SecretValueType<Definition>>;
}

export interface ModuleSecurityRegistry<
  TSecrets,
  TPrincipals extends Record<string, PrincipalDefinition>,
  TSecretDefs extends Record<string, SecretDefinition<TSecrets, any>> | undefined
> {
  principal<Name extends keyof TPrincipals & string>(name: Name): PrincipalHandle<Name, TPrincipals[Name]>;
  secret<Name extends keyof NonNullable<TSecretDefs> & string>(
    name: Name
  ): SecretHandle<Name, TSecrets, NonNullable<TSecretDefs>[Name] extends SecretDefinition<TSecrets, infer TValue> ? TValue : never>;
  listPrincipals(): Array<{ name: keyof TPrincipals & string; definition: PrincipalDefinition }>;
  listSecrets(): Array<{
    name: keyof NonNullable<TSecretDefs> & string;
    definition: SecretDefinition<TSecrets, unknown>;
  }>;
  principalSubjects(): Record<keyof TPrincipals & string, string>;
  principalSettings(
    overrides?: Partial<Record<keyof TPrincipals & string, string>>
  ): Record<keyof TPrincipals & string, string>;
  principalSettingsPath<Name extends keyof TPrincipals & string>(name: Name): `principals.${Name}`;
  principalSelector<Name extends keyof TPrincipals & string>(
    name: Name
  ): (settings: { principals: Record<Name, string> }) => string;
  secretSettingsPath<Name extends keyof NonNullable<TSecretDefs> & string>(
    name: Name
  ): `secrets.${Name}`;
  secretSelector<Name extends keyof NonNullable<TSecretDefs> & string>(
    name: Name
  ): (secrets: TSecrets) => NonNullable<TSecretDefs>[Name] extends SecretDefinition<TSecrets, infer TValue>
    ? TValue
    : never;
  secretsBundle(
    secrets: TSecrets
  ): SecretsAccessorMap<TSecrets, TSecretDefs>;
}

export function defineModuleSecurity<
  TSecrets,
  TPrincipals extends Record<string, PrincipalDefinition>,
  TSecretDefs extends Record<string, SecretDefinition<TSecrets, any>> | undefined = undefined
>(
  config: ModuleSecurityConfig<TSecrets, TPrincipals, TSecretDefs>
): ModuleSecurityRegistry<TSecrets, TPrincipals, TSecretDefs> {
  const principalEntries = Object.entries(config.principals ?? {}) as Array<[
    keyof TPrincipals & string,
    PrincipalDefinition
  ]>;

  const secretEntries: Array<[
    keyof NonNullable<TSecretDefs> & string,
    SecretDefinition<TSecrets, unknown>
  ]> = config.secrets
    ? (Object.entries(config.secrets) as Array<[
        keyof NonNullable<TSecretDefs> & string,
        SecretDefinition<TSecrets, unknown>
      ]>)
    : [];

  function getPrincipal<Name extends keyof TPrincipals & string>(
    name: Name
  ): PrincipalHandle<Name, TPrincipals[Name]> {
    const entry = principalEntries.find(([key]) => key === name);
    if (!entry) {
      throw new Error(`Principal '${name}' is not defined`);
    }
    const [, definition] = entry;
    return {
      name,
      definition: definition as TPrincipals[Name],
      subject: definition.subject as TPrincipals[Name]['subject'],
      asValueBuilder(): ValueBuilder<unknown, unknown, unknown> {
        return fromConstant(definition.subject);
      }
    } satisfies PrincipalHandle<Name, TPrincipals[Name]>;
  }

  function getSecret<Name extends keyof NonNullable<TSecretDefs> & string>(
    name: Name
  ): SecretHandle<
    Name,
    TSecrets,
    NonNullable<TSecretDefs>[Name] extends SecretDefinition<TSecrets, infer TValue> ? TValue : never
  > {
    const entry = secretEntries.find(([key]) => key === name);
    if (!entry) {
      throw new Error(`Secret '${name}' is not defined`);
    }
    const [, definition] = entry;
    return {
      name,
      definition: definition as NonNullable<TSecretDefs>[Name],
      get(secrets: TSecrets) {
        return (definition.select(secrets) as unknown) as NonNullable<
          TSecretDefs
        >[Name] extends SecretDefinition<TSecrets, infer TValue>
          ? TValue
          : never;
      },
      require(secrets: TSecrets) {
        const value = definition.select(secrets);
        if (value === undefined || value === null) {
          throw new Error(`Secret '${name}' is required but was not provided`);
        }
        return value as NonNullable<TSecretDefs>[Name] extends SecretDefinition<TSecrets, infer TValue>
          ? TValue
          : never;
      }
    };
  }

  function buildSecretAccessor<Name extends keyof NonNullable<TSecretDefs> & string>(
    name: Name,
    definition: SecretDefinition<TSecrets, unknown>,
    secrets: TSecrets
  ): SecretAccessor<Name, TSecrets, SecretDefinition<TSecrets, unknown>> {
    const required = definition.required ?? false;
    const value = definition.select(secrets);
    return {
      name,
      required,
      exists: () => value !== undefined && value !== null,
      value: () => value as SecretValueType<SecretDefinition<TSecrets, unknown>>,
      require: () => {
        if (value === undefined || value === null) {
          throw new Error(`Secret '${name}' is required but was not provided`);
        }
        return value as NonNullable<SecretValueType<SecretDefinition<TSecrets, unknown>>>;
      }
    } satisfies SecretAccessor<Name, TSecrets, SecretDefinition<TSecrets, unknown>>;
  }

  return {
    principal: getPrincipal,
    secret: getSecret,
    listPrincipals() {
      return principalEntries.map(([name, definition]) => ({
        name,
        definition
      }));
    },
    listSecrets() {
      return secretEntries.map(([name, definition]) => ({
        name,
        definition
      }));
    },
    principalSubjects() {
      return Object.fromEntries(
        principalEntries.map(([name, definition]) => [name, definition.subject])
      ) as Record<keyof TPrincipals & string, string>;
    },
    principalSettings(
      overrides?: Partial<Record<keyof TPrincipals & string, string>>
    ) {
      const subjects = Object.fromEntries(
        principalEntries.map(([name, definition]) => [name, definition.subject])
      ) as Record<keyof TPrincipals & string, string>;
      return {
        ...subjects,
        ...(overrides ?? {})
      } as Record<keyof TPrincipals & string, string>;
    },
    principalSettingsPath<Name extends keyof TPrincipals & string>(name: Name) {
      return `principals.${name}` as `principals.${Name}`;
    },
    principalSelector<Name extends keyof TPrincipals & string>(name: Name) {
      return ((settings: { principals: Record<string, string> }) => settings.principals[name]) as (
        settings: { principals: Record<Name, string> }
      ) => string;
    },
    secretSettingsPath<Name extends keyof NonNullable<TSecretDefs> & string>(name: Name) {
      return `secrets.${name}` as `secrets.${Name}`;
    },
    secretSelector<Name extends keyof NonNullable<TSecretDefs> & string>(name: Name) {
      return ((secrets: TSecrets) => {
        const entry = secretEntries.find(([key]) => key === name);
        if (!entry) {
          throw new Error(`Secret '${name}' is not defined`);
        }
        const [, definition] = entry;
        return definition.select(secrets) as NonNullable<TSecretDefs>[Name] extends SecretDefinition<
          TSecrets,
          infer TValue
        >
          ? TValue
          : never;
      }) as (secrets: TSecrets) => NonNullable<TSecretDefs>[Name] extends SecretDefinition<
        TSecrets,
        infer TValue
      >
        ? TValue
        : never;
    },
    secretsBundle(secrets: TSecrets) {
      const entries = secretEntries.map(([name, definition]) => [
        name,
        buildSecretAccessor(name, definition, secrets)
      ] as const);
      return Object.fromEntries(entries) as SecretsAccessorMap<TSecrets, TSecretDefs>;
    }
  } satisfies ModuleSecurityRegistry<TSecrets, TPrincipals, TSecretDefs>;
}
