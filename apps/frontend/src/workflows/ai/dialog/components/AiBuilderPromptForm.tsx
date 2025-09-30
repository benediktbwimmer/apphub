import type { FormEvent } from 'react';
import { Spinner } from '../../../../components';
import { getStatusToneClasses } from '../../../../theme/statusTokens';
import type { AiBuilderDialogHandlers, AiBuilderDialogState } from '../types';
import { formatBytes, formatTokenCount } from '../utils';

const FORM_LABEL_CLASSES = 'flex flex-col gap-2 text-scale-sm font-weight-semibold text-primary';

const TEXTAREA_BASE =
  'rounded-2xl border border-subtle bg-surface-glass px-3 py-3 text-scale-sm text-primary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted';

const CONTEXT_CARD_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass px-4 py-3 text-scale-xs text-secondary shadow-elevation-md';

const CONTEXT_SECTION_HEADING = 'text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary';

const CONTEXT_DETAIL_CLASSES =
  'rounded-xl border border-subtle bg-surface-muted px-3 py-3 transition-colors';

const CONTEXT_SUMMARY_CLASSES = 'flex items-center justify-between gap-3 font-weight-semibold text-primary';

const CONTEXT_META_TEXT = 'text-scale-xs font-weight-medium text-muted';

const CONTEXT_PREVIEW_TEXT =
  'mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-scale-xs leading-relaxed text-secondary';

const ADVANCED_DETAILS_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass px-4 py-3 text-scale-xs text-secondary shadow-elevation-md transition-colors';

const ADVANCED_SUMMARY_CLASSES =
  'cursor-pointer text-scale-sm font-weight-semibold text-primary focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const ADVANCED_TEXTAREA_CLASSES =
  'rounded-xl border border-subtle bg-surface-muted px-3 py-3 font-mono text-scale-xs leading-relaxed text-primary shadow-inner transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70 disabled:text-muted';

const TERTIARY_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY_BUTTON_CLASSES =
  'inline-flex items-center justify-center gap-2 rounded-full border border-accent bg-accent px-5 py-2 text-scale-sm font-weight-semibold text-inverse shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const SECONDARY_BUTTON_CLASSES =
  'rounded-full border border-subtle bg-surface-glass px-4 py-2 text-scale-sm font-weight-semibold text-secondary shadow-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const ALERT_BASE_CLASSES = 'rounded-2xl border px-4 py-3 shadow-elevation-md transition-colors';

type Props = {
  state: Pick<
    AiBuilderDialogState,
    | 'prompt'
    | 'additionalNotes'
    | 'systemPrompt'
    | 'responseInstructions'
    | 'pending'
    | 'submitting'
    | 'contextPreview'
    | 'contextLoading'
    | 'contextError'
    | 'hasSuggestion'
    | 'promptsCustomized'
    | 'providerRequiresKey'
    | 'generation'
    | 'activeProviderLabel'
    | 'error'
  >;
  handlers: Pick<
    AiBuilderDialogHandlers,
    |
      'handleGenerate'
    | 'handlePromptChange'
    | 'handleAdditionalNotesChange'
    | 'handleSystemPromptChange'
    | 'handleResponseInstructionsChange'
    | 'handleResetPrompts'
  >;
};

