import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEventHandler
} from 'react';
import { useAuth } from '../auth/useAuth';
import { fetchHistory as fetchRepositoryHistory, fetchRepository, submitRepository } from '../core/api';

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
  metadataStrategy: 'auto' | 'explicit';
};

export type ImportAppFormState = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  tags: TagInput[];
  metadataStrategy: 'auto' | 'explicit';
};

export type UseImportAppResult = {
  form: ImportAppFormState;
  setForm: (
    updater: ImportAppFormState | ((prev: ImportAppFormState) => ImportAppFormState)
  ) => void;
  sourceType: 'remote' | 'local';
  setSourceType: (source: 'remote' | 'local') => void;
  submitting: boolean;
  submissionVersion: number;
  error: string | null;
  errorVersion: number;
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
  resetForm: () => void;
  clearDraft: () => void;
  draftSavedAt: number | null;
};

const APP_DRAFT_STORAGE_KEY = 'apphub-import-app-draft';

const DEFAULT_TAG: TagInput = { key: 'language', value: 'javascript' };

const DEFAULT_FORM: ImportAppFormState = {
  id: '',
  name: '',
  description: '',
  repoUrl: '',
  dockerfilePath: 'Dockerfile',
  tags: [DEFAULT_TAG],
  metadataStrategy: 'auto'
};

type DraftPayload = {
  form: ImportAppFormState;
  sourceType: 'remote' | 'local';
  savedAt: number;
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

function ensureTags(tags: TagInput[] | undefined): TagInput[] {
  if (!tags || tags.length === 0) {
    return [DEFAULT_TAG];
  }
  return tags.map((tag) => ({
    key: typeof tag.key === 'string' ? tag.key : '',
    value: typeof tag.value === 'string' ? tag.value : ''
  }));
}

function readDraft(): DraftPayload | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(APP_DRAFT_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DraftPayload>;
    if (!parsed || !parsed.form) {
      return null;
    }
    const form: ImportAppFormState = {
      id: typeof parsed.form.id === 'string' ? parsed.form.id : DEFAULT_FORM.id,
      name: typeof parsed.form.name === 'string' ? parsed.form.name : DEFAULT_FORM.name,
      description:
        typeof parsed.form.description === 'string' ? parsed.form.description : DEFAULT_FORM.description,
      repoUrl: typeof parsed.form.repoUrl === 'string' ? parsed.form.repoUrl : DEFAULT_FORM.repoUrl,
      dockerfilePath:
        typeof parsed.form.dockerfilePath === 'string'
          ? parsed.form.dockerfilePath
          : DEFAULT_FORM.dockerfilePath,
      tags: ensureTags(parsed.form.tags),
      metadataStrategy:
        parsed.form.metadataStrategy === 'explicit' || parsed.form.metadataStrategy === 'auto'
          ? parsed.form.metadataStrategy
          : DEFAULT_FORM.metadataStrategy
    };
    const sourceType = parsed.sourceType === 'local' ? 'local' : 'remote';
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now();
    return { form, sourceType, savedAt };
  } catch {
    return null;
  }
}

export function useImportApp(onAppRegistered?: (id: string) => void): UseImportAppResult {
  const { activeToken } = useAuth();
  const draftRef = useRef<DraftPayload | null>(readDraft());
  const [form, setFormState] = useState<ImportAppFormState>(() => {
    const draft = draftRef.current;
    if (!draft) {
      return DEFAULT_FORM;
    }
    return { ...DEFAULT_FORM, ...draft.form, tags: ensureTags(draft.form.tags) };
  });
  const [sourceType, setSourceTypeState] = useState<'remote' | 'local'>(
    () => draftRef.current?.sourceType ?? 'remote'
  );
  const [submitting, setSubmitting] = useState(false);
  const [submissionVersion, setSubmissionVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorVersion, setErrorVersion] = useState(0);
  const [currentApp, setCurrentApp] = useState<AppRecord | null>(null);
  const [history, setHistory] = useState<IngestionEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(draftRef.current?.savedAt ?? null);

  const skipDraftPersist = useRef(false);

  const appId = useMemo(() => currentApp?.id ?? null, [currentApp]);

  useEffect(() => {
    if (!appId) {
      return;
    }
    const controller = new AbortController();
    const interval = window.setInterval(async () => {
      try {
      if (!activeToken) {
        throw new Error('Authentication required to load build status');
      }
      const payload = await fetchRepository(activeToken, appId, { signal: controller.signal });
      setCurrentApp(payload);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
      }
    }, 1500);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [activeToken, appId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (skipDraftPersist.current) {
      skipDraftPersist.current = false;
      return;
    }
    const payload: DraftPayload = {
      form,
      sourceType,
      savedAt: Date.now()
    };
    window.localStorage.setItem(APP_DRAFT_STORAGE_KEY, JSON.stringify(payload));
    setDraftSavedAt(payload.savedAt);
  }, [form, sourceType]);

  const setForm = useCallback(
    (updater: ImportAppFormState | ((prev: ImportAppFormState) => ImportAppFormState)) => {
      setFormState((prev) =>
        typeof updater === 'function' ? (updater as (p: ImportAppFormState) => ImportAppFormState)(prev) : updater
      );
    },
    []
  );

  const setSourceType = useCallback((source: 'remote' | 'local') => {
    setSourceTypeState(source);
  }, []);

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
    setFormState((prev) => {
      const next = prev.tags.filter((_, i) => i !== index);
      return { ...prev, tags: next.length > 0 ? next : [DEFAULT_TAG] };
    });
  }, []);

  const loadHistory = useCallback(async (id: string) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      if (!activeToken) {
        throw new Error('Authentication required to load history');
      }
      const events = await fetchRepositoryHistory(activeToken, id);
      setHistory(events);
    } catch (err) {
      setHistoryError((err as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  }, [activeToken]);

  const disableSubmit =
    submitting || !form.name || !form.description || !form.repoUrl || !form.dockerfilePath;

  const clearDraft = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    skipDraftPersist.current = true;
    window.localStorage.removeItem(APP_DRAFT_STORAGE_KEY);
    setDraftSavedAt(null);
  }, []);

  const resetForm = useCallback(() => {
    skipDraftPersist.current = true;
    setFormState(DEFAULT_FORM);
    setSourceTypeState('remote');
    setCurrentApp(null);
    setHistory([]);
    setHistoryError(null);
    setError(null);
    setSubmissionVersion(0);
    setErrorVersion(0);
    clearDraft();
  }, [clearDraft]);

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
          tags: form.tags.filter((tag) => tag.key && tag.value),
          metadataStrategy: form.metadataStrategy
        };

        if (!activeToken) {
          throw new Error('Authentication required to submit repository');
        }

        const payload = await submitRepository(activeToken, body);
        setCurrentApp(payload);
        setHistory([]);
        setSubmissionVersion((prev) => prev + 1);
        onAppRegistered?.(id);
        clearDraft();
        await loadHistory(id);
      } catch (err) {
        setError((err as Error).message);
        setErrorVersion((prev) => prev + 1);
      } finally {
        setSubmitting(false);
      }
    },
    [activeToken, clearDraft, form, loadHistory, onAppRegistered, sourceType]
  );

  return {
    form,
    setForm,
    sourceType,
    setSourceType,
    submitting,
    submissionVersion,
    error,
    errorVersion,
    currentApp,
    history,
    historyLoading,
    historyError,
    disableSubmit,
    handleSubmit,
    handleTagChange,
    addTagField,
    removeTagField,
    fetchHistory: loadHistory,
    resetForm,
    clearDraft,
    draftSavedAt
  };
}
