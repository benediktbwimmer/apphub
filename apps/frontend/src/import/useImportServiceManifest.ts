import { useCallback, useState, type FormEvent } from 'react';
import { API_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';

export type ManifestPlaceholderOccurrence =
  | { kind: 'service'; serviceSlug: string; envKey: string; source: string }
  | { kind: 'network'; networkId: string; envKey: string; source: string }
  | { kind: 'network-service'; networkId: string; serviceSlug: string; envKey: string; source: string }
  | { kind: 'app-launch'; networkId: string; appId: string; envKey: string; source: string };

export type ManifestPlaceholder = {
  name: string;
  description?: string;
  defaultValue?: string;
  value?: string;
  required: boolean;
  missing: boolean;
  occurrences: ManifestPlaceholderOccurrence[];
  conflicts: string[];
};

export type ImportManifestForm = {
  repo: string;
  ref: string;
  commit: string;
  configPath: string;
  module: string;
};

export type ImportManifestResult = {
  module: string;
  resolvedCommit: string | null;
  servicesDiscovered: number;
  networksDiscovered: number;
  configPath: string;
};

type NormalizedRequestBody = {
  repo: string;
  ref?: string;
  commit?: string;
  configPath?: string;
  module?: string;
  variables?: Record<string, string>;
  requirePlaceholderValues?: boolean;
};

function buildRequestBody(
  form: ImportManifestForm,
  variables: Record<string, string>,
  placeholders: ManifestPlaceholder[]
): NormalizedRequestBody {
  const body: NormalizedRequestBody = {
    repo: form.repo.trim()
  };

  const ref = form.ref.trim();
  if (ref) {
    body.ref = ref;
  }

  const commit = form.commit.trim();
  if (commit) {
    body.commit = commit;
  }

  const configPath = form.configPath.trim();
  if (configPath) {
    body.configPath = configPath;
  }

  const moduleValue = form.module.trim();
  if (moduleValue) {
    body.module = moduleValue;
  }

  const variableEntries = Object.entries(variables)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key.length > 0);

  if (placeholders.length > 0 && variableEntries.length > 0) {
    const placeholderMap = new Map(placeholders.map((placeholder) => [placeholder.name, placeholder]));
    const filtered = variableEntries
      .map(([key, value]) => {
        const placeholder = placeholderMap.get(key);
        const trimmedValue = value.trim();
        if (!placeholder) {
          return trimmedValue.length > 0 ? ([key, trimmedValue] as const) : null;
        }
        if (!placeholder.required && trimmedValue.length === 0) {
          return null;
        }
        return [key, trimmedValue] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry));

    if (filtered.length > 0) {
      body.variables = Object.fromEntries(filtered);
    }
  }

  body.requirePlaceholderValues = true;

  return body;
}

function hydrateVariables(
  placeholders: ManifestPlaceholder[],
  existing: Record<string, string>
): Record<string, string> {
  const hydrated: Record<string, string> = {};
  for (const placeholder of placeholders) {
    if (Object.prototype.hasOwnProperty.call(existing, placeholder.name)) {
      hydrated[placeholder.name] = existing[placeholder.name];
      continue;
    }
    if (placeholder.value !== undefined) {
      hydrated[placeholder.name] = placeholder.value;
      continue;
    }
    if (placeholder.defaultValue !== undefined) {
      hydrated[placeholder.name] = placeholder.defaultValue;
      continue;
    }
    hydrated[placeholder.name] = '';
  }
  return hydrated;
}

export function useImportServiceManifest() {
  const authorizedFetch = useAuthorizedFetch();
  const [form, setForm] = useState<ImportManifestForm>({
    repo: '',
    ref: '',
    commit: '',
    configPath: '',
    module: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportManifestResult | null>(null);
  const [lastRequestBody, setLastRequestBody] = useState<NormalizedRequestBody | null>(null);
  const [resultVersion, setResultVersion] = useState(0);
  const [errorVersion, setErrorVersion] = useState(0);
  const [placeholders, setPlaceholders] = useState<ManifestPlaceholder[]>([]);
  const [variables, setVariables] = useState<Record<string, string>>({});

  const clearPlaceholders = useCallback(() => {
    setPlaceholders([]);
    setVariables({});
  }, [setPlaceholders, setVariables]);

  const importManifest = useCallback(
    async (body: NormalizedRequestBody) => {
      const response = await authorizedFetch(`${API_BASE_URL}/service-networks/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        if (response.status === 400 && payload && Array.isArray(payload.placeholders)) {
          const incoming = payload.placeholders as ManifestPlaceholder[];
          setPlaceholders(incoming);
          setVariables((prev) => hydrateVariables(incoming, prev));
          const message =
            typeof payload.error === 'string'
              ? payload.error
              : 'Import requires placeholder values';
          throw new Error(message);
        }

        const message = payload?.error ?? `Import failed with status ${response.status}`;
        throw new Error(typeof message === 'string' ? message : 'Import failed');
      }

      const payload = await response.json();
      clearPlaceholders();
      setResult(payload.data as ImportManifestResult);
      setResultVersion((prev) => prev + 1);
      setError(null);
      setLastRequestBody(body);
    },
    [authorizedFetch, clearPlaceholders]
  );

  const updateField = useCallback((field: keyof ImportManifestForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const updateVariable = useCallback((name: string, value: string) => {
    setVariables((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting) {
        return;
      }

      setSubmitting(true);
      setError(null);
      setResult(null);
      try {
        const body = buildRequestBody(form, variables, placeholders);
        if (!body.repo) {
          throw new Error('Repository URL is required');
        }

        await importManifest(body);
      } catch (err) {
        setError((err as Error).message);
        setErrorVersion((prev) => prev + 1);
        setResult(null);
      } finally {
        setSubmitting(false);
      }
    },
    [form, importManifest, placeholders, submitting, variables]
  );

  const resetResult = useCallback(() => {
    setResult(null);
    clearPlaceholders();
  }, [clearPlaceholders]);

  const handleReimport = useCallback(async () => {
    if (reimporting || submitting || !lastRequestBody) {
      return;
    }

    setReimporting(true);
    setError(null);
    try {
      await importManifest(lastRequestBody);
    } catch (err) {
      setError((err as Error).message);
      setErrorVersion((prev) => prev + 1);
    } finally {
      setReimporting(false);
    }
  }, [importManifest, lastRequestBody, reimporting, submitting]);

  return {
    form,
    updateField,
    setForm,
    submitting,
    reimporting,
    error,
    result,
    resultVersion,
    errorVersion,
    handleSubmit,
    resetResult,
    handleReimport,
    canReimport: lastRequestBody !== null,
    placeholders,
    variables,
    updateVariable,
    setVariables
  };
}
