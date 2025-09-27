import { useEffect, useReducer, useState } from 'react';
import Modal from '../../components/Modal';
import {
  createUploadFormState,
  normalizeRelativePath,
  parseMetadataDraft,
  uploadFormReducer,
  validateRelativePath
} from '../commandForms';

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
      contentClassName="w-full max-w-xl rounded-3xl border border-slate-200/70 bg-white/95 p-6 shadow-xl dark:border-slate-700/70 dark:bg-slate-900/80"
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="upload-file-dialog-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Upload file
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Drop a file or browse from disk. Provide the final path relative to the mount root and optional checksum.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-slate-300/70 px-3 py-1 text-sm font-semibold text-slate-600 transition hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
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
          className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-sm transition ${
            dragActive ? 'border-violet-500 bg-violet-50/70 dark:border-violet-400 dark:bg-violet-500/10' : 'border-slate-300/70 bg-slate-50/60 dark:border-slate-700/70 dark:bg-slate-800/60'
          }`}
        >
          <p className="text-slate-600 dark:text-slate-300">
            {state.file ? `Selected file: ${state.file.name}` : 'Drag & drop file here'}
          </p>
          <label className="mt-2 inline-flex items-center gap-2 rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300">
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

        <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">File path</span>
          <input
            type="text"
            value={state.path}
            onChange={(event) => dispatch({ type: 'setPath', path: event.target.value })}
            placeholder={normalizedBasePath ? `${normalizedBasePath}/example.csv` : 'datasets/example.csv'}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            disabled={disabled || state.submitting}
          />
        </label>
        {state.error ? <p className="text-xs text-rose-600 dark:text-rose-300">{state.error}</p> : null}

        <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Overwrite existing file</span>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={state.overwrite}
              onChange={(event) => dispatch({ type: 'setOverwrite', overwrite: event.target.checked })}
              disabled={disabled || state.submitting}
              className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 dark:border-slate-600"
            />
            <span>Replace if a file already exists at this path.</span>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Checksum (optional)</span>
          <input
            type="text"
            value={state.checksum}
            onChange={(event) => dispatch({ type: 'setChecksum', checksum: event.target.value })}
            placeholder="sha256:abcdef"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            disabled={disabled || state.submitting}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Metadata (JSON)</span>
          <textarea
            value={state.metadata}
            onChange={(event) => dispatch({ type: 'setMetadata', metadata: event.target.value })}
            rows={5}
            placeholder={`{
  "owner": "ops"
}`}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            disabled={disabled || state.submitting}
          />
        </label>
        {state.metadataError ? <p className="text-xs text-rose-600 dark:text-rose-300">{state.metadataError}</p> : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={disabled || state.submitting}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state.submitting ? 'Uploading…' : 'Upload file'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
