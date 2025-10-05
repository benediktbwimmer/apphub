/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_55 = {
  properties: {
    prompt: {
      type: 'string',
      description: `Instruction describing the desired edits to apply to the job bundle.`,
      isRequired: true,
      maxLength: 10000,
    },
    provider: {
      type: 'Enum',
    },
    providerOptions: {
      type: 'all-of',
      description: `Provider-specific configuration such as API keys or maximum output tokens.`,
      contains: [{
        properties: {
          openAiApiKey: {
            type: 'string',
            description: `API key to authorize calls to OpenAI models.`,
          },
          openAiBaseUrl: {
            type: 'string',
            description: `Override for the OpenAI API base URL when routing requests through a proxy.`,
            format: 'uri',
          },
          openAiMaxOutputTokens: {
            type: 'number',
            description: `Maximum number of tokens the OpenAI provider may generate in a single response.`,
            maximum: 32000,
            minimum: 256,
          },
          openRouterApiKey: {
            type: 'string',
            description: `API key used when the OpenRouter provider is selected.`,
          },
          openRouterReferer: {
            type: 'string',
            description: `Referer value to include when calling OpenRouter.`,
            format: 'uri',
          },
          openRouterTitle: {
            type: 'string',
            description: `Human readable title supplied to OpenRouter when making a request.`,
          },
        },
      }],
    },
  },
} as const;
