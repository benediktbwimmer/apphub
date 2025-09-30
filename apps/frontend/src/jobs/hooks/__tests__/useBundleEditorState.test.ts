import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BundleEditorData } from '../../api';
import { useBundleEditorState } from '../useBundleEditorState';

function buildBundle(): BundleEditorData {
  return {
    job: {
      id: 'job-1',
      slug: 'job-1',
      name: 'Job 1',
      version: 1,
      type: 'task',
      runtime: 'node',
      entryPoint: 'index.ts',
      registryRef: null,
      parametersSchema: null,
      defaultParameters: null,
      outputSchema: null,
      timeoutMs: null,
      retryPolicy: null,
      metadata: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    },
    binding: { slug: 'bundle-1', version: '1.0.0', exportName: null },
    bundle: {
      version: '1.0.0',
      checksum: 'abc',
      capabilityFlags: [],
      status: 'active',
      immutable: false,
      publishedAt: '2024-01-01T00:00:00Z',
      deprecatedAt: null,
      artifact: { storage: 's3', size: null, contentType: null },
      metadata: null
    },
    editor: {
      entryPoint: 'index.ts',
      manifestPath: 'manifest.json',
      manifest: {},
      files: [
        {
          path: 'index.ts',
          contents: 'export const handler = () => {}',
          encoding: 'utf8',
          executable: false
        }
      ]
    },
    aiBuilder: null,
    history: [],
    suggestionSource: 'metadata',
    availableVersions: []
  };
}

describe('useBundleEditorState', () => {
  it('loads a snapshot and tracks dirty state', () => {
    const bundle = buildBundle();
    const { result } = renderHook(() => useBundleEditorState());

    act(() => {
      result.current.loadSnapshot(bundle);
    });

    expect(result.current.state.baseline).not.toBeNull();
    expect(result.current.state.files).toHaveLength(1);
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.updateFile('index.ts', 'modified content');
    });

    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.resetToBaseline();
    });

    expect(result.current.isDirty).toBe(false);
  });

  it('applies AI updates and reports whether changes occurred', () => {
    const bundle = buildBundle();
    const { result } = renderHook(() => useBundleEditorState());

    act(() => {
      result.current.loadSnapshot(bundle);
    });

    let changed = false;
    act(() => {
      changed = result.current.applyAiUpdate(buildBundle());
    });
    expect(changed).toBe(false);
    expect(result.current.state.showDiff).toBe(false);

    const updatedBundle: BundleEditorData = {
      ...bundle,
      editor: {
        ...bundle.editor,
        files: [
          {
            path: 'index.ts',
            contents: 'export const handler = () => "hi";',
            encoding: 'utf8',
            executable: false
          }
        ]
      }
    };

    act(() => {
      changed = result.current.applyAiUpdate(updatedBundle);
    });

    expect(changed).toBe(true);
    expect(result.current.state.showDiff).toBe(true);
    expect(result.current.state.aiReviewPending).toBe(true);
  });

  it('adds and removes files with generated names', () => {
    const bundle = buildBundle();
    const { result } = renderHook(() => useBundleEditorState());

    act(() => {
      result.current.loadSnapshot(bundle);
    });

    act(() => {
      result.current.addFile();
    });

    expect(result.current.state.files.some((file) => file.path === 'new-file.ts')).toBe(true);
    const addedPath = result.current.state.files.find((file) => file.path === 'new-file.ts')?.path;
    expect(result.current.state.activePath).toBe(addedPath ?? 'new-file.ts');

    act(() => {
      result.current.removeFile('new-file.ts');
    });

    expect(result.current.state.files.some((file) => file.path === 'new-file.ts')).toBe(false);
  });
});
