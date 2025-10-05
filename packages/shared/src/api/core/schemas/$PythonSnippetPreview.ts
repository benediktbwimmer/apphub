/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $PythonSnippetPreview = {
  properties: {
    handlerName: {
      type: 'string',
      isRequired: true,
    },
    handlerIsAsync: {
      type: 'boolean',
      isRequired: true,
    },
    inputModel: {
      properties: {
        name: {
          type: 'string',
          isRequired: true,
        },
        schema: {
          type: 'def_0',
          isRequired: true,
        },
      },
      isRequired: true,
    },
    outputModel: {
      properties: {
        name: {
          type: 'string',
          isRequired: true,
        },
        schema: {
          type: 'def_0',
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
