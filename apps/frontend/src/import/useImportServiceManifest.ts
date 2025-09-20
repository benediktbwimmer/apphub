import { useCallback, useState, type FormEvent } from 'react';
import { API_BASE_URL } from '../config';

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
};

function buildRequestBody(form: ImportManifestForm): NormalizedRequestBody {
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

  return body;
}

export function useImportServiceManifest() {
  const [form, setForm] = useState<ImportManifestForm>({
    repo: '',
    ref: '',
    commit: '',
    configPath: '',
    module: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportManifestResult | null>(null);

  const updateField = useCallback((field: keyof ImportManifestForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
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
        const body = buildRequestBody(form);
        if (!body.repo) {
          throw new Error('Repository URL is required');
        }

        const response = await fetch(`${API_BASE_URL}/service-networks/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const message = payload?.error ?? `Import failed with status ${response.status}`;
          throw new Error(typeof message === 'string' ? message : 'Import failed');
        }

        const payload = await response.json();
        setResult(payload.data as ImportManifestResult);
      } catch (err) {
        setError((err as Error).message);
        setResult(null);
      } finally {
        setSubmitting(false);
      }
    },
    [form, submitting]
  );

  const resetResult = useCallback(() => {
    setResult(null);
  }, []);

  return {
    form,
    updateField,
    setForm,
    submitting,
    error,
    result,
    handleSubmit,
    resetResult
  };
}
