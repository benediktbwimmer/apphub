/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_55 = {
  /**
   * Instruction describing the desired edits to apply to the job bundle.
   */
  prompt: string;
  /**
   * Model provider responsible for generating the bundle edits.
   */
  provider?: 'codex' | 'openai' | 'openrouter';
  /**
   * Provider-specific configuration such as API keys or maximum output tokens.
   */
  providerOptions?: {
    /**
     * API key to authorize calls to OpenAI models.
     */
    openAiApiKey?: string;
    /**
     * Override for the OpenAI API base URL when routing requests through a proxy.
     */
    openAiBaseUrl?: string;
    /**
     * Maximum number of tokens the OpenAI provider may generate in a single response.
     */
    openAiMaxOutputTokens?: number;
    /**
     * API key used when the OpenRouter provider is selected.
     */
    openRouterApiKey?: string;
    /**
     * Referer value to include when calling OpenRouter.
     */
    openRouterReferer?: string;
    /**
     * Human readable title supplied to OpenRouter when making a request.
     */
    openRouterTitle?: string;
  };
};

