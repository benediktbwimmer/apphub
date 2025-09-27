import { useEffect, useMemo, useReducer } from 'react';
import Modal from '../../components/Modal';
import { createDeleteFormState, deleteFormReducer } from '../commandForms';

type DeleteNodeDialogProps = {
  open: boolean;
  path: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (input: { path: string; recursive: boolean }) => Promise<void>;
};

export default function DeleteNodeDialog({ open, path, disabled = false, onClose, onSubmit }: DeleteNodeDialogProps) {
  const effectivePath = path ?? '';
  const [state, dispatch] = useReducer(deleteFormReducer, createDeleteFormState({ path: effectivePath }));

  useEffect(() => {
    if (open) {
      dispatch({ type: 'reset', state: createDeleteFormState({ path: effectivePath, recursive: false }) });
    }
  }, [open, effectivePath]);

  const handleClose = () => {
    dispatch({ type: 'reset', state: createDeleteFormState({ path: effectivePath, recursive: false }) });
    onClose();
  };

  const requiredConfirmation = useMemo(() => {
    const segments = effectivePath.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? effectivePath;
  }, [effectivePath]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requiredConfirmation || state.confirmation.trim().toLowerCase() !== requiredConfirmation.toLowerCase()) {
      dispatch({ type: 'setError', error: `Type "${requiredConfirmation}" to confirm.` });
      return;
    }

    dispatch({ type: 'setSubmitting', submitting: true });
    try {
      await onSubmit({ path: effectivePath, recursive: state.recursive });
      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      dispatch({ type: 'setError', error: message });
    } finally {
      dispatch({ type: 'setSubmitting', submitting: false });
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="delete-node-dialog-title"
      role="alertdialog"
      className="items-start justify-center px-4 py-8 sm:items-center"
      contentClassName="w-full max-w-lg rounded-3xl border border-rose-200/80 bg-white/95 p-6 shadow-xl dark:border-rose-700/50 dark:bg-slate-900/80"
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="delete-node-dialog-title" className="text-lg font-semibold text-rose-700 dark:text-rose-200">
              Soft-delete node
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              This marks the node as deleted in the catalog. Content removal is performed asynchronously by workers.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-rose-200/80 px-3 py-1 text-sm font-semibold text-rose-600 transition hover:bg-rose-100/60 dark:border-rose-700/60 dark:text-rose-200"
          >
            Close
          </button>
        </header>

        <div className="space-y-2 rounded-2xl border border-rose-200/80 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-700/50 dark:bg-rose-900/30 dark:text-rose-200">
          <p>
            Confirming will delete
            <code className="mx-1 rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs text-rose-700 dark:bg-rose-900/60 dark:text-rose-200">
              {effectivePath || '—'}
            </code>
            and all descendants if recursive deletion is enabled.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={state.recursive}
            onChange={(event) => dispatch({ type: 'setRecursive', recursive: event.target.checked })}
            disabled={disabled || state.submitting}
            className="h-4 w-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500 dark:border-rose-600"
          />
          Delete descendants recursively
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Type "{requiredConfirmation}" to confirm
          </span>
          <input
            type="text"
            value={state.confirmation}
            onChange={(event) => dispatch({ type: 'setConfirmation', confirmation: event.target.value })}
            className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-rose-500 focus:outline-none dark:border-rose-700 dark:bg-slate-900 dark:text-slate-100"
            disabled={disabled || state.submitting}
          />
        </label>
        {state.error ? <p className="text-xs text-rose-600 dark:text-rose-300">{state.error}</p> : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-rose-200/80 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-100/60 dark:border-rose-700/60 dark:text-rose-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={disabled || state.submitting}
            className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state.submitting ? 'Deleting…' : 'Soft-delete'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

