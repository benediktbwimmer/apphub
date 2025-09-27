import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components';
import { useToastHelpers } from '../../components/toast';
import type { CreateDatasetRequest, DatasetStatus } from '../types';
import { createDatasetRequestSchema } from '../types';

interface DatasetCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (request: CreateDatasetRequest) => Promise<void>;
  busy?: boolean;
}

type CreateFormFields = {
  slug: string;
  name: string;
  description: string;
  writeFormat: 'duckdb' | 'parquet';
  status: DatasetStatus;
  defaultStorageTargetId: string;
  readScopes: string;
  writeScopes: string;
};

type FieldErrorMap = Partial<Record<keyof CreateFormFields, string>> & {
  general?: string;
};

const DEFAULT_FIELDS: CreateFormFields = {
  slug: '',
  name: '',
  description: '',
  writeFormat: 'duckdb',
  status: 'active',
  defaultStorageTargetId: '',
  readScopes: '',
  writeScopes: ''
};

function isCreateFormFieldKey(value: string): value is keyof CreateFormFields {
  return Object.prototype.hasOwnProperty.call(DEFAULT_FIELDS, value);
}

function parseScopes(input: string): string[] | undefined {
  const normalized = input
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0) {
    return undefined;
  }
  return Array.from(new Set(normalized));
}

function buildCreatePayload(fields: CreateFormFields): CreateDatasetRequest {
  const metadataIam: { readScopes?: string[]; writeScopes?: string[] } = {};
  const readScopes = parseScopes(fields.readScopes);
  if (readScopes) {
    metadataIam.readScopes = readScopes;
  }
  const writeScopes = parseScopes(fields.writeScopes);
  if (writeScopes) {
    metadataIam.writeScopes = writeScopes;
  }

  const metadata = Object.keys(metadataIam).length > 0 ? { iam: metadataIam } : undefined;

  const payload: CreateDatasetRequest = {
    slug: fields.slug.trim(),
    name: fields.name.trim(),
    status: fields.status,
    writeFormat: fields.writeFormat,
    metadata
  };

  const description = fields.description.trim();
  if (description) {
    payload.description = description;
  }

  const storageTargetId = fields.defaultStorageTargetId.trim();
  if (storageTargetId) {
    payload.defaultStorageTargetId = storageTargetId;
  }

  return payload;
}

export function DatasetCreateDialog({ open, onClose, onCreate, busy = false }: DatasetCreateDialogProps) {
  const { showError, showSuccess } = useToastHelpers();
  const [fields, setFields] = useState<CreateFormFields>(DEFAULT_FIELDS);
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [submitting, setSubmitting] = useState(false);
  const isBusy = submitting || busy;
  const dialogTitleId = 'dataset-create-dialog-title';

  useEffect(() => {
    if (!open) {
      setFields(DEFAULT_FIELDS);
      setErrors({});
      setSubmitting(false);
    }
  }, [open]);

  const fieldError = useMemo(() => errors, [errors]);

  const handleChange = (key: keyof CreateFormFields) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setFields((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) {
      return;
    }
    setErrors({});
    const payload = buildCreatePayload(fields);
    const validation = createDatasetRequestSchema.safeParse(payload);
    if (!validation.success) {
      const nextErrors: FieldErrorMap = {};
      for (const issue of validation.error.issues) {
        const keyPath = issue.path.join('.');
        if (!keyPath) {
          nextErrors.general = issue.message;
          continue;
        }
        if (keyPath.includes('readScopes')) {
          nextErrors.readScopes = issue.message;
        } else if (keyPath.includes('writeScopes')) {
          nextErrors.writeScopes = issue.message;
        } else if (keyPath === 'metadata') {
          nextErrors.general = issue.message;
        } else if (isCreateFormFieldKey(keyPath)) {
          nextErrors[keyPath] = issue.message;
        } else {
          nextErrors.general = issue.message;
        }
      }
      setErrors(nextErrors);
      return;
    }

    try {
      setSubmitting(true);
      await onCreate(payload);
      showSuccess('Dataset created', `Dataset ${payload.slug} is now available.`);
      setFields(DEFAULT_FIELDS);
      setErrors({});
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create dataset';
      setErrors({ general: message });
      showError('Create dataset failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isBusy) {
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy={dialogTitleId}
      className="items-start justify-center px-4 py-6 sm:items-center"
      contentClassName="w-full max-w-3xl rounded-3xl border border-slate-200/70 bg-white/95 p-6 shadow-xl dark:border-slate-700/60 dark:bg-slate-900/80"
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={dialogTitleId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Create dataset
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Provide dataset metadata and IAM scopes. Fields marked with * are required.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            className="rounded-full border border-slate-300/70 px-3 py-1 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
          >
            Close
          </button>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Slug *</span>
            <input
              type="text"
              value={fields.slug}
              onChange={handleChange('slug')}
              placeholder="observatory-events"
              autoComplete="off"
              disabled={isBusy}
              className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            />
            {fieldError.slug && <span className="text-xs text-rose-600 dark:text-rose-300">{fieldError.slug}</span>}
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Name *</span>
            <input
              type="text"
              value={fields.name}
              onChange={handleChange('name')}
              placeholder="Observatory events"
              autoComplete="off"
              disabled={isBusy}
              className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            />
            {fieldError.name && <span className="text-xs text-rose-600 dark:text-rose-300">{fieldError.name}</span>}
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Write format</span>
            <select
              value={fields.writeFormat}
              onChange={handleChange('writeFormat')}
              disabled={isBusy}
              className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            >
              <option value="duckdb">DuckDB</option>
              <option value="parquet">Parquet</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Status</span>
            <select
              value={fields.status}
              onChange={handleChange('status')}
              disabled={isBusy}
              className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>

          <label className="sm:col-span-2 flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Description</span>
            <textarea
              value={fields.description}
              onChange={handleChange('description')}
              rows={3}
              disabled={isBusy}
              className="w-full rounded-2xl border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
              placeholder="Explain what this dataset contains and how it is used."
            />
            {fieldError.description && <span className="text-xs text-rose-600 dark:text-rose-300">{fieldError.description}</span>}
          </label>

          <label className="sm:col-span-2 flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Default storage target</span>
            <input
              type="text"
              value={fields.defaultStorageTargetId}
              onChange={handleChange('defaultStorageTargetId')}
              placeholder="st-001"
              disabled={isBusy}
              className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            />
            {fieldError.defaultStorageTargetId && (
              <span className="text-xs text-rose-600 dark:text-rose-300">{fieldError.defaultStorageTargetId}</span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Read scopes</span>
            <textarea
              value={fields.readScopes}
              onChange={handleChange('readScopes')}
              rows={3}
              placeholder="timestore:read"
              disabled={isBusy}
              className="w-full rounded-2xl border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">Separate scopes with commas or new lines.</span>
            {fieldError.readScopes && <span className="text-xs text-rose-600 dark:text-rose-300">{fieldError.readScopes}</span>}
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Write scopes</span>
            <textarea
              value={fields.writeScopes}
              onChange={handleChange('writeScopes')}
              rows={3}
              placeholder="timestore:write"
              disabled={isBusy}
              className="w-full rounded-2xl border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">Separate scopes with commas or new lines.</span>
            {fieldError.writeScopes && <span className="text-xs text-rose-600 dark:text-rose-300">{fieldError.writeScopes}</span>}
          </label>
        </div>

        {fieldError.general && <p className="text-sm text-rose-600 dark:text-rose-300">{fieldError.general}</p>}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            className="rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Create dataset
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default DatasetCreateDialog;
