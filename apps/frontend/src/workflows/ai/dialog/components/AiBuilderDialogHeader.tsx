import type { AiBuilderProvider } from '../../api';
import type { AiBuilderDialogHandlers, AiBuilderDialogState } from '../types';
import type { MODE_OPTIONS, PROVIDER_OPTIONS } from '../constants';

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
    <header className="flex items-center justify-between gap-4 border-b border-slate-200/60 bg-slate-50/60 p-6 dark:border-slate-700/60 dark:bg-slate-900/60">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">AI Workflow Builder</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Describe the automation you need and let {providerSelectionLabel} draft a job or workflow definition.
        </p>
      </div>
      <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="inline-flex rounded-full border border-slate-200/80 bg-white p-1 text-xs font-semibold shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
            {providerOptions.map(({ value, label }) => {
              const isActive = provider === value;
              const requireKey = providerKeyMissing(value);
              return (
                <button
                  key={value}
                  type="button"
                  className={`rounded-full px-4 py-1.5 transition-colors ${
                    isActive
                      ? 'bg-violet-600 text-white shadow'
                      : 'text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100'
                  } ${requireKey ? 'opacity-70' : ''}`}
                  onClick={() => handleProviderChange(value)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="inline-flex rounded-full border border-slate-200/80 bg-white p-1 text-xs font-semibold shadow-sm dark:border-slate-700/70 dark:bg-slate-800">
            {modeOptions.map(({ value, label }) => {
              const isActive = mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  className={`rounded-full px-4 py-1.5 transition-colors ${
                    isActive
                      ? 'bg-violet-600 text-white shadow'
                      : 'text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-slate-100'
                  }`}
                  onClick={() => handleModeChange(value)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {providerKeyHint ? (
          <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-300">{providerKeyHint}</span>
        ) : null}
        <button
          type="button"
          className="rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900 dark:text-slate-300"
          onClick={handleDismiss}
        >
          Close
        </button>
      </div>
    </header>
  );
}
