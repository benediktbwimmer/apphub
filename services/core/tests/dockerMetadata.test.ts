import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { safeParseDockerJobMetadata } from '../src/jobs/dockerMetadata';
import { clearDockerRuntimeConfigCache } from '../src/config/dockerRuntime';

function resetDockerConfigEnv(): void {
  delete process.env.CORE_DOCKER_IMAGE_ALLOWLIST;
  delete process.env.CORE_DOCKER_IMAGE_DENYLIST;
  delete process.env.CORE_DOCKER_ENFORCE_NETWORK_ISOLATION;
  delete process.env.CORE_DOCKER_ALLOWED_NETWORK_MODES;
  delete process.env.CORE_DOCKER_DEFAULT_NETWORK_MODE;
  delete process.env.CORE_DOCKER_ALLOW_NETWORK_OVERRIDE;
  delete process.env.CORE_DOCKER_ENABLE_GPU;
  clearDockerRuntimeConfigCache();
}

beforeEach(() => {
  resetDockerConfigEnv();
});

afterEach(() => {
  resetDockerConfigEnv();
});

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

  test('rejects environment secrets with inline values', () => {
    const result = safeParseDockerJobMetadata({
      docker: {
        image: 'example/app:1.0.0',
        environment: [
          {
            name: 'TOKEN',
            value: 'inline',
            secret: { source: 'env', key: 'TOKEN' }
          }
        ]
      }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.format())).toContain('Secret environment variables must not include inline values');
    }
  });

  test('enforces image allowlist policy', () => {
    process.env.CORE_DOCKER_IMAGE_ALLOWLIST = 'registry.example.com/*';
    clearDockerRuntimeConfigCache();
    const result = safeParseDockerJobMetadata({
      docker: {
        image: 'other.registry/app:latest'
      }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.format())).toContain('does not match any allow pattern');
    }
  });

  test('rejects bridge network mode when isolation enforced', () => {
    const result = safeParseDockerJobMetadata({
      docker: {
        image: 'example/app:1.0.0',
        networkMode: 'bridge'
      }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.format())).toContain('Network isolation is enforced');
    }
  });

  test('allows bridge network mode when overrides enabled', () => {
    process.env.CORE_DOCKER_ENFORCE_NETWORK_ISOLATION = 'false';
    process.env.CORE_DOCKER_ALLOW_NETWORK_OVERRIDE = 'true';
    clearDockerRuntimeConfigCache();
    const result = safeParseDockerJobMetadata({
      docker: {
        image: 'example/app:1.0.0',
        networkMode: 'bridge'
      }
    });
    expect(result.success).toBe(true);
  });

  test('rejects gpu requirement when disabled', () => {
    const result = safeParseDockerJobMetadata({
      docker: {
        image: 'example/app:1.0.0',
        requiresGpu: true
      }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.format())).toContain('GPU execution is not enabled');
    }
  });

  test('allows gpu requirement when enabled', () => {
    process.env.CORE_DOCKER_ENABLE_GPU = 'true';
    clearDockerRuntimeConfigCache();
    const result = safeParseDockerJobMetadata({
      docker: {
        image: 'example/app:1.0.0',
        requiresGpu: true
      }
    });
    expect(result.success).toBe(true);
  });
});
