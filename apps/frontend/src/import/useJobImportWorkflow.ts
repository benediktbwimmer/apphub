import { useCallback, useRef, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { coreRequest, CoreApiError } from '../core/api';
import { fileToEncodedPayload, type EncodedFilePayload } from '../utils/fileEncoding';

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
  setForm: (form: JobImportFormState) => void;
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

function buildPreviewRequestBody(
  form: JobImportFormState,
  archivePayload: EncodedFilePayload | null
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    source: form.source,
    notes: form.notes.trim() ? form.notes.trim() : undefined
  };

  if (form.source === 'upload') {
    if (!archivePayload) {
      throw new Error('Bundle archive is required for uploads');
    }
    body.archive = archivePayload;
    if (form.reference.trim()) {
      body.reference = form.reference.trim();
    }
  } else if (form.source === 'registry') {
    if (!form.reference.trim()) {
      throw new Error('Registry reference (slug@version) is required');
    }
    body.reference = form.reference.trim();
  }

  return body;
}

export function useJobImportWorkflow(): UseJobImportWorkflowResult {
  const { activeToken } = useAuth();
  const [form, setForm] = useState<JobImportFormState>(DEFAULT_FORM);
  const [archive, setArchiveState] = useState<File | null>(null);
  const lastEncodedArchive = useRef<EncodedFilePayload | null>(null);
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
    lastEncodedArchive.current = null;
  }, []);

  const setFormField = useCallback(
    <K extends keyof JobImportFormState>(field: K, value: JobImportFormState[K]) => {
      const previousValue = form[field];
      if (previousValue === value) {
        return;
      }

      if (field === 'source') {
        const nextSource = value as JobImportSource;
        setForm((prev) => ({
          ...prev,
          source: nextSource
        }));
        setArchiveState(null);
        resetPreviewState();
        return;
      }

      setForm((prev) => ({ ...prev, [field]: value }));
      if (field === 'reference') {
        resetPreviewState();
      }
    },
    [form, resetPreviewState]
  );

  const setArchive = useCallback(
    (file: File | null) => {
      setArchiveState(file);
      lastEncodedArchive.current = null;
      resetPreviewState();
    },
    [resetPreviewState]
  );

  const setFormState = useCallback(
    (nextForm: JobImportFormState) => {
      setForm(nextForm);
      resetPreviewState();
      if (nextForm.source !== 'upload') {
        setArchiveState(null);
        lastEncodedArchive.current = null;
      }
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
      let archivePayload: EncodedFilePayload | null = null;
      if (form.source === 'upload') {
        if (!archive) {
          throw new Error('Bundle archive is required for uploads');
        }
        archivePayload = await fileToEncodedPayload(archive);
        lastEncodedArchive.current = archivePayload;
      }

      const body = buildPreviewRequestBody(form, archivePayload);

      if (!activeToken) {
        throw new Error('Authentication required to preview job import');
      }

      const payload = await coreRequest<{ data?: JobImportPreviewResult; errors?: JobImportValidationError[] }>(
        activeToken,
        {
          method: 'POST',
          url: '/job-imports/preview',
          body
        }
      );

      if (!payload?.data) {
        throw new Error('Preview response missing data');
      }

      const data = payload.data;
      setPreviewResult({
        bundle: data.bundle,
        warnings: data.warnings ?? [],
        errors: data.errors ?? [],
        dryRun: data.dryRun
      });
      return true;
    } catch (err) {
      if (err instanceof CoreApiError) {
        const details = (err.details ?? null) as { errors?: unknown } | null;
        const errors = Array.isArray(details?.errors)
          ? (details?.errors as JobImportValidationError[])
          : [];
        setPreviewValidationErrors(errors);
        setPreviewError(err.message);
      } else {
        setPreviewError((err as Error).message);
      }
      return false;
    } finally {
      setPreviewLoading(false);
    }
  }, [activeToken, archive, form]);

  const confirmImport = useCallback(async () => {
    if (!previewResult) {
      setConfirmError('Generate a preview before confirming');
      return false;
    }
    if (previewResult.errors.length > 0) {
      setConfirmError('Resolve preview errors before confirming');
      return false;
    }
    setConfirmError(null);
    setConfirmResult(null);
    setConfirmLoading(true);

    try {
      let archivePayload: EncodedFilePayload | null = lastEncodedArchive.current;
      if (form.source === 'upload') {
        if (!archivePayload) {
          if (!archive) {
            throw new Error('Bundle archive is required for uploads');
          }
          archivePayload = await fileToEncodedPayload(archive);
          lastEncodedArchive.current = archivePayload;
        }
      }

      const reference = `${previewResult.bundle.slug}@${previewResult.bundle.version}`;
      const body = buildPreviewRequestBody(
        { ...form, reference },
        form.source === 'upload' ? archivePayload : null
      );

      if (!activeToken) {
        throw new Error('Authentication required to confirm job import');
      }

      const payload = await coreRequest<{ data?: JobImportConfirmResult }>(activeToken, {
        method: 'POST',
        url: '/job-imports',
        body
      });

      if (!payload?.data) {
        throw new Error('Import response missing data');
      }

      setConfirmResult(payload.data);
      return true;
    } catch (err) {
      if (err instanceof CoreApiError) {
        setConfirmError(err.message);
      } else {
        setConfirmError((err as Error).message);
      }
      return false;
    } finally {
      setConfirmLoading(false);
    }
  }, [activeToken, archive, form, previewResult]);

  const reset = useCallback(() => {
    setForm(DEFAULT_FORM);
    setArchiveState(null);
    lastEncodedArchive.current = null;
    resetPreviewState();
  }, [resetPreviewState]);

  return {
    form,
    setForm: setFormState,
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
