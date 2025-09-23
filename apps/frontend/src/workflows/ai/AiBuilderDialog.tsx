import { MODE_OPTIONS, PROVIDER_OPTIONS } from './dialog/constants';
import { AiBuilderDialogHeader } from './dialog/components/AiBuilderDialogHeader';
import { AiBuilderPromptForm } from './dialog/components/AiBuilderPromptForm';
import { AiBuilderSuggestionPanel } from './dialog/components/AiBuilderSuggestionPanel';
import { useAiBuilderDialogState } from './dialog/useAiBuilderDialogState';
import type { AiBuilderDialogProps } from './dialog/types';

export default function AiBuilderDialog(props: AiBuilderDialogProps) {
  const { open } = props;
  const { state, handlers, helpers } = useAiBuilderDialogState(props);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-2xl dark:border-slate-700/70 dark:bg-slate-900">
        <AiBuilderDialogHeader
          state={state}
          handlers={handlers}
          helpers={helpers}
          providerOptions={PROVIDER_OPTIONS}
          modeOptions={MODE_OPTIONS}
        />

        <div className="grid flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[360px_1fr]">
          <AiBuilderPromptForm state={state} handlers={handlers} />
          <AiBuilderSuggestionPanel state={state} handlers={handlers} />
        </div>
      </div>
    </div>
  );
}
