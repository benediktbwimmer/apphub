import type { FormEvent } from 'react';
import { FormActions, FormButton, FormField, FormFeedback } from '../../components/form';
import { Modal, Spinner } from '../../components';
import type { ServiceManifestScenario } from '../examples';
import type { ManifestPlaceholder } from '../useImportServiceManifest';
import {
  FORM_HINT,
  FORM_HINT_DANGER,
  HEADING_PRIMARY,
  INPUT,
  SECONDARY_BUTTON,
  SECTION_LABEL,
  SUBTEXT
} from '../importTokens';

export type ServicePlaceholderDialogProps = {
  open: boolean;
  scenario: ServiceManifestScenario | null;
  placeholders: ManifestPlaceholder[];
  variables: Record<string, string>;
  submitting: boolean;
  error: string | null;
  onChange: (name: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function ServicePlaceholderDialog({
  open,
  scenario,
  placeholders,
  variables,
  submitting,
  error,
  onChange,
  onSubmit,
  onCancel
}: ServicePlaceholderDialogProps) {
  if (!open || !scenario) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  const dialogTitleId = 'service-placeholder-dialog-title';
  const dialogDescriptionId = 'service-placeholder-dialog-description';

  return (
    <Modal
      open={open}
      onClose={onCancel}
      closeOnBackdrop={false}
      labelledBy={dialogTitleId}
      describedBy={scenario.summary ? dialogDescriptionId : undefined}
      className="items-start justify-center px-4 py-8"
      contentClassName="max-h-[calc(100vh-4rem)] overflow-y-auto border-0 bg-surface-glass p-6 text-primary shadow-elevation-xl"
    >
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className={SECTION_LABEL}>
            Example service manifest
          </span>
          <h2 id={dialogTitleId} className={HEADING_PRIMARY}>
            {scenario.title}
          </h2>
          {scenario.summary ? (
            <p id={dialogDescriptionId} className={SUBTEXT}>
              {scenario.summary}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel import
        </button>
      </div>

      <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4">
          {placeholders.map((placeholder) => {
            const normalizedId = placeholder.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
            const hintContent = (
              <span className={FORM_HINT}>
                {placeholder.description ? <span>{placeholder.description}</span> : null}
                {placeholder.defaultValue !== undefined && placeholder.defaultValue !== null && placeholder.defaultValue !== '' ? (
                  <span>
                    Default: <code>{placeholder.defaultValue}</code>
                  </span>
                ) : null}
                {placeholder.conflicts.length > 0 ? (
                  <span className={FORM_HINT_DANGER}>Conflicts: {placeholder.conflicts.join(', ')}</span>
                ) : null}
              </span>
            );
            const label = placeholder.required || placeholder.missing
              ? `${placeholder.name} *`
              : placeholder.name;
            const value = variables[placeholder.name] ?? '';
            return (
              <FormField key={placeholder.name} label={label} htmlFor={normalizedId} hint={hintContent}>
                <input
                  id={normalizedId}
                  type="text"
                  className={INPUT}
                  value={value}
                  onChange={(event) => onChange(placeholder.name, event.target.value)}
                  required={placeholder.required}
                  disabled={submitting}
                />
              </FormField>
            );
          })}
        </div>

        {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}

        <FormActions>
          <FormButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </FormButton>
          <FormButton type="submit" size="sm" disabled={submitting}>
            {submitting ? <Spinner size="xs" label="Importing" /> : 'Import service manifest'}
          </FormButton>
        </FormActions>
      </form>
    </Modal>
  );
}
