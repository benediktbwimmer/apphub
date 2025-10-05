/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export const $NodeChildrenEnvelope = {
  properties: {
    data: {
      properties: {
        parent: {
          properties: {
            id: {
              type: 'number',
              description: `Unique identifier for the node.`,
              isRequired: true,
            },
            backendMountId: {
              type: 'number',
              description: `Identifier of the backend mount containing the node.`,
              isRequired: true,
            },
            parentId: {
              type: 'number',
              description: `Identifier of the parent directory, if any.`,
              isRequired: true,
              isNullable: true,
            },
            path: {
              type: 'string',
              description: `Normalized absolute path for the node.`,
              isRequired: true,
            },
            name: {
              type: 'string',
              description: `Basename of the node.`,
              isRequired: true,
            },
            depth: {
              type: 'number',
              description: `Directory depth starting from the backend root.`,
              isRequired: true,
            },
            kind: {
              type: 'Enum',
              isRequired: true,
            },
            sizeBytes: {
              type: 'number',
              description: `Logical size recorded for the node, in bytes.`,
              isRequired: true,
            },
            checksum: {
              type: 'string',
              description: `Checksum recorded for the node content.`,
              isRequired: true,
              isNullable: true,
            },
            contentHash: {
              type: 'string',
              description: `Content hash recorded for the node content.`,
              isRequired: true,
              isNullable: true,
            },
            metadata: {
              type: 'dictionary',
              contains: {
                type: 'def_0',
              },
              isRequired: true,
            },
            state: {
              type: 'Enum',
              isRequired: true,
            },
            version: {
              type: 'number',
              description: `Monotonic version counter for optimistic concurrency.`,
              isRequired: true,
            },
            isSymlink: {
              type: 'boolean',
              description: `Indicates if the node represents a symbolic link.`,
              isRequired: true,
            },
            lastSeenAt: {
              type: 'string',
              description: `Timestamp when the node was last observed in the backend.`,
              isRequired: true,
              format: 'date-time',
            },
            lastModifiedAt: {
              type: 'string',
              description: `Last modification timestamp reported by the backend.`,
              isRequired: true,
              isNullable: true,
              format: 'date-time',
            },
            consistencyState: {
              type: 'Enum',
              isRequired: true,
            },
            consistencyCheckedAt: {
              type: 'string',
              description: `Timestamp of the most recent consistency check.`,
              isRequired: true,
              format: 'date-time',
            },
            lastReconciledAt: {
              type: 'string',
              description: `Timestamp of the most recent reconciliation success.`,
              isRequired: true,
              isNullable: true,
              format: 'date-time',
            },
            lastDriftDetectedAt: {
              type: 'string',
              description: `Timestamp when drift was last detected.`,
              isRequired: true,
              isNullable: true,
              format: 'date-time',
            },
            createdAt: {
              type: 'string',
              description: `Timestamp when the node record was created.`,
              isRequired: true,
              format: 'date-time',
            },
            updatedAt: {
              type: 'string',
              description: `Timestamp when the node record was last updated.`,
              isRequired: true,
              format: 'date-time',
            },
            deletedAt: {
              type: 'string',
              description: `Timestamp when the node was marked deleted.`,
              isRequired: true,
              isNullable: true,
              format: 'date-time',
            },
            rollup: {
              properties: {
                nodeId: {
                  type: 'number',
                  description: `Identifier of the node associated with this rollup.`,
                  isRequired: true,
                },
                sizeBytes: {
                  type: 'number',
                  description: `Total bytes attributed to the subtree.`,
                  isRequired: true,
                },
                fileCount: {
                  type: 'number',
                  description: `Number of files in the subtree.`,
                  isRequired: true,
                },
                directoryCount: {
                  type: 'number',
                  description: `Number of directories in the subtree.`,
                  isRequired: true,
                },
                childCount: {
                  type: 'number',
                  description: `Total direct children tracked in the rollup.`,
                  isRequired: true,
                },
                state: {
                  type: 'Enum',
                  isRequired: true,
                },
                lastCalculatedAt: {
                  type: 'string',
                  description: `Timestamp of the most recent rollup calculation.`,
                  isRequired: true,
                  isNullable: true,
                  format: 'date-time',
                },
              },
              isRequired: true,
              isNullable: true,
            },
            download: {
              properties: {
                mode: {
                  type: 'Enum',
                  isRequired: true,
                },
                streamUrl: {
                  type: 'string',
                  description: `URL to stream the file through the filestore service.`,
                  isRequired: true,
                },
                presignUrl: {
                  type: 'string',
                  description: `Link to request a presigned download if supported.`,
                  isRequired: true,
                  isNullable: true,
                },
                supportsRange: {
                  type: 'boolean',
                  description: `Indicates whether byte-range requests are supported.`,
                  isRequired: true,
                },
                sizeBytes: {
                  type: 'number',
                  description: `Known size of the file when available.`,
                  isRequired: true,
                  isNullable: true,
                },
                checksum: {
                  type: 'string',
                  description: `Checksum recorded for the file content.`,
                  isRequired: true,
                  isNullable: true,
                },
                contentHash: {
                  type: 'string',
                  description: `Content hash recorded for the file content.`,
                  isRequired: true,
                  isNullable: true,
                },
                filename: {
                  type: 'string',
                  description: `Suggested filename for downloads.`,
                  isRequired: true,
                  isNullable: true,
                },
              },
              isRequired: true,
              isNullable: true,
            },
          },
          isRequired: true,
        },
        children: {
          type: 'array',
          contains: {
            properties: {
              id: {
                type: 'number',
                description: `Unique identifier for the node.`,
                isRequired: true,
              },
              backendMountId: {
                type: 'number',
                description: `Identifier of the backend mount containing the node.`,
                isRequired: true,
              },
              parentId: {
                type: 'number',
                description: `Identifier of the parent directory, if any.`,
                isRequired: true,
                isNullable: true,
              },
              path: {
                type: 'string',
                description: `Normalized absolute path for the node.`,
                isRequired: true,
              },
              name: {
                type: 'string',
                description: `Basename of the node.`,
                isRequired: true,
              },
              depth: {
                type: 'number',
                description: `Directory depth starting from the backend root.`,
                isRequired: true,
              },
              kind: {
                type: 'Enum',
                isRequired: true,
              },
              sizeBytes: {
                type: 'number',
                description: `Logical size recorded for the node, in bytes.`,
                isRequired: true,
              },
              checksum: {
                type: 'string',
                description: `Checksum recorded for the node content.`,
                isRequired: true,
                isNullable: true,
              },
              contentHash: {
                type: 'string',
                description: `Content hash recorded for the node content.`,
                isRequired: true,
                isNullable: true,
              },
              metadata: {
                type: 'dictionary',
                contains: {
                  type: 'def_0',
                },
                isRequired: true,
              },
              state: {
                type: 'Enum',
                isRequired: true,
              },
              version: {
                type: 'number',
                description: `Monotonic version counter for optimistic concurrency.`,
                isRequired: true,
              },
              isSymlink: {
                type: 'boolean',
                description: `Indicates if the node represents a symbolic link.`,
                isRequired: true,
              },
              lastSeenAt: {
                type: 'string',
                description: `Timestamp when the node was last observed in the backend.`,
                isRequired: true,
                format: 'date-time',
              },
              lastModifiedAt: {
                type: 'string',
                description: `Last modification timestamp reported by the backend.`,
                isRequired: true,
                isNullable: true,
                format: 'date-time',
              },
              consistencyState: {
                type: 'Enum',
                isRequired: true,
              },
              consistencyCheckedAt: {
                type: 'string',
                description: `Timestamp of the most recent consistency check.`,
                isRequired: true,
                format: 'date-time',
              },
              lastReconciledAt: {
                type: 'string',
                description: `Timestamp of the most recent reconciliation success.`,
                isRequired: true,
                isNullable: true,
                format: 'date-time',
              },
              lastDriftDetectedAt: {
                type: 'string',
                description: `Timestamp when drift was last detected.`,
                isRequired: true,
                isNullable: true,
                format: 'date-time',
              },
              createdAt: {
                type: 'string',
                description: `Timestamp when the node record was created.`,
                isRequired: true,
                format: 'date-time',
              },
              updatedAt: {
                type: 'string',
                description: `Timestamp when the node record was last updated.`,
                isRequired: true,
                format: 'date-time',
              },
              deletedAt: {
                type: 'string',
                description: `Timestamp when the node was marked deleted.`,
                isRequired: true,
                isNullable: true,
                format: 'date-time',
              },
              rollup: {
                properties: {
                  nodeId: {
                    type: 'number',
                    description: `Identifier of the node associated with this rollup.`,
                    isRequired: true,
                  },
                  sizeBytes: {
                    type: 'number',
                    description: `Total bytes attributed to the subtree.`,
                    isRequired: true,
                  },
                  fileCount: {
                    type: 'number',
                    description: `Number of files in the subtree.`,
                    isRequired: true,
                  },
                  directoryCount: {
                    type: 'number',
                    description: `Number of directories in the subtree.`,
                    isRequired: true,
                  },
                  childCount: {
                    type: 'number',
                    description: `Total direct children tracked in the rollup.`,
                    isRequired: true,
                  },
                  state: {
                    type: 'Enum',
                    isRequired: true,
                  },
                  lastCalculatedAt: {
                    type: 'string',
                    description: `Timestamp of the most recent rollup calculation.`,
                    isRequired: true,
                    isNullable: true,
                    format: 'date-time',
                  },
                },
                isRequired: true,
                isNullable: true,
              },
              download: {
                properties: {
                  mode: {
                    type: 'Enum',
                    isRequired: true,
                  },
                  streamUrl: {
                    type: 'string',
                    description: `URL to stream the file through the filestore service.`,
                    isRequired: true,
                  },
                  presignUrl: {
                    type: 'string',
                    description: `Link to request a presigned download if supported.`,
                    isRequired: true,
                    isNullable: true,
                  },
                  supportsRange: {
                    type: 'boolean',
                    description: `Indicates whether byte-range requests are supported.`,
                    isRequired: true,
                  },
                  sizeBytes: {
                    type: 'number',
                    description: `Known size of the file when available.`,
                    isRequired: true,
                    isNullable: true,
                  },
                  checksum: {
                    type: 'string',
                    description: `Checksum recorded for the file content.`,
                    isRequired: true,
                    isNullable: true,
                  },
                  contentHash: {
                    type: 'string',
                    description: `Content hash recorded for the file content.`,
                    isRequired: true,
                    isNullable: true,
                  },
                  filename: {
                    type: 'string',
                    description: `Suggested filename for downloads.`,
                    isRequired: true,
                    isNullable: true,
                  },
                },
                isRequired: true,
                isNullable: true,
              },
            },
          },
          isRequired: true,
        },
        pagination: {
          properties: {
            total: {
              type: 'number',
              description: `Total matching records.`,
              isRequired: true,
            },
            limit: {
              type: 'number',
              description: `Requested page size.`,
              isRequired: true,
            },
            offset: {
              type: 'number',
              description: `Current offset within the collection.`,
              isRequired: true,
            },
            nextOffset: {
              type: 'number',
              description: `Next offset to request, if more data is available.`,
              isRequired: true,
              isNullable: true,
            },
          },
          isRequired: true,
        },
        filters: {
          properties: {
            states: {
              type: 'array',
              contains: {
                type: 'Enum',
              },
              isRequired: true,
            },
            kinds: {
              type: 'array',
              contains: {
                type: 'Enum',
              },
              isRequired: true,
            },
            search: {
              type: 'string',
              isRequired: true,
              isNullable: true,
            },
            driftOnly: {
              type: 'boolean',
              isRequired: true,
            },
            advanced: {
              properties: {
                query: {
                  type: 'string',
                  description: `Full-text search term applied to node names and metadata.`,
                },
                metadata: {
                  type: 'array',
                  contains: {
                    properties: {
                      key: {
                        type: 'string',
                        description: `Metadata key to match.`,
                        isRequired: true,
                      },
                      value: {
                        type: 'def_0',
                        isRequired: true,
                      },
                    },
                  },
                },
                size: {
                  description: `Range constraint applied to numeric values.`,
                  properties: {
                    min: {
                      type: 'number',
                      description: `Lower bound, inclusive.`,
                    },
                    max: {
                      type: 'number',
                      description: `Upper bound, inclusive.`,
                    },
                  },
                },
                lastSeenAt: {
                  description: `Range constraint applied to ISO-8601 timestamps.`,
                  properties: {
                    after: {
                      type: 'string',
                      description: `Lower inclusive bound.`,
                      format: 'date-time',
                    },
                    before: {
                      type: 'string',
                      description: `Upper inclusive bound.`,
                      format: 'date-time',
                    },
                  },
                },
                rollup: {
                  description: `Advanced rollup constraints applied when filtering nodes.`,
                  properties: {
                    states: {
                      type: 'array',
                      contains: {
                        type: 'Enum',
                      },
                    },
                    minChildCount: {
                      type: 'number',
                    },
                    maxChildCount: {
                      type: 'number',
                    },
                    minFileCount: {
                      type: 'number',
                    },
                    maxFileCount: {
                      type: 'number',
                    },
                    minDirectoryCount: {
                      type: 'number',
                    },
                    maxDirectoryCount: {
                      type: 'number',
                    },
                    minSizeBytes: {
                      type: 'number',
                    },
                    maxSizeBytes: {
                      type: 'number',
                    },
                    lastCalculatedAfter: {
                      type: 'string',
                      format: 'date-time',
                    },
                    lastCalculatedBefore: {
                      type: 'string',
                      format: 'date-time',
                    },
                  },
                },
              },
              isRequired: true,
              isNullable: true,
            },
          },
          isRequired: true,
        },
      },
      isRequired: true,
    },
  },
} as const;
