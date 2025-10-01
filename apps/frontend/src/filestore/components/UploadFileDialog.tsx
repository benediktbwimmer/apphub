import { useEffect, useReducer, useState } from 'react';
import Modal from '../../components/Modal';
import {
  createUploadFormState,
  normalizeRelativePath,
  parseMetadataDraft,
  uploadFormReducer,
  validateRelativePath
} from '../commandForms';
import {
  CHECKBOX_INPUT,
  DIALOG_SURFACE,
  ERROR_TEXT,
  HEADER_SUBTITLE,
  HEADER_TITLE,
  INPUT_LABEL,
  INPUT_LABEL_CAPTION,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  TEXTAREA_INPUT,
  TEXT_INPUT
} from './dialogTokens';

type UploadFileDialogProps = {
  open: boolean;
  basePath: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (input: {
    path: string;
    file: File;
    overwrite: boolean;
    metadata?: Record<string, unknown>;
    checksum?: string;
  }) => Promise<void>;
};

const DROPZONE_BASE =
  'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-scale-sm transition-colors';
const DROPZONE_ACTIVE = 'border-accent bg-accent-soft text-accent shadow-elevation-md';
const DROPZONE_IDLE = 'border-subtle bg-surface-glass-soft text-secondary';

export default function UploadFileDialog({ open, basePath, disabled = false, onClose, onSubmit }: UploadFileDialogProps) {
  const [state, dispatch] = useReducer(uploadFormReducer, createUploadFormState({ path: basePath ?? '' }));
  const [dragActive, setDragActive] = useState(false);

  const normalizedBasePath = basePath ? normalizeRelativePath(basePath) : '';

  useEffect(() => {
    if (open) {
      dispatch({ type: 'reset', state: createUploadFormState({ path: basePath ?? '', overwrite: false }) });
      setDragActive(false);
    }
  }, [open, basePath]);

  const handleClose = () => {
    dispatch({ type: 'reset', state: createUploadFormState({ path: basePath ?? '', overwrite: false }) });
    setDragActive(false);
    onClose();
  };

  const applyFile = (file: File | null) => {
    dispatch({ type: 'setFile', file });
    if (!file) {
      return;
    }
    const trimmedName = file.name?.trim();
    if (!trimmedName) {
      return;
    }
    const normalizedCurrentPath = normalizeRelativePath(state.path);
    if (!normalizedCurrentPath || normalizedCurrentPath === normalizedBasePath) {
      const nextPath = normalizedBasePath ? `${normalizedBasePath}/${trimmedName}` : trimmedName;
      dispatch({ type: 'setPath', path: nextPath });
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) {
      applyFile(file);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!state.file) {
      dispatch({ type: 'setError', error: 'Select a file to upload.' });
      return;
    }

    const normalizedPath = normalizeRelativePath(state.path);
    const pathError = validateRelativePath(normalizedPath);
    if (pathError) {
      dispatch({ type: 'setError', error: pathError });
      return;
    }

    const metadataResult = parseMetadataDraft(state.metadata);
    if (!metadataResult.success) {
      dispatch({ type: 'setMetadataError', error: metadataResult.error });
      return;
    }

    dispatch({ type: 'setSubmitting', submitting: true });
    try {
      await onSubmit({
        path: normalizedPath,
        file: state.file,
        overwrite: state.overwrite,
        metadata: metadataResult.value,
        checksum: state.checksum.trim().length > 0 ? state.checksum.trim() : undefined
      });
      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      dispatch({ type: 'setError', error: message });
    } finally {
      dispatch({ type: 'setSubmitting', submitting: false });
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="upload-file-dialog-title"
      className="items-start justify-center px-4 py-8 sm:items-center"
      contentClassName={DIALOG_SURFACE}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="upload-file-dialog-title" className={HEADER_TITLE}>
              Upload file
            </h2>
            <p className={HEADER_SUBTITLE}>
              Drop a file or browse from disk. Provide the final path relative to the mount root and optional checksum.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className={SECONDARY_BUTTON_COMPACT}
          >
            Close
          </button>
        </header>

        <div
          onDragEnter={(event) => {
            event.preventDefault();
            if (!disabled && !state.submitting) {
              setDragActive(true);
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={handleDrop}
          className={`${DROPZONE_BASE} ${dragActive ? DROPZONE_ACTIVE : DROPZONE_IDLE}`}
        >
          <p className="text-secondary">
            {state.file ? `Selected file: ${state.file.name}` : 'Drag & drop file here'}
          </p>
          <label className={`mt-2 inline-flex items-center gap-2 ${SECONDARY_BUTTON}`}>
            <input
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                applyFile(file);
              }}
              disabled={disabled || state.submitting}
            />
            Browse…
          </label>
        </div>

        <label className={INPUT_LABEL}>
          <span className={INPUT_LABEL_CAPTION}>File path</span>
          <input
            type="text"
            value={state.path}
            onChange={(event) => dispatch({ type: 'setPath', path: event.target.value })}
            placeholder={normalizedBasePath ? `${normalizedBasePath}/example.csv` : 'datasets/example.csv'}
            className={TEXT_INPUT}
            disabled={disabled || state.submitting}
          />
        </label>
        {state.error ? <p className={ERROR_TEXT}>{state.error}</p> : null}

        <label className={INPUT_LABEL}>
          <span className={INPUT_LABEL_CAPTION}>Overwrite existing file</span>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={state.overwrite}
              onChange={(event) => dispatch({ type: 'setOverwrite', overwrite: event.target.checked })}
              disabled={disabled || state.submitting}
              className={CHECKBOX_INPUT}
            />
            <span className="text-secondary">Replace if a file already exists at this path.</span>
          </div>
        </label>

        <label className={INPUT_LABEL}>
          <span className={INPUT_LABEL_CAPTION}>Checksum (optional)</span>
          <input
            type="text"
            value={state.checksum}
            onChange={(event) => dispatch({ type: 'setChecksum', checksum: event.target.value })}
            placeholder="sha256:abcdef"
            className={TEXT_INPUT}
            disabled={disabled || state.submitting}
          />
        </label>

        <label className={INPUT_LABEL}>
          <span className={INPUT_LABEL_CAPTION}>Metadata (JSON)</span>
          <textarea
            value={state.metadata}
            onChange={(event) => dispatch({ type: 'setMetadata', metadata: event.target.value })}
            rows={5}
            placeholder={`{
  "owner": "ops"
}`}
            className={TEXTAREA_INPUT}
            disabled={disabled || state.submitting}
          />
        </label>
        {state.metadataError ? <p className={ERROR_TEXT}>{state.metadataError}</p> : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className={SECONDARY_BUTTON}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={disabled || state.submitting}
            className={PRIMARY_BUTTON}
          >
            {state.submitting ? 'Uploading…' : 'Upload file'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
