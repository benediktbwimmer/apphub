import type { FormEvent } from 'react';
import { FormActions, FormButton, FormField, FormFeedback } from '../../components/form';
import { Modal, Spinner } from '../../components';
import type { ServiceManifestScenario } from '../examples';
import type { ManifestPlaceholder } from '../useImportServiceManifest';

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

const PLACEHOLDER_INPUT_CLASSES =
  'rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:focus:border-slate-300 dark:focus:ring-slate-500/40';

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
      contentClassName="max-h-[calc(100vh-4rem)] overflow-y-auto border-0 bg-white p-6 text-slate-800 shadow-2xl dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.35em] text-violet-600 dark:text-violet-300">
            Example service manifest
          </span>
          <h2 id={dialogTitleId} className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {scenario.title}
          </h2>
          {scenario.summary ? (
            <p id={dialogDescriptionId} className="text-sm text-slate-600 dark:text-slate-300">
              {scenario.summary}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
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
              <span className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
                {placeholder.description ? <span>{placeholder.description}</span> : null}
                {placeholder.defaultValue !== undefined && placeholder.defaultValue !== null && placeholder.defaultValue !== '' ? (
                  <span>
                    Default: <code>{placeholder.defaultValue}</code>
                  </span>
                ) : null}
                {placeholder.conflicts.length > 0 ? (
                  <span className="text-rose-500">Conflicts: {placeholder.conflicts.join(', ')}</span>
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
                  className={PLACEHOLDER_INPUT_CLASSES}
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
