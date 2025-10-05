/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $JobBundleFile = {
  properties: {
    path: {
      type: 'string',
      description: `Relative path of the file inside the bundle.`,
      isRequired: true,
    },
    contents: {
      type: 'string',
      description: `File contents encoded as UTF-8 text or base64.`,
      isRequired: true,
    },
    encoding: {
      type: 'Enum',
    },
    executable: {
      type: 'boolean',
      description: `Whether the file should be marked as executable in the generated bundle.`,
    },
  },
} as const;
