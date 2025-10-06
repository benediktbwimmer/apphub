import { describe, expect, test } from 'vitest';
import { jsonPath, collectPaths } from '../src/index';

describe('jsonPath helpers', () => {
  interface FilestoreUploadEvent {
    payload: {
      node: {
        metadata: {
          minute?: string;
          instrumentId?: string;
        };
      };
    };
  }

  test('jsonPath returns typed selectors', () => {
    const paths = jsonPath<FilestoreUploadEvent>();
    expect(paths.payload.node.metadata.minute.$path).toBe('payload.node.metadata.minute');
    expect(paths.payload.node.metadata.instrumentId.$path).toBe('payload.node.metadata.instrumentId');
  });

  test('collectPaths builds typed maps', () => {
    const map = collectPaths<FilestoreUploadEvent, Record<string, string>>((select) => ({
      minute: select.payload.node.metadata.minute.$path,
      instrument: select.payload.node.metadata.instrumentId.$path
    }));

    expect(map.minute).toBe('payload.node.metadata.minute');
    expect(map.instrument).toBe('payload.node.metadata.instrumentId');
  });
});
