import { useEffect, useMemo, useReducer } from 'react';
import Modal from '../../components/Modal';
import { createDeleteFormState, deleteFormReducer } from '../commandForms';
import {
  ALERT_SURFACE_DANGER,
  CHECKBOX_INPUT,
  CODE_SURFACE_DANGER,
  DIALOG_SURFACE_DANGER,
  ERROR_TEXT,
  HEADER_SUBTITLE,
  HEADER_TITLE_DANGER,
  INPUT_LABEL,
  INPUT_LABEL_CAPTION,
  PRIMARY_BUTTON_DANGER,
  SECONDARY_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  TEXT_INPUT_DANGER
} from './dialogTokens';

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
      contentClassName={DIALOG_SURFACE_DANGER}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="delete-node-dialog-title" className={HEADER_TITLE_DANGER}>
              Soft-delete node
            </h2>
            <p className={HEADER_SUBTITLE}>
              This marks the node as deleted in the catalog. Content removal is performed asynchronously by workers.
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

        <div className={ALERT_SURFACE_DANGER}>
          <p>
            Confirming will delete
            <code className={CODE_SURFACE_DANGER}>
              {effectivePath || '—'}
            </code>
            and all descendants if recursive deletion is enabled.
          </p>
        </div>

        <label className="flex items-center gap-2 text-scale-sm text-secondary">
          <input
            type="checkbox"
            checked={state.recursive}
            onChange={(event) => dispatch({ type: 'setRecursive', recursive: event.target.checked })}
            disabled={disabled || state.submitting}
            className={`${CHECKBOX_INPUT} text-status-danger focus-visible:outline-status-danger`}
          />
          Delete descendants recursively
        </label>

        <label className={INPUT_LABEL}>
          <span className={INPUT_LABEL_CAPTION}>
            Type "{requiredConfirmation}" to confirm
          </span>
          <input
            type="text"
            value={state.confirmation}
            onChange={(event) => dispatch({ type: 'setConfirmation', confirmation: event.target.value })}
            className={TEXT_INPUT_DANGER}
            disabled={disabled || state.submitting}
          />
        </label>
        {state.error ? <p className={ERROR_TEXT}>{state.error}</p> : null}

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
            className={PRIMARY_BUTTON_DANGER}
          >
            {state.submitting ? 'Deleting…' : 'Soft-delete'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
