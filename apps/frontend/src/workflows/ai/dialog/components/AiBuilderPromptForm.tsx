import type { FormEvent } from 'react';
import { Spinner } from '../../../components';
import type { AiBuilderDialogHandlers, AiBuilderDialogState } from '../types';
import { formatBytes, formatTokenCount } from '../utils';

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
        <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Describe the automation
          <textarea
            className="h-40 rounded-2xl border border-slate-200/70 bg-white/80 p-3 text-sm font-normal text-slate-800 shadow-sm transition-colors focus:border-violet-500 focus:outline-none dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100"
            placeholder="Example: Build a workflow that validates service health and triggers the ai-orchestrator job when repositories are ingested."
            value={prompt}
            onChange={(event) => handlePromptChange(event.target.value)}
            disabled={pending || submitting}
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Additional notes (optional)
          <textarea
            className="h-24 rounded-2xl border border-slate-200/70 bg-white/80 p-3 text-sm font-normal text-slate-800 shadow-sm transition-colors focus:border-violet-500 focus:outline-none dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100"
            placeholder="Constraints, secrets, manual review requirements…"
            value={additionalNotes}
            onChange={(event) => handleAdditionalNotesChange(event.target.value)}
            disabled={pending || submitting}
          />
        </label>

        <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Model context preview</h4>
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              {contextLoading ? (
                <Spinner label="Loading…" size="xs" className="gap-1" iconClassName="border" />
              ) : (
                formatTokenCount(contextPreview?.tokenCount ?? null)
              )}
            </span>
          </div>
          <div className="mt-2 max-h-80 space-y-3 overflow-y-auto pr-1">
            {contextLoading && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                <Spinner label="Loading context…" size="xs" className="gap-1" iconClassName="border" />
              </p>
            )}
            {!contextLoading && contextError && (
              <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-300">{contextError}</p>
            )}
            {!contextLoading && !contextError && contextPreview && (
              <>
                <div className="space-y-2">
                  <h5 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Messages
                  </h5>
                  {contextPreview.messages.map((message, index) => (
                    <details
                      key={`${message.role}-${index}`}
                      className="rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-700/70 dark:bg-slate-950/50"
                    >
                      <summary className="flex items-center justify-between gap-3 font-semibold text-slate-700 dark:text-slate-100">
                        <span>{message.role === 'system' ? 'System prompt' : 'User prompt'}</span>
                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                          {formatTokenCount(message.tokens)}
                        </span>
                      </summary>
                      <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                        {message.content}
                      </pre>
                    </details>
                  ))}
                </div>
                <div className="space-y-2">
                  <h5 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Context files ({sortedContextFiles.length})
                  </h5>
                  {sortedContextFiles.map((file) => (
                    <details
                      key={file.path}
                      className="rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-700/70 dark:bg-slate-950/50"
                    >
                      <summary className="flex items-center justify-between gap-3 font-semibold text-slate-700 dark:text-slate-100">
                        <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {file.path}
                        </code>
                        <span className="flex items-center gap-2 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                          <span>{formatTokenCount(file.tokens)}</span>
                          <span aria-hidden="true">•</span>
                          <span>{formatBytes(file.bytes)}</span>
                        </span>
                      </summary>
                      <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                        {file.contents}
                      </pre>
                    </details>
                  ))}
                </div>
              </>
            )}
            {!contextLoading && !contextError && !contextPreview && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Context preview unavailable.</p>
            )}
          </div>
        </div>

        <details className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs shadow-sm transition-colors dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-100">
            Advanced prompt configuration
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              System prompt
              <textarea
                className="h-20 rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 font-mono text-[11px] leading-relaxed text-slate-800 shadow-inner transition-colors focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-100"
                value={systemPrompt}
                onChange={(event) => handleSystemPromptChange(event.target.value)}
                spellCheck={false}
                disabled={pending || submitting}
              />
            </label>
            <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Response instructions
              <textarea
                className="h-20 rounded-xl border border-slate-200/70 bg-slate-50/80 p-3 font-mono text-[11px] leading-relaxed text-slate-800 shadow-inner transition-colors focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700/70 dark:bg-slate-950/70 dark:text-slate-100"
                value={responseInstructions}
                onChange={(event) => handleResponseInstructionsChange(event.target.value)}
                spellCheck={false}
                disabled={pending || submitting}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400">
              <span>Adjust prompts before generating to steer the AI builder.</span>
              {promptsCustomized && (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white px-3 py-1 font-semibold text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:text-slate-100"
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
          <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-sm font-semibold text-rose-600 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </div>
        )}

        {generation && (
          <div
            className={`rounded-2xl border px-4 py-3 text-xs font-semibold shadow-sm transition-colors ${
              generation.status === 'running'
                ? 'border-violet-300/70 bg-violet-50/70 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200'
                : generation.status === 'succeeded'
                ? 'border-emerald-300/70 bg-emerald-50/70 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'
                : 'border-rose-300/70 bg-rose-50/70 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300'
            }`}
          >
            {generation.status === 'running' &&
              `${state.activeProviderLabel} is generating a suggestion. You can close the dialog and return later to resume.`}
            {generation.status === 'succeeded' && `Latest ${state.activeProviderLabel} generation completed.`}
            {generation.status === 'failed' && (generation.error ?? `${state.activeProviderLabel} generation failed.`)}
          </div>
        )}

        <div className="mt-auto flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-violet-500/80 bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending || submitting || providerRequiresKey}
          >
            {pending ? 'Generating…' : 'Generate suggestion'}
          </button>
          {hasSuggestion && (
            <button
              type="button"
              className="rounded-full border border-slate-200/70 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-200"
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
