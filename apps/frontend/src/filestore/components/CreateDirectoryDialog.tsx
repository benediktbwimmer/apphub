import { useEffect, useReducer } from 'react';
import Modal from '../../components/Modal';
import {
  createDirectoryFormState,
  directoryFormReducer,
  normalizeRelativePath,
  parseMetadataDraft,
  validateRelativePath
} from '../commandForms';
import {
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
      contentClassName={DIALOG_SURFACE}
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-directory-dialog-title" className={HEADER_TITLE}>
              Create directory
            </h2>
            <p className={HEADER_SUBTITLE}>
              Provide the full relative path for the new directory and optional metadata overrides.
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

        <label className={INPUT_LABEL}>
          <span className={INPUT_LABEL_CAPTION}>
            Directory path
          </span>
          <input
            type="text"
            value={state.path}
            onChange={(event) => dispatch({ type: 'setPath', path: event.target.value })}
            placeholder="datasets/observatory/archive"
            className={TEXT_INPUT}
            disabled={disabled || state.submitting}
          />
        </label>
        {state.error ? <p className={ERROR_TEXT}>{state.error}</p> : null}

        <label className={INPUT_LABEL}>
          <span className={INPUT_LABEL_CAPTION}>Metadata (JSON)</span>
          <textarea
            value={state.metadata}
            onChange={(event) => dispatch({ type: 'setMetadata', metadata: event.target.value })}
            rows={6}
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
            {state.submitting ? 'Creating…' : 'Create directory'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
