import { Modal } from '../../components';
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
    <Modal
      open={open}
      onClose={handlers.handleDismiss}
      closeOnBackdrop={false}
      className="items-center justify-center p-4"
      contentClassName="flex h-full w-full max-w-6xl flex-col overflow-hidden border border-subtle bg-surface-glass shadow-elevation-xl"
    >
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
    </Modal>
  );
}
