/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_27 = {
  properties: {
    data: {
      properties: {
        idempotent: {
          type: 'boolean',
          description: `Indicates whether an idempotency key short-circuited the command.`,
          isRequired: true,
        },
        journalEntryId: {
          type: 'number',
          description: `Identifier of the journal entry generated for this command.`,
          isRequired: true,
        },
        node: {
          type: 'any',
          isRequired: true,
          isNullable: true,
        },
        result: {
          type: 'dictionary',
          contains: {
            type: 'def_0',
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
