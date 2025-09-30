import type { AiBuilderProvider } from '../../api';
import type { AiBuilderDialogHandlers, AiBuilderDialogState } from '../types';
import type { MODE_OPTIONS, PROVIDER_OPTIONS } from '../constants';

const HEADER_CONTAINER =
  'flex items-center justify-between gap-4 border-b border-subtle bg-surface-glass p-6';

const TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

const SUBTITLE_CLASSES = 'text-scale-sm text-secondary';

const SEGMENTED_WRAPPER =
  'inline-flex rounded-full border border-subtle bg-surface-glass p-1 text-scale-xs font-weight-semibold shadow-elevation-sm';

const SEGMENT_BUTTON_BASE =
  'rounded-full px-4 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const SEGMENT_BUTTON_ACTIVE = 'bg-accent text-inverse shadow-elevation-sm';

const SEGMENT_BUTTON_INACTIVE = 'text-secondary hover:text-accent-strong';

const ACTION_BUTTON_CLASSES =
  'rounded-full border border-subtle bg-surface-glass px-3 py-1.5 text-scale-sm font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export type ProviderOption = typeof PROVIDER_OPTIONS[number];
export type ModeOption = typeof MODE_OPTIONS[number];

type Props = {
  state: Pick<AiBuilderDialogState, 'provider' | 'mode' | 'providerSelectionLabel' | 'providerKeyHint'>;
  handlers: Pick<AiBuilderDialogHandlers, 'handleDismiss' | 'handleProviderChange' | 'handleModeChange'>;
  helpers: {
    providerKeyMissing: (provider: AiBuilderProvider) => boolean;
  };
  providerOptions: ProviderOption[];
  modeOptions: ModeOption[];
};

export function AiBuilderDialogHeader({ state, handlers, helpers, providerOptions, modeOptions }: Props) {
  const { provider, mode, providerSelectionLabel, providerKeyHint } = state;
  const { handleDismiss, handleModeChange, handleProviderChange } = handlers;
  const { providerKeyMissing } = helpers;

  return (
    <header className={HEADER_CONTAINER}>
      <div>
        <h2 className={TITLE_CLASSES}>AI Workflow Builder</h2>
        <p className={SUBTITLE_CLASSES}>
          Describe the automation you need and let {providerSelectionLabel} draft a job or workflow definition.
        </p>
      </div>
      <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className={SEGMENTED_WRAPPER}>
            {providerOptions.map(({ value, label }) => {
              const isActive = provider === value;
              const requireKey = providerKeyMissing(value);
              return (
                <button
                  key={value}
                  type="button"
                  className={`${SEGMENT_BUTTON_BASE} ${isActive ? SEGMENT_BUTTON_ACTIVE : SEGMENT_BUTTON_INACTIVE} ${requireKey ? 'opacity-70' : ''}`}
                  onClick={() => handleProviderChange(value)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className={SEGMENTED_WRAPPER}>
            {modeOptions.map(({ value, label }) => {
              const isActive = mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  className={`${SEGMENT_BUTTON_BASE} ${isActive ? SEGMENT_BUTTON_ACTIVE : SEGMENT_BUTTON_INACTIVE}`}
                  onClick={() => handleModeChange(value)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {providerKeyHint ? (
          <span className="text-[11px] font-weight-semibold text-status-warning">{providerKeyHint}</span>
        ) : null}
        <button
          type="button"
          className={ACTION_BUTTON_CLASSES}
          onClick={handleDismiss}
        >
          Close
        </button>
      </div>
    </header>
  );
}
