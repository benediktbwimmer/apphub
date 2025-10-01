import { useEffect, useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../../auth/useAuthorizedFetch';
import { Modal } from '../../components';
import { useToastHelpers } from '../../components/toast';
import { archiveDataset, updateDataset } from '../api';
import type { ArchiveDatasetRequest, DatasetRecord, PatchDatasetRequest } from '../types';
import { archiveDatasetRequestSchema, patchDatasetRequestSchema } from '../types';
import {
  DANGER_BUTTON,
  DANGER_SECONDARY_BUTTON,
  DIALOG_SURFACE_DANGER,
  FIELD_GROUP,
  FIELD_LABEL,
  INPUT,
  PANEL_SURFACE,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_META,
  STATUS_MESSAGE,
  SUCCESS_BUTTON,
  TEXTAREA
} from '../timestoreTokens';

interface DatasetAdminPanelProps {
  dataset: DatasetRecord;
  canEdit: boolean;
  onDatasetChange: (dataset: DatasetRecord) => void;
  onRequireListRefresh: () => void;
}

type EditableFields = {
  name: string;
  description: string;
  defaultStorageTargetId: string;
  readScopes: string;
  writeScopes: string;
};

type FieldErrors = Partial<Record<keyof EditableFields, string>> & {
  general?: string;
};

type ArchiveDialogState = {
  open: boolean;
  reason: string;
  error: string | null;
  submitting: boolean;
};

function toEditableFields(dataset: DatasetRecord): EditableFields {
  const readScopes = dataset.metadata?.iam?.readScopes ?? [];
  const writeScopes = dataset.metadata?.iam?.writeScopes ?? [];
  return {
    name: dataset.name ?? '',
    description: dataset.description ?? '',
    defaultStorageTargetId: dataset.defaultStorageTargetId ?? '',
    readScopes: formatScopes(readScopes),
    writeScopes: formatScopes(writeScopes)
  };
}

function formatScopes(scopes: string[]): string {
  if (!scopes || scopes.length === 0) {
    return '';
  }
  return scopes.join('\n');
}

function parseScopesInput(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeScopes(scopes: string[]): string[] {
  return Array.from(new Set(scopes.map((scope) => scope.trim()))).filter((scope) => scope.length > 0).sort();
}

function scopesChanged(nextInput: string, original: string[] | undefined): boolean {
  const next = normalizeScopes(parseScopesInput(nextInput));
  const baseline = normalizeScopes(original ?? []);
  if (next.length !== baseline.length) {
    return true;
  }
  return next.some((scope, index) => scope !== baseline[index]);
}

function buildPatchPayload(dataset: DatasetRecord, fields: EditableFields): PatchDatasetRequest | null {
  const patch: PatchDatasetRequest = {
    ifMatch: dataset.updatedAt
  };
  let changed = false;

  const trimmedName = fields.name.trim();
  if (trimmedName.length > 0 && trimmedName !== dataset.name) {
    patch.name = trimmedName;
    changed = true;
  }

  const trimmedDescription = fields.description.trim();
  const originalDescription = dataset.description ?? '';
  const normalizedDescription = trimmedDescription.length > 0 ? trimmedDescription : null;
  if ((normalizedDescription ?? '') !== originalDescription) {
    patch.description = normalizedDescription;
    changed = true;
  }

  const trimmedStorage = fields.defaultStorageTargetId.trim();
  const originalStorage = dataset.defaultStorageTargetId ?? '';
  const normalizedStorage = trimmedStorage.length > 0 ? trimmedStorage : null;
  if ((normalizedStorage ?? '') !== originalStorage) {
    patch.defaultStorageTargetId = normalizedStorage;
    changed = true;
  }

  const nextReadScopes = parseScopesInput(fields.readScopes);
  const nextWriteScopes = parseScopesInput(fields.writeScopes);
  const originalReadScopes = dataset.metadata?.iam?.readScopes ?? [];
  const originalWriteScopes = dataset.metadata?.iam?.writeScopes ?? [];

  const metadataIam: { readScopes?: string[]; writeScopes?: string[] } = {};
  if (scopesChanged(fields.readScopes, originalReadScopes)) {
    metadataIam.readScopes = nextReadScopes;
    changed = true;
  }
  if (scopesChanged(fields.writeScopes, originalWriteScopes)) {
    metadataIam.writeScopes = nextWriteScopes;
    changed = true;
  }

  if (metadataIam.readScopes !== undefined || metadataIam.writeScopes !== undefined) {
    patch.metadata = { iam: metadataIam };
  }

  return changed ? patch : null;
}

export function DatasetAdminPanel({ dataset, canEdit, onDatasetChange, onRequireListRefresh }: DatasetAdminPanelProps) {
  const authorizedFetch = useAuthorizedFetch();
  const { showSuccess, showError, showInfo } = useToastHelpers();
  const [fields, setFields] = useState<EditableFields>(() => toEditableFields(dataset));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [archiveDialog, setArchiveDialog] = useState<ArchiveDialogState>({
    open: false,
    reason: '',
    error: null,
    submitting: false
  });

  useEffect(() => {
    setFields(toEditableFields(dataset));
    setFieldErrors({});
  }, [dataset]);

  const pendingPatch = useMemo(() => buildPatchPayload(dataset, fields), [dataset, fields]);
  const hasChanges = Boolean(pendingPatch);

  const handleFieldChange = (key: keyof EditableFields) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { value } = event.target;
      setFields((prev) => ({ ...prev, [key]: value }));
    };

  const mapValidationErrors = (issues: readonly { path: (string | number)[]; message: string }[]) => {
    const nextErrors: FieldErrors = {};
    for (const issue of issues) {
      const joined = issue.path.join('.');
      if (joined.includes('readScopes')) {
        nextErrors.readScopes = issue.message;
      } else if (joined.includes('writeScopes')) {
        nextErrors.writeScopes = issue.message;
      } else if (joined === 'name') {
        nextErrors.name = issue.message;
      } else if (joined === 'description') {
        nextErrors.description = issue.message;
      } else if (joined === 'defaultStorageTargetId') {
        nextErrors.defaultStorageTargetId = issue.message;
      } else if (joined !== 'ifMatch') {
        nextErrors.general = issue.message;
      }
    }
    setFieldErrors(nextErrors);
  };

  const handleReset = () => {
    setFields(toEditableFields(dataset));
    setFieldErrors({});
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) {
      showError('Insufficient permissions', 'timestore:admin scope is required to update dataset metadata.');
      return;
    }
    if (!pendingPatch) {
      showInfo('No changes to apply');
      return;
    }
    const validation = patchDatasetRequestSchema.safeParse(pendingPatch);
    if (!validation.success) {
      mapValidationErrors(validation.error.issues);
      return;
    }

    try {
      setSaving(true);
      setFieldErrors({});
      const response = await updateDataset(authorizedFetch, dataset.id, pendingPatch);
      showSuccess('Dataset updated', 'Metadata changes saved.');
      onDatasetChange(response.dataset);
      onRequireListRefresh();
      setFields(toEditableFields(response.dataset));
    } catch (err) {
      showError('Failed to update dataset', err);
      const message = err instanceof Error ? err.message : 'Failed to update dataset';
      setFieldErrors({ general: message });
    } finally {
      setSaving(false);
    }
  };

  const handleReactivate = async () => {
    if (!canEdit || dataset.status === 'active') {
      return;
    }
    try {
      setStatusChanging(true);
      const response = await updateDataset(authorizedFetch, dataset.id, {
        status: 'active',
        ifMatch: dataset.updatedAt
      });
      showSuccess('Dataset reactivated', `${dataset.slug} is active.`);
      onDatasetChange(response.dataset);
      onRequireListRefresh();
      setFields(toEditableFields(response.dataset));
    } catch (err) {
      showError('Failed to reactivate dataset', err);
    } finally {
      setStatusChanging(false);
    }
  };

  const openArchiveDialog = () => {
    setArchiveDialog({ open: true, reason: '', error: null, submitting: false });
  };

  const closeArchiveDialog = () => {
    if (archiveDialog.submitting) {
      return;
    }
    setArchiveDialog((prev) => ({ ...prev, open: false, reason: '', error: null }));
  };

  const handleArchiveSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || dataset.status === 'inactive') {
      return;
    }
    const trimmedReason = archiveDialog.reason.trim();
    const payload: ArchiveDatasetRequest = {
      ifMatch: dataset.updatedAt
    };
    if (trimmedReason) {
      payload.reason = trimmedReason;
    }

    const validation = archiveDatasetRequestSchema.safeParse(payload);
    if (!validation.success) {
      setArchiveDialog((prev) => ({
        ...prev,
        error: validation.error.issues[0]?.message ?? 'Invalid archive request'
      }));
      return;
    }

    try {
      setArchiveDialog((prev) => ({ ...prev, submitting: true, error: null }));
      setStatusChanging(true);
      const response = await archiveDataset(authorizedFetch, dataset.id, payload);
      showSuccess('Dataset archived', `${dataset.slug} is now inactive.`);
      onDatasetChange(response.dataset);
      onRequireListRefresh();
      setFields(toEditableFields(response.dataset));
      setArchiveDialog({ open: false, reason: '', error: null, submitting: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to archive dataset';
      setArchiveDialog((prev) => ({ ...prev, error: message }));
      showError('Failed to archive dataset', err);
    } finally {
      setStatusChanging(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className={PANEL_SURFACE}>
        <header className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col">
            <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">Status</span>
            <span className="text-scale-sm font-weight-semibold text-primary">{dataset.status === 'active' ? 'Active' : 'Inactive'}</span>
            <span className={STATUS_META}>Last updated {new Date(dataset.updatedAt).toLocaleString()}</span>
          </div>
          {canEdit ? (
            dataset.status === 'active' ? (
              <button
                type="button"
                onClick={openArchiveDialog}
                disabled={statusChanging}
                className={DANGER_SECONDARY_BUTTON}
              >
                Archive dataset
              </button>
            ) : (
              <button
                type="button"
                onClick={handleReactivate}
                disabled={statusChanging}
                className={SUCCESS_BUTTON}
              >
                Reactivate dataset
              </button>
            )
          ) : (
            <span className="text-scale-xs text-muted">
              Editing requires the <code className="font-mono text-secondary">timestore:admin</code> scope.
            </span>
          )}
        </header>
        {statusChanging ? <p className={`mt-3 ${STATUS_MESSAGE}`}>Applying status change…</p> : null}
      </section>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Name</span>
            <input
              type="text"
              value={fields.name}
              onChange={handleFieldChange('name')}
              disabled={!canEdit || saving}
              className={INPUT}
            />
            {fieldErrors.name ? (
              <span className="text-scale-xs text-status-danger">{fieldErrors.name}</span>
            ) : null}
          </label>
          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Default storage target</span>
            <input
              type="text"
              value={fields.defaultStorageTargetId}
              onChange={handleFieldChange('defaultStorageTargetId')}
              disabled={!canEdit || saving}
              placeholder="st-001"
              className={INPUT}
            />
            {fieldErrors.defaultStorageTargetId ? (
              <span className="text-scale-xs text-status-danger">{fieldErrors.defaultStorageTargetId}</span>
            ) : null}
          </label>
          <label className={`sm:col-span-2 ${FIELD_GROUP}`}>
            <span className={FIELD_LABEL}>Description</span>
            <textarea
              value={fields.description}
              onChange={handleFieldChange('description')}
              rows={3}
              disabled={!canEdit || saving}
              className={TEXTAREA}
              placeholder="Describe the dataset purpose and key consumers."
            />
            {fieldErrors.description ? (
              <span className="text-scale-xs text-status-danger">{fieldErrors.description}</span>
            ) : null}
          </label>
          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Read scopes</span>
            <textarea
              value={fields.readScopes}
              onChange={handleFieldChange('readScopes')}
              rows={3}
              disabled={!canEdit || saving}
              className={TEXTAREA}
              placeholder="timestore:read"
            />
            <span className="text-scale-xs text-muted">Separate scopes with commas or new lines.</span>
            {fieldErrors.readScopes ? (
              <span className="text-scale-xs text-status-danger">{fieldErrors.readScopes}</span>
            ) : null}
          </label>
          <label className={FIELD_GROUP}>
            <span className={FIELD_LABEL}>Write scopes</span>
            <textarea
              value={fields.writeScopes}
              onChange={handleFieldChange('writeScopes')}
              rows={3}
              disabled={!canEdit || saving}
              className={TEXTAREA}
              placeholder="timestore:write"
            />
            <span className="text-scale-xs text-muted">Separate scopes with commas or new lines.</span>
            {fieldErrors.writeScopes ? (
              <span className="text-scale-xs text-status-danger">{fieldErrors.writeScopes}</span>
            ) : null}
          </label>
        </div>

        {fieldErrors.general ? <p className={STATUS_BANNER_DANGER}>{fieldErrors.general}</p> : null}

        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={!hasChanges || saving}
            className={SECONDARY_BUTTON}
          >
            Reset
          </button>
          <button
            type="submit"
            disabled={!hasChanges || saving || !canEdit}
            className={PRIMARY_BUTTON}
          >
            Save changes
          </button>
        </div>
      </form>

      <Modal
        open={archiveDialog.open}
        onClose={closeArchiveDialog}
        labelledBy="dataset-archive-dialog-title"
        className="items-start justify-center px-4 py-6 sm:items-center"
        contentClassName={DIALOG_SURFACE_DANGER}
      >
        <form className="flex flex-col gap-4" onSubmit={handleArchiveSubmit}>
          <header className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="dataset-archive-dialog-title" className="text-scale-lg font-weight-semibold text-status-danger">
                Archive dataset
              </h2>
              <p className="text-scale-sm text-secondary">
                Users lose access when a dataset is archived. Provide an optional reason for auditing.
              </p>
            </div>
            <button
              type="button"
              onClick={closeArchiveDialog}
              disabled={archiveDialog.submitting}
              className={SECONDARY_BUTTON_COMPACT}
            >
              Close
            </button>
          </header>
          <textarea
            value={archiveDialog.reason}
            onChange={(event) => setArchiveDialog((prev) => ({ ...prev, reason: event.target.value }))}
            rows={3}
            disabled={archiveDialog.submitting}
            className={TEXTAREA}
            placeholder="Explain why the dataset is being archived (optional)."
          />
          {archiveDialog.error ? <p className={STATUS_BANNER_DANGER}>{archiveDialog.error}</p> : null}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeArchiveDialog}
              disabled={archiveDialog.submitting}
              className={SECONDARY_BUTTON}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={archiveDialog.submitting}
              className={DANGER_BUTTON}
            >
              Confirm archive
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default DatasetAdminPanel;
