import { useCallback, useEffect, useMemo, useState, type FormEventHandler } from 'react';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { API_BASE_URL } from '../config';

export type TagInput = {
  key: string;
  value: string;
};

export type IngestionEvent = {
  id: number;
  status: string;
  message: string | null;
  attempt: number | null;
  commitSha: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type AppRecord = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  ingestStatus: 'seed' | 'pending' | 'processing' | 'ready' | 'failed';
  ingestError: string | null;
  ingestAttempts: number;
  updatedAt: string;
  tags: TagInput[];
};

export type SubmitAppFormState = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  tags: TagInput[];
};

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .slice(0, 32) || `app-${Date.now()}`
  );
}

export type UseSubmitAppResult = {
  form: SubmitAppFormState;
  setForm: (
    updater: SubmitAppFormState | ((prev: SubmitAppFormState) => SubmitAppFormState)
  ) => void;
  sourceType: 'remote' | 'local';
  setSourceType: (source: 'remote' | 'local') => void;
  submitting: boolean;
  error: string | null;
  currentApp: AppRecord | null;
  history: IngestionEvent[];
  historyLoading: boolean;
  historyError: string | null;
  disableSubmit: boolean;
  handleSubmit: FormEventHandler<HTMLFormElement>;
  handleTagChange: (index: number, key: keyof TagInput, value: string) => void;
  addTagField: () => void;
  removeTagField: (index: number) => void;
  fetchHistory: (id: string) => Promise<void>;
};

export function useSubmitApp(onAppRegistered?: (id: string) => void): UseSubmitAppResult {
  const authorizedFetch = useAuthorizedFetch();
  const [form, setFormState] = useState<SubmitAppFormState>({
    id: '',
    name: '',
    description: '',
    repoUrl: '',
    dockerfilePath: 'Dockerfile',
    tags: [{ key: 'language', value: 'javascript' }]
  });
  const [sourceType, setSourceType] = useState<'remote' | 'local'>('remote');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentApp, setCurrentApp] = useState<AppRecord | null>(null);
  const [history, setHistory] = useState<IngestionEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const appId = useMemo(() => currentApp?.id ?? null, [currentApp]);

  useEffect(() => {
    if (!appId) {
      return;
    }
    const controller = new AbortController();
    const interval = setInterval(async () => {
      try {
        const res = await authorizedFetch(`${API_BASE_URL}/apps/${appId}`, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Failed to load app status (${res.status})`);
        }
        const payload = await res.json();
        setCurrentApp(payload.data);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
      }
    }, 1000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [appId, authorizedFetch]);

  const setForm = useCallback(
    (updater: SubmitAppFormState | ((prev: SubmitAppFormState) => SubmitAppFormState)) => {
      setFormState((prev) => (typeof updater === 'function' ? (updater as (p: SubmitAppFormState) => SubmitAppFormState)(prev) : updater));
    },
    []
  );

  const handleTagChange = useCallback((index: number, key: keyof TagInput, value: string) => {
    setFormState((prev) => {
      const next = [...prev.tags];
      next[index] = { ...next[index], [key]: value };
      return { ...prev, tags: next };
    });
  }, []);

  const addTagField = useCallback(() => {
    setFormState((prev) => ({ ...prev, tags: [...prev.tags, { key: '', value: '' }] }));
  }, []);

  const removeTagField = useCallback((index: number) => {
    setFormState((prev) => ({ ...prev, tags: prev.tags.filter((_, i) => i !== index) }));
  }, []);

  const fetchHistory = useCallback(async (id: string) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await authorizedFetch(`${API_BASE_URL}/apps/${id}/history`);
      if (!res.ok) {
        throw new Error(`Failed to load history (${res.status})`);
      }
      const payload = await res.json();
      setHistory(payload.data ?? []);
    } catch (err) {
      setHistoryError((err as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }, [authorizedFetch]);

  const disableSubmit =
    submitting || !form.name || !form.description || !form.repoUrl || !form.dockerfilePath;

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const id = form.id || slugify(form.name);
        const body = {
          id,
          name: form.name,
          description: form.description,
          repoUrl:
            sourceType === 'local' && form.repoUrl && !form.repoUrl.startsWith('file://')
              ? form.repoUrl
              : form.repoUrl,
          dockerfilePath: form.dockerfilePath,
          tags: form.tags.filter((tag) => tag.key && tag.value)
        };

        const response = await authorizedFetch(`${API_BASE_URL}/apps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? `Submission failed with status ${response.status}`);
        }

        const payload = await response.json();
        setCurrentApp(payload.data);
        setHistory([]);
        onAppRegistered?.(id);
        await fetchHistory(id);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [authorizedFetch, fetchHistory, form, onAppRegistered, sourceType]
  );

  return {
    form,
    setForm,
    sourceType,
    setSourceType,
    submitting,
    error,
    currentApp,
    history,
    historyLoading,
    historyError,
    disableSubmit,
    handleSubmit,
    handleTagChange,
    addTagField,
    removeTagField,
    fetchHistory
  };
}
