import { useEffect, useMemo, useReducer } from 'react';
import Modal from '../../components/Modal';
import type { FilestoreBackendMount } from '../types';
import {
  createMoveCopyFormState,
  moveCopyFormReducer,
  normalizeRelativePath,
  validateRelativePath
} from '../commandForms';
import {
  CHECKBOX_INPUT,
  CODE_SURFACE,
  DIALOG_SURFACE,
  ERROR_TEXT,
  HEADER_SUBTITLE,
  HEADER_TITLE,
  INPUT_LABEL,
  INPUT_LABEL_CAPTION,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  SELECT_INPUT,
  TEXT_INPUT
} from './dialogTokens';

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
      contentClassName={DIALOG_SURFACE}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id={`${mode}-node-dialog-title`} className={HEADER_TITLE}>
              {mode === 'move' ? 'Move node' : 'Copy node'}
            </h2>
            <p className={HEADER_SUBTITLE}>
              {mode === 'move'
                ? 'Relocate the node to a new path. Moving will remove the original entry.'
                : 'Duplicate the node to a new path. Copying keeps the original entry.'}
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

        <div className="space-y-1 text-scale-sm text-secondary">
          <span className={INPUT_LABEL_CAPTION}>Source path</span>
          <code className={CODE_SURFACE}>
            {initialSourcePath || '—'}
          </code>
        </div>

        <label className={INPUT_LABEL}>
          <span className={INPUT_LABEL_CAPTION}>Target path</span>
          <input
            type="text"
            value={state.targetPath}
            onChange={(event) => dispatch({ type: 'setTargetPath', path: event.target.value })}
            placeholder="datasets/archive/report.csv"
            className={TEXT_INPUT}
            disabled={disabled || state.submitting}
          />
        </label>
        {state.error ? <p className={ERROR_TEXT}>{state.error}</p> : null}

        <label className={INPUT_LABEL}>
          <span className={INPUT_LABEL_CAPTION}>Target mount</span>
          <select
            value={state.targetMountId ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              dispatch({ type: 'setTargetMountId', mountId: value ? Number(value) : null });
            }}
            className={SELECT_INPUT}
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

        <label className="flex items-center gap-2 text-scale-sm text-secondary">
          <input
            type="checkbox"
            checked={state.overwrite}
            onChange={(event) => dispatch({ type: 'setOverwrite', overwrite: event.target.checked })}
            disabled={disabled || state.submitting}
            className={CHECKBOX_INPUT}
          />
          Overwrite target if it already exists
        </label>

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
            {state.submitting ? (mode === 'move' ? 'Moving…' : 'Copying…') : mode === 'move' ? 'Move node' : 'Copy node'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
