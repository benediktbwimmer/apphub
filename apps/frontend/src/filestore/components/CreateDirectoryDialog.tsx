import { useEffect, useReducer } from 'react';
import Modal from '../../components/Modal';
import {
  createDirectoryFormState,
  directoryFormReducer,
  normalizeRelativePath,
  parseMetadataDraft,
  validateRelativePath
} from '../commandForms';

type CreateDirectoryDialogProps = {
  open: boolean;
  basePath: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (input: { path: string; metadata?: Record<string, unknown> }) => Promise<void>;
};

export default function CreateDirectoryDialog({ open, basePath, disabled = false, onClose, onSubmit }: CreateDirectoryDialogProps) {
  const [state, dispatch] = useReducer(directoryFormReducer, createDirectoryFormState({ path: basePath ?? '' }));

  useEffect(() => {
    if (open) {
      dispatch({ type: 'reset', state: createDirectoryFormState({ path: basePath ?? '' }) });
    }
  }, [open, basePath]);

  const handleClose = () => {
    dispatch({ type: 'reset', state: createDirectoryFormState({ path: basePath ?? '' }) });
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
        metadata: metadataResult.value
      });
      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create directory';
      dispatch({ type: 'setError', error: message });
    } finally {
      dispatch({ type: 'setSubmitting', submitting: false });
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="create-directory-dialog-title"
      className="items-start justify-center px-4 py-8 sm:items-center"
      contentClassName="w-full max-w-xl rounded-3xl border border-slate-200/70 bg-white/95 p-6 shadow-xl dark:border-slate-700/70 dark:bg-slate-900/80"
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-directory-dialog-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Create directory
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Provide the full relative path for the new directory and optional metadata overrides.
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

        <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Directory path
          </span>
          <input
            type="text"
            value={state.path}
            onChange={(event) => dispatch({ type: 'setPath', path: event.target.value })}
            placeholder="datasets/observatory/archive"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            disabled={disabled || state.submitting}
          />
        </label>
        {state.error ? <p className="text-xs text-rose-600 dark:text-rose-300">{state.error}</p> : null}

        <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Metadata (JSON)</span>
          <textarea
            value={state.metadata}
            onChange={(event) => dispatch({ type: 'setMetadata', metadata: event.target.value })}
            rows={6}
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
            {state.submitting ? 'Creating…' : 'Create directory'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
