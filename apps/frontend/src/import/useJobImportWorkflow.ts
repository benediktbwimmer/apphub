import { useCallback, useState } from 'react';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { API_BASE_URL } from '../config';

export type JobImportSource = 'upload' | 'registry';

export type JobImportFormState = {
  source: JobImportSource;
  reference: string;
  notes: string;
};

export type JobImportWarning = {
  code?: string;
  message: string;
};

export type JobImportValidationError = {
  code?: string;
  message: string;
  field?: string;
};

export type JobImportDryRun = {
  id?: string;
  status: 'skipped' | 'succeeded' | 'failed';
  resultUrl?: string | null;
  logs?: string | null;
};

export type JobImportPreviewBundle = {
  slug: string;
  version: string;
  description?: string | null;
  capabilities?: string[];
  checksum?: string | null;
  parameters?: {
    schema?: unknown;
  };
  runtime?: string | null;
};

export type JobImportPreviewResult = {
  bundle: JobImportPreviewBundle;
  warnings: JobImportWarning[];
  errors: JobImportValidationError[];
  dryRun?: JobImportDryRun;
};

export type JobImportConfirmResult = {
  job: {
    id: string;
    slug: string;
    version: string;
    runtime?: string | null;
    capabilities?: string[];
    createdAt: string;
  };
  nextSteps?: {
    sandboxRunId?: string;
    monitoringUrl?: string;
  };
};

export type UseJobImportWorkflowResult = {
  form: JobImportFormState;
  setFormField: <K extends keyof JobImportFormState>(field: K, value: JobImportFormState[K]) => void;
  setArchive: (file: File | null) => void;
  archive: File | null;
  previewLoading: boolean;
  previewError: string | null;
  previewValidationErrors: JobImportValidationError[];
  previewResult: JobImportPreviewResult | null;
  runPreview: () => Promise<boolean>;
  confirmLoading: boolean;
  confirmError: string | null;
  confirmResult: JobImportConfirmResult | null;
  confirmImport: () => Promise<boolean>;
  reset: () => void;
  canConfirm: boolean;
};

const DEFAULT_FORM: JobImportFormState = {
  source: 'upload',
  reference: '',
  notes: ''
};

export function useJobImportWorkflow(): UseJobImportWorkflowResult {
  const authorizedFetch = useAuthorizedFetch();
  const [form, setForm] = useState<JobImportFormState>(DEFAULT_FORM);
  const [archive, setArchiveState] = useState<File | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewValidationErrors, setPreviewValidationErrors] = useState<JobImportValidationError[]>([]);
  const [previewResult, setPreviewResult] = useState<JobImportPreviewResult | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<JobImportConfirmResult | null>(null);

  const resetPreviewState = useCallback(() => {
    setPreviewResult(null);
    setPreviewError(null);
    setPreviewValidationErrors([]);
    setConfirmResult(null);
    setConfirmError(null);
  }, []);

  const setFormField = useCallback(
    <K extends keyof JobImportFormState>(field: K, value: JobImportFormState[K]) => {
      const previousValue = form[field];
      if (previousValue === value) {
        return;
      }
      setForm((prev) => ({ ...prev, [field]: value }));
      if (field === 'source') {
        setArchiveState(null);
        resetPreviewState();
      } else if (field === 'reference') {
        resetPreviewState();
      }
    },
    [form, resetPreviewState]
  );

  const setArchive = useCallback(
    (file: File | null) => {
      setArchiveState(file);
      resetPreviewState();
    },
    [resetPreviewState]
  );

  const runPreview = useCallback(async () => {
    setPreviewError(null);
    setPreviewValidationErrors([]);
    setConfirmResult(null);
    setConfirmError(null);
    setPreviewResult(null);
    setPreviewLoading(true);

    try {
      const formData = new FormData();
      formData.append('source', form.source);

      if (form.notes.trim()) {
        formData.append('notes', form.notes.trim());
      }

      if (form.source === 'upload') {
        if (!archive) {
          throw new Error('Bundle archive is required for uploads');
        }
        formData.append('archive', archive);
        if (form.reference.trim()) {
          formData.append('reference', form.reference.trim());
        }
      } else {
        if (!form.reference.trim()) {
          throw new Error('Registry reference (slug@version) is required');
        }
        formData.append('reference', form.reference.trim());
      }

      const response = await authorizedFetch(`${API_BASE_URL}/job-imports/preview`, {
        method: 'POST',
        body: formData
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.error ?? `Preview failed with status ${response.status}`;
        const normalizedMessage = typeof message === 'string' ? message : 'Preview failed';
        setPreviewError(normalizedMessage);
        const rawErrors = Array.isArray(payload?.errors) ? (payload.errors as JobImportValidationError[]) : [];
        setPreviewValidationErrors(rawErrors);
        return false;
      }

      if (!payload || !payload.data) {
        throw new Error('Preview response missing data');
      }

      const data = payload.data as JobImportPreviewResult;
      setPreviewResult({
        bundle: data.bundle,
        warnings: data.warnings ?? [],
        errors: data.errors ?? [],
        dryRun: data.dryRun
      });
      return true;
    } catch (err) {
      setPreviewError((err as Error).message);
      return false;
    } finally {
      setPreviewLoading(false);
    }
  }, [archive, authorizedFetch, form]);

  const confirmImport = useCallback(async () => {
    if (!previewResult) {
      setConfirmError('Generate a preview before confirming import');
      return false;
    }
    if (previewResult.errors.length > 0) {
      setConfirmError('Resolve preview errors before confirming');
      return false;
    }

    setConfirmError(null);
    setConfirmLoading(true);

    try {
      const reference = `${previewResult.bundle.slug}@${previewResult.bundle.version}`;
      const body = {
        bundle: {
          source: form.source,
          reference,
          checksum: previewResult.bundle.checksum ?? undefined,
          dryRunId: previewResult.dryRun?.id,
          metadata: form.notes.trim() ? { notes: form.notes.trim() } : undefined
        }
      };

      const response = await authorizedFetch(`${API_BASE_URL}/job-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error ?? `Import failed with status ${response.status}`;
        setConfirmError(typeof message === 'string' ? message : 'Import failed');
        return false;
      }

      if (!payload || !payload.data) {
        throw new Error('Import response missing data');
      }

      setConfirmResult(payload.data as JobImportConfirmResult);
      return true;
    } catch (err) {
      setConfirmError((err as Error).message);
      return false;
    } finally {
      setConfirmLoading(false);
    }
  }, [authorizedFetch, form.notes, form.source, previewResult]);

  const reset = useCallback(() => {
    setForm(DEFAULT_FORM);
    setArchiveState(null);
    resetPreviewState();
  }, [resetPreviewState]);

  return {
    form,
    setFormField,
    setArchive,
    archive,
    previewLoading,
    previewError,
    previewValidationErrors,
    previewResult,
    runPreview,
    confirmLoading,
    confirmError,
    confirmResult,
    confirmImport,
    reset,
    canConfirm: Boolean(previewResult && previewResult.errors.length === 0)
  };
}
