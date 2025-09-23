import type { AiBuilderMode, AiBuilderProvider } from '../api';

export const MODE_OPTIONS: { value: AiBuilderMode; label: string }[] = [
  { value: 'workflow', label: 'Workflow' },
  { value: 'workflow-with-jobs', label: 'Workflow + jobs' },
  { value: 'job', label: 'Job' },
  { value: 'job-with-bundle', label: 'Job + bundle' }
];

export const PROVIDER_OPTIONS: {
  value: AiBuilderProvider;
  label: string;
  description: string;
}[] = [
  {
    value: 'codex',
    label: 'Codex CLI',
    description: 'Runs through the host Codex proxy. Provides streaming stdout/stderr.'
  },
  {
    value: 'openai',
    label: 'OpenAI GPT-5',
    description: 'Calls the OpenAI API with high reasoning effort to draft structured output.'
  },
  {
    value: 'openrouter',
    label: 'Grok 4 (OpenRouter)',
    description: "Uses OpenRouter to access xAI's Grok 4 fast model. Requires an OpenRouter API key."
  }
];

export const PROVIDER_LABELS: Record<AiBuilderProvider, string> = {
  codex: 'Codex CLI',
  openai: 'OpenAI GPT-5',
  openrouter: 'Grok 4 (OpenRouter)'
};
