import { useEffect, useMemo, useReducer } from 'react';
import Modal from '../../components/Modal';
import type { FilestoreBackendMount } from '../types';
import {
  createMoveCopyFormState,
  moveCopyFormReducer,
  normalizeRelativePath,
  validateRelativePath
} from '../commandForms';

type MoveCopyDialogProps = {
  mode: 'move' | 'copy';
  open: boolean;
  sourcePath: string | null;
  sourceMountId: number | null;
  availableMounts: FilestoreBackendMount[];
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (input: { targetPath: string; targetMountId: number | null; overwrite: boolean }) => Promise<void>;
};

export default function MoveCopyDialog({
  mode,
  open,
  sourcePath,
  sourceMountId,
  availableMounts,
  disabled = false,
  onClose,
  onSubmit
}: MoveCopyDialogProps) {
  const initialSourcePath = sourcePath ?? '';
  const [state, dispatch] = useReducer(
    moveCopyFormReducer,
    createMoveCopyFormState({ sourcePath: initialSourcePath, targetMountId: sourceMountId ?? null })
  );

  useEffect(() => {
    if (open) {
      dispatch({
        type: 'reset',
        state: createMoveCopyFormState({
          sourcePath: initialSourcePath,
          targetMountId: sourceMountId ?? null,
          targetPath: initialSourcePath
        })
      });
    }
  }, [open, initialSourcePath, sourceMountId]);

  const handleClose = () => {
    dispatch({
      type: 'reset',
      state: createMoveCopyFormState({ sourcePath: initialSourcePath, targetMountId: sourceMountId ?? null })
    });
    onClose();
  };

  const mountOptions = useMemo(() => {
    return availableMounts.map((mount) => ({
      value: mount.id,
      label: `${mount.mountKey} · ${mount.backendKind === 'local' ? 'Local' : 'S3'}`
    }));
  }, [availableMounts]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedPath = normalizeRelativePath(state.targetPath);
    const pathError = validateRelativePath(normalizedPath);
    if (pathError) {
      dispatch({ type: 'setError', error: pathError });
      return;
    }

    dispatch({ type: 'setSubmitting', submitting: true });
    try {
      await onSubmit({
        targetPath: normalizedPath,
        targetMountId: state.targetMountId,
        overwrite: state.overwrite
      });
      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : `${mode === 'move' ? 'Move' : 'Copy'} failed`;
      dispatch({ type: 'setError', error: message });
    } finally {
      dispatch({ type: 'setSubmitting', submitting: false });
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy={`${mode}-node-dialog-title`}
      className="items-start justify-center px-4 py-8 sm:items-center"
      contentClassName="w-full max-w-xl rounded-3xl border border-slate-200/70 bg-white/95 p-6 shadow-xl dark:border-slate-700/70 dark:bg-slate-900/80"
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id={`${mode}-node-dialog-title`} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {mode === 'move' ? 'Move node' : 'Copy node'}
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {mode === 'move'
                ? 'Relocate the node to a new path. Moving will remove the original entry.'
                : 'Duplicate the node to a new path. Copying keeps the original entry.'}
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

        <div className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Source path</span>
          <code className="block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {initialSourcePath || '—'}
          </code>
        </div>

        <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Target path
          </span>
          <input
            type="text"
            value={state.targetPath}
            onChange={(event) => dispatch({ type: 'setTargetPath', path: event.target.value })}
            placeholder="datasets/archive/report.csv"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            disabled={disabled || state.submitting}
          />
        </label>
        {state.error ? <p className="text-xs text-rose-600 dark:text-rose-300">{state.error}</p> : null}

        <label className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Target mount</span>
          <select
            value={state.targetMountId ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              dispatch({ type: 'setTargetMountId', mountId: value ? Number(value) : null });
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            disabled={disabled || state.submitting}
          >
            <option value="">Same mount</option>
            {mountOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={state.overwrite}
            onChange={(event) => dispatch({ type: 'setOverwrite', overwrite: event.target.checked })}
            disabled={disabled || state.submitting}
            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 dark:border-slate-600"
          />
          Overwrite target if it already exists
        </label>

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
            {state.submitting ? (mode === 'move' ? 'Moving…' : 'Copying…') : mode === 'move' ? 'Move node' : 'Copy node'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

