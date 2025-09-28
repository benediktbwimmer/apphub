import { describe, expect, test } from 'vitest';
import { safeParseDockerJobMetadata } from '../src/jobs/dockerMetadata';

describe('dockerJobMetadataSchema', () => {
  test('accepts minimal docker metadata', () => {
    const result = safeParseDockerJobMetadata({
      docker: {
        image: 'registry.example.com/example:latest'
      }
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.docker.image).toBe('registry.example.com/example:latest');
    }
  });

  test('rejects metadata that omits docker descriptor', () => {
    const result = safeParseDockerJobMetadata({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().formErrors.length).toBeGreaterThan(0);
    }
  });

  test('rejects inputs with unsafe workspace paths', () => {
    const result = safeParseDockerJobMetadata({
      docker: {
        image: 'example/app:1.0.0',
        inputs: [
          {
            id: 'config',
            source: {
              type: 'filestorePath',
              backendMountId: 1,
              path: '/data/config.json'
            },
            workspacePath: '../escape/config.json'
          }
        ]
      }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = result.error.format();
      expect(JSON.stringify(formatted)).toContain('workspacePath must be a relative path');
    }
  });

  test('rejects duplicate input identifiers', () => {
    const result = safeParseDockerJobMetadata({
      docker: {
        image: 'example/app:1.0.0',
        inputs: [
          {
            id: 'shared',
            source: {
              type: 'filestoreNode',
              nodeId: 123
            },
            workspacePath: 'inputs/first.json'
          },
          {
            id: 'shared',
            source: {
              type: 'filestoreNode',
              nodeId: 456
            },
            workspacePath: 'inputs/second.json'
          }
        ]
      }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = result.error.format();
      expect(JSON.stringify(formatted)).toContain('Duplicate input id');
    }
  });
});
