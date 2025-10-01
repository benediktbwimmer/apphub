import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components';
import { useToastHelpers } from '../../components/toast';
import type { CreateDatasetRequest, DatasetStatus } from '../types';
import { createDatasetRequestSchema } from '../types';
import {
  DIALOG_SURFACE,
  FIELD_GROUP,
  FIELD_LABEL,
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_MESSAGE,
  TEXTAREA
} from '../timestoreTokens';

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
      contentClassName={DIALOG_SURFACE}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={dialogTitleId} className="text-scale-lg font-weight-semibold text-primary">
              Create dataset
            </h2>
            <p className={STATUS_MESSAGE}>
              Provide dataset metadata and IAM scopes. Fields marked with * are required.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            className={SECONDARY_BUTTON_COMPACT}
          >
            Close
          </button>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Slug *</span>
            <input
              type="text"
              value={fields.slug}
              onChange={handleChange('slug')}
              placeholder="observatory-events"
              autoComplete="off"
              disabled={isBusy}
              className={INPUT}
            />
            {fieldError.slug ? <span className="text-scale-xs text-status-danger">{fieldError.slug}</span> : null}
          </label>

          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Name *</span>
            <input
              type="text"
              value={fields.name}
              onChange={handleChange('name')}
              placeholder="Observatory events"
              autoComplete="off"
              disabled={isBusy}
              className={INPUT}
            />
            {fieldError.name ? <span className="text-scale-xs text-status-danger">{fieldError.name}</span> : null}
          </label>

          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Write format</span>
            <select
              value={fields.writeFormat}
              onChange={handleChange('writeFormat')}
              disabled={isBusy}
              className={INPUT}
            >
              <option value="duckdb">DuckDB</option>
              <option value="parquet">Parquet</option>
            </select>
          </label>

          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Status</span>
            <select
              value={fields.status}
              onChange={handleChange('status')}
              disabled={isBusy}
              className={INPUT}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>

          <label className={`sm:col-span-2 ${FIELD_GROUP}`}>
            <span className={FIELD_LABEL}>Description</span>
            <textarea
              value={fields.description}
              onChange={handleChange('description')}
              rows={3}
              disabled={isBusy}
              className={TEXTAREA}
              placeholder="Explain what this dataset contains and how it is used."
            />
            {fieldError.description ? (
              <span className="text-scale-xs text-status-danger">{fieldError.description}</span>
            ) : null}
          </label>

          <label className={`sm:col-span-2 ${FIELD_GROUP}`}>
            <span className={FIELD_LABEL}>Default storage target</span>
            <input
              type="text"
              value={fields.defaultStorageTargetId}
              onChange={handleChange('defaultStorageTargetId')}
              placeholder="st-001"
              disabled={isBusy}
              className={INPUT}
            />
            {fieldError.defaultStorageTargetId ? (
              <span className="text-scale-xs text-status-danger">{fieldError.defaultStorageTargetId}</span>
            ) : null}
          </label>

          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Read scopes</span>
            <textarea
              value={fields.readScopes}
              onChange={handleChange('readScopes')}
              rows={3}
              placeholder="timestore:read"
              disabled={isBusy}
              className={TEXTAREA}
            />
            <span className="text-scale-xs text-muted">Separate scopes with commas or new lines.</span>
            {fieldError.readScopes ? <span className="text-scale-xs text-status-danger">{fieldError.readScopes}</span> : null}
          </label>

          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Write scopes</span>
            <textarea
              value={fields.writeScopes}
              onChange={handleChange('writeScopes')}
              rows={3}
              placeholder="timestore:write"
              disabled={isBusy}
              className={TEXTAREA}
            />
            <span className="text-scale-xs text-muted">Separate scopes with commas or new lines.</span>
            {fieldError.writeScopes ? <span className="text-scale-xs text-status-danger">{fieldError.writeScopes}</span> : null}
          </label>
        </div>

        {fieldError.general ? <p className={STATUS_BANNER_DANGER}>{fieldError.general}</p> : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            className={SECONDARY_BUTTON}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isBusy}
            className={PRIMARY_BUTTON}
          >
            Create dataset
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default DatasetCreateDialog;