export function AiBuilderPromptForm({ state, handlers }: Props) {
  const {
    prompt,
    additionalNotes,
    systemPrompt,
    responseInstructions,
    pending,
    submitting,
    contextPreview,
    contextLoading,
    contextError,
    hasSuggestion,
    promptsCustomized,
    providerRequiresKey,
    generation,
    error
  } = state;
  const {
    handleGenerate,
    handlePromptChange,
    handleAdditionalNotesChange,
    handleSystemPromptChange,
    handleResponseInstructionsChange,
    handleResetPrompts
  } = handlers;

  const sortedContextFiles = contextPreview
    ? [...contextPreview.contextFiles].sort((a, b) => {
        const aTokens = a.tokens ?? -1;
        const bTokens = b.tokens ?? -1;
        if (aTokens === bTokens) {
          return b.bytes - a.bytes;
        }
        return bTokens - aTokens;
      })
    : [];

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    void handleGenerate(event);
  };

  return (
    <section className="flex flex-col gap-4">
      <form className="flex flex-1 flex-col gap-4" onSubmit={onSubmit}>
        <label className={FORM_LABEL_CLASSES}>
          Describe the automation
          <textarea
            className={`${TEXTAREA_BASE} h-40`}
            placeholder="Example: Build a workflow that validates service health and triggers the ai-orchestrator job when repositories are ingested."
            value={prompt}
            onChange={(event) => handlePromptChange(event.target.value)}
            disabled={pending || submitting}
          />
        </label>

        <label className={FORM_LABEL_CLASSES}>
          Additional notes (optional)
          <textarea
            className={`${TEXTAREA_BASE} h-24`}
            placeholder="Constraints, secrets, manual review requirements…"
            value={additionalNotes}
            onChange={(event) => handleAdditionalNotesChange(event.target.value)}
            disabled={pending || submitting}
          />
        </label>

        <div className={CONTEXT_CARD_CLASSES}>
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-scale-sm font-weight-semibold text-primary">Model context preview</h4>
            <span className={CONTEXT_META_TEXT}>
              {contextLoading ? (
                <Spinner label="Loading…" size="xs" className="gap-1" iconClassName="border" />
              ) : (
                formatTokenCount(contextPreview?.tokenCount ?? null)
              )}
            </span>
          </div>
          <div className="mt-2 max-h-80 space-y-3 overflow-y-auto pr-1">
            {contextLoading && (
              <p className="text-scale-xs text-secondary">
                <Spinner label="Loading context…" size="xs" className="gap-1" iconClassName="border" />
              </p>
            )}
            {!contextLoading && contextError && (
              <p className="text-scale-xs font-weight-semibold text-status-danger">{contextError}</p>
            )}
            {!contextLoading && !contextError && contextPreview && (
              <>
                <div className="space-y-2">
                  <h5 className={CONTEXT_SECTION_HEADING}>
                    Messages
                  </h5>
                  {contextPreview.messages.map((message, index) => (
                    <details
                      key={`${message.role}-${index}`}
                      className={CONTEXT_DETAIL_CLASSES}
                    >
                      <summary className={CONTEXT_SUMMARY_CLASSES}>
                        <span>{message.role === 'system' ? 'System prompt' : 'User prompt'}</span>
                        <span className={CONTEXT_META_TEXT}>
                          {formatTokenCount(message.tokens)}
                        </span>
                      </summary>
                      <pre className={CONTEXT_PREVIEW_TEXT}>
                        {message.content}
                      </pre>
                    </details>
                  ))}
                </div>
                <div className="space-y-2">
                  <h5 className={CONTEXT_SECTION_HEADING}>
                    Context files ({sortedContextFiles.length})
                  </h5>
                  {sortedContextFiles.map((file) => (
                    <details
                      key={file.path}
                      className={CONTEXT_DETAIL_CLASSES}
                    >
                      <summary className={CONTEXT_SUMMARY_CLASSES}>
                        <code className="rounded bg-surface-glass px-1 py-0.5 text-scale-xs text-secondary">
                          {file.path}
                        </code>
                        <span className="flex items-center gap-2 text-scale-xs font-weight-medium text-muted">
                          <span>{formatTokenCount(file.tokens)}</span>
                          <span aria-hidden="true">•</span>
                          <span>{formatBytes(file.bytes)}</span>
                        </span>
                      </summary>
                      <pre className={CONTEXT_PREVIEW_TEXT}>
                        {file.contents}
                      </pre>
                    </details>
                  ))}
                </div>
              </>
            )}
            {!contextLoading && !contextError && !contextPreview && (
              <p className="text-scale-xs text-secondary">Context preview unavailable.</p>
            )}
          </div>
        </div>

        <details className={ADVANCED_DETAILS_CLASSES}>
          <summary className={ADVANCED_SUMMARY_CLASSES}>
            Advanced prompt configuration
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-2 text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary">
              System prompt
              <textarea
                className={`${ADVANCED_TEXTAREA_CLASSES} h-20`}
                value={systemPrompt}
                onChange={(event) => handleSystemPromptChange(event.target.value)}
                spellCheck={false}
                disabled={pending || submitting}
              />
            </label>
            <label className="flex flex-col gap-2 text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary">
              Response instructions
              <textarea
                className={`${ADVANCED_TEXTAREA_CLASSES} h-20`}
                value={responseInstructions}
                onChange={(event) => handleResponseInstructionsChange(event.target.value)}
                spellCheck={false}
                disabled={pending || submitting}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3 text-scale-xs text-secondary">
              <span>Adjust prompts before generating to steer the AI builder.</span>
              {promptsCustomized && (
                <button
                  type="button"
                  className={TERTIARY_BUTTON_CLASSES}
                  onClick={handleResetPrompts}
                  disabled={pending || submitting}
                >
                  Reset prompts
                </button>
              )}
            </div>
          </div>
        </details>

        {error && (
          <div className={`${ALERT_BASE_CLASSES} text-scale-sm font-weight-semibold ${getStatusToneClasses('error')}`}>
            {error}
          </div>
        )}

        {generation && (
          <div className={`${ALERT_BASE_CLASSES} text-scale-xs font-weight-semibold ${getStatusToneClasses(generation.status)}`}>
            {generation.status === 'running' &&
              `${state.activeProviderLabel} is generating a suggestion. You can close the dialog and return later to resume.`}
            {generation.status === 'succeeded' && `Latest ${state.activeProviderLabel} generation completed.`}
            {generation.status === 'failed' && (generation.error ?? `${state.activeProviderLabel} generation failed.`)}
          </div>
        )}

        <div className="mt-auto flex items-center gap-3">
          <button
            type="submit"
            className={PRIMARY_BUTTON_CLASSES}
            disabled={pending || submitting || providerRequiresKey}
          >
            {pending ? 'Generating…' : 'Generate suggestion'}
          </button>
          {hasSuggestion && (
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASSES}
              onClick={() => void handleGenerate()}
              disabled={pending || submitting || providerRequiresKey}
            >
              Regenerate
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
