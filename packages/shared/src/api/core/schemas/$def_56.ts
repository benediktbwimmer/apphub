/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $def_56 = {
  properties: {
    data: {
      properties: {
        job: {
          type: 'def_41',
          isRequired: true,
        },
        binding: {
          properties: {
            slug: {
              type: 'string',
              description: `Slug of the bundle bound to the job.`,
              isRequired: true,
            },
            version: {
              type: 'string',
              description: `Version of the bundle referenced by the job entry point.`,
              isRequired: true,
            },
            exportName: {
              type: 'string',
              description: `Optional export name used when requiring the bundle entry point.`,
              isNullable: true,
            },
          },
          isRequired: true,
        },
        bundle: {
          properties: {
            id: {
              type: 'string',
              isRequired: true,
            },
            bundleId: {
              type: 'string',
              isRequired: true,
            },
            slug: {
              type: 'string',
              isRequired: true,
            },
            version: {
              type: 'string',
              isRequired: true,
            },
            checksum: {
              type: 'string',
              description: `SHA-256 checksum of the stored artifact.`,
              isRequired: true,
            },
            capabilityFlags: {
              type: 'array',
              contains: {
                type: 'string',
              },
              isRequired: true,
            },
            immutable: {
              type: 'boolean',
              description: `Indicates whether further edits to this version are allowed.`,
              isRequired: true,
            },
            status: {
              type: 'string',
              description: `Lifecycle status of the bundle version.`,
              isRequired: true,
            },
            artifact: {
              properties: {
                storage: {
                  type: 'string',
                  description: `Where the bundle artifact is stored.`,
                  isRequired: true,
                },
                contentType: {
                  type: 'string',
                  description: `MIME type reported for the bundle artifact.`,
                  isRequired: true,
                },
                size: {
                  type: 'number',
                  description: `Size of the bundle artifact in bytes.`,
                  isRequired: true,
                },
              },
              isRequired: true,
            },
            manifest: {
              type: 'any-of',
              contains: [{
                type: 'any-of',
                description: `Arbitrary JSON value.`,
                contains: [{
                  type: 'string',
                }, {
                  type: 'number',
                }, {
                  type: 'number',
                }, {
                  type: 'boolean',
                }, {
                  type: 'dictionary',
                  contains: {
                    properties: {
                    },
                  },
                }],
              }, {
                type: 'null',
              }],
            },
            metadata: {
              type: 'any-of',
              contains: [{
                type: 'any-of',
                description: `Arbitrary JSON value.`,
                contains: [{
                  type: 'string',
                }, {
                  type: 'number',
                }, {
                  type: 'number',
                }, {
                  type: 'boolean',
                }, {
                  type: 'dictionary',
                  contains: {
                    properties: {
                    },
                  },
                }],
              }, {
                type: 'null',
              }],
              isRequired: true,
            },
            publishedBy: {
              type: 'any',
              isNullable: true,
            },
            publishedAt: {
              type: 'string',
              isNullable: true,
              format: 'date-time',
            },
            deprecatedAt: {
              type: 'string',
              isNullable: true,
              format: 'date-time',
            },
            replacedAt: {
              type: 'string',
              isNullable: true,
              format: 'date-time',
            },
            replacedBy: {
              type: 'string',
              isNullable: true,
            },
            createdAt: {
              type: 'string',
              isRequired: true,
              format: 'date-time',
            },
            updatedAt: {
              type: 'string',
              isRequired: true,
              format: 'date-time',
            },
            download: {
              properties: {
                url: {
                  type: 'string',
                  isRequired: true,
                  format: 'uri',
                },
                expiresAt: {
                  type: 'string',
                  isRequired: true,
                  format: 'date-time',
                },
                storage: {
                  type: 'string',
                  isRequired: true,
                },
                kind: {
                  type: 'string',
                  isRequired: true,
                },
              },
            },
          },
          isRequired: true,
        },
        editor: {
          properties: {
            entryPoint: {
              type: 'string',
              description: `Relative path of the bundle entry point file.`,
              isRequired: true,
            },
            manifestPath: {
              type: 'string',
              description: `Path to the manifest file within the bundle.`,
              isRequired: true,
            },
            manifest: {
              type: 'any-of',
              contains: [{
                type: 'any-of',
                description: `Arbitrary JSON value.`,
                contains: [{
                  type: 'string',
                }, {
                  type: 'number',
                }, {
                  type: 'number',
                }, {
                  type: 'boolean',
                }, {
                  type: 'dictionary',
                  contains: {
                    properties: {
                    },
                  },
                }],
              }, {
                type: 'null',
              }],
              isRequired: true,
            },
            files: {
              type: 'array',
              contains: {
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
              },
              isRequired: true,
            },
          },
          isRequired: true,
        },
        aiBuilder: {
          type: 'any-of',
          contains: [{
            type: 'any-of',
            description: `Arbitrary JSON value.`,
            contains: [{
              type: 'string',
            }, {
              type: 'number',
            }, {
              type: 'number',
            }, {
              type: 'boolean',
            }, {
              type: 'dictionary',
              contains: {
                properties: {
                },
              },
            }],
          }, {
            type: 'null',
          }],
          isRequired: true,
        },
        history: {
          type: 'array',
          contains: {
            properties: {
              slug: {
                type: 'string',
                isRequired: true,
              },
              version: {
                type: 'string',
                isRequired: true,
              },
              checksum: {
                type: 'string',
                description: `Checksum of the generated artifact.`,
              },
              regeneratedAt: {
                type: 'string',
                format: 'date-time',
              },
            },
          },
          isRequired: true,
        },
        suggestionSource: {
          type: 'Enum',
          isRequired: true,
        },
        availableVersions: {
          type: 'array',
          contains: {
            properties: {
              id: {
                type: 'string',
                isRequired: true,
              },
              bundleId: {
                type: 'string',
                isRequired: true,
              },
              slug: {
                type: 'string',
                isRequired: true,
              },
              version: {
                type: 'string',
                isRequired: true,
              },
              checksum: {
                type: 'string',
                description: `SHA-256 checksum of the stored artifact.`,
                isRequired: true,
              },
              capabilityFlags: {
                type: 'array',
                contains: {
                  type: 'string',
                },
                isRequired: true,
              },
              immutable: {
                type: 'boolean',
                description: `Indicates whether further edits to this version are allowed.`,
                isRequired: true,
              },
              status: {
                type: 'string',
                description: `Lifecycle status of the bundle version.`,
                isRequired: true,
              },
              artifact: {
                properties: {
                  storage: {
                    type: 'string',
                    description: `Where the bundle artifact is stored.`,
                    isRequired: true,
                  },
                  contentType: {
                    type: 'string',
                    description: `MIME type reported for the bundle artifact.`,
                    isRequired: true,
                  },
                  size: {
                    type: 'number',
                    description: `Size of the bundle artifact in bytes.`,
                    isRequired: true,
                  },
                },
                isRequired: true,
              },
              manifest: {
                type: 'any-of',
                contains: [{
                  type: 'any-of',
                  description: `Arbitrary JSON value.`,
                  contains: [{
                    type: 'string',
                  }, {
                    type: 'number',
                  }, {
                    type: 'number',
                  }, {
                    type: 'boolean',
                  }, {
                    type: 'dictionary',
                    contains: {
                      properties: {
                      },
                    },
                  }],
                }, {
                  type: 'null',
                }],
              },
              metadata: {
                type: 'any-of',
                contains: [{
                  type: 'any-of',
                  description: `Arbitrary JSON value.`,
                  contains: [{
                    type: 'string',
                  }, {
                    type: 'number',
                  }, {
                    type: 'number',
                  }, {
                    type: 'boolean',
                  }, {
                    type: 'dictionary',
                    contains: {
                      properties: {
                      },
                    },
                  }],
                }, {
                  type: 'null',
                }],
                isRequired: true,
              },
              publishedBy: {
                type: 'any',
                isNullable: true,
              },
              publishedAt: {
                type: 'string',
                isNullable: true,
                format: 'date-time',
              },
              deprecatedAt: {
                type: 'string',
                isNullable: true,
                format: 'date-time',
              },
              replacedAt: {
                type: 'string',
                isNullable: true,
                format: 'date-time',
              },
              replacedBy: {
                type: 'string',
                isNullable: true,
              },
              createdAt: {
                type: 'string',
                isRequired: true,
                format: 'date-time',
              },
              updatedAt: {
                type: 'string',
                isRequired: true,
                format: 'date-time',
              },
              download: {
                properties: {
                  url: {
                    type: 'string',
                    isRequired: true,
                    format: 'uri',
                  },
                  expiresAt: {
                    type: 'string',
                    isRequired: true,
                    format: 'date-time',
                  },
                  storage: {
                    type: 'string',
                    isRequired: true,
                  },
                  kind: {
                    type: 'string',
                    isRequired: true,
                  },
                },
              },
            },
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
