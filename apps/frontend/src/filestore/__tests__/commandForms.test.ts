import { describe, expect, it, vi } from 'vitest';
import {
  buildIdempotencyKey,
  createDeleteFormState,
  createDirectoryFormState,
  createMoveCopyFormState,
  createUploadFormState,
  deleteFormReducer,
  directoryFormReducer,
  moveCopyFormReducer,
  normalizeRelativePath,
  parseMetadataDraft,
  uploadFormReducer,
  validateRelativePath
} from '../commandForms';

describe('filestore command form helpers', () => {
  it('normalizes relative paths by trimming slashes', () => {
    expect(normalizeRelativePath('/datasets/archive/')).toBe('datasets/archive');
    expect(normalizeRelativePath('  foo/bar  ')).toBe('foo/bar');
    expect(normalizeRelativePath('')).toBe('');
  });

  it('validates relative paths', () => {
    expect(validateRelativePath('docs/reports')).toBeNull();
    expect(validateRelativePath('/absolute/path')).toMatch(/relative/);
    expect(validateRelativePath('reports//2024')).toMatch(/empty segments/);
    expect(validateRelativePath('reports/../secret')).toMatch(/\.\./);
  });

  it('parses metadata JSON drafts', () => {
    expect(parseMetadataDraft('{"owner":"ops"}')).toEqual({ success: true, value: { owner: 'ops' } });
    expect(parseMetadataDraft('')).toEqual({ success: true, value: undefined });
    const invalid = parseMetadataDraft('[]');
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error).toMatch(/JSON object/);
    }
  });

  it('generates idempotency keys with prefixes', () => {
    const cryptoObj = globalThis.crypto as Crypto | undefined;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      const mockUuid = '12345678-1234-1234-1234-123456789abc';
      const randomUUID = vi.spyOn(cryptoObj, 'randomUUID').mockReturnValue(mockUuid);
      const key = buildIdempotencyKey('filestore-test');
      expect(key).toBe(`filestore-test-${mockUuid}`);
      randomUUID.mockRestore();
    } else {
      const key = buildIdempotencyKey('filestore-test');
      expect(key.startsWith('filestore-test-')).toBe(true);
    }
  });

  it('reduces directory form state transitions', () => {
    let state = createDirectoryFormState({ path: 'datasets' });
    state = directoryFormReducer(state, { type: 'setPath', path: 'datasets/archive' });
    expect(state.path).toBe('datasets/archive');
    state = directoryFormReducer(state, { type: 'setError', error: 'Invalid' });
    expect(state.error).toBe('Invalid');
    state = directoryFormReducer(state, { type: 'reset', state: createDirectoryFormState({ path: 'logs' }) });
    expect(state.path).toBe('logs');
    expect(state.error).toBeNull();
  });

  it('reduces upload form state transitions', () => {
    let state = createUploadFormState({ path: 'datasets/report.csv' });
    state = uploadFormReducer(state, { type: 'setChecksum', checksum: 'sha256:abc' });
    expect(state.checksum).toBe('sha256:abc');
    const file = new File(['data'], 'sample.txt', { type: 'text/plain' });
    state = uploadFormReducer(state, { type: 'setFile', file });
    expect(state.file).toBe(file);
    state = uploadFormReducer(state, { type: 'setOverwrite', overwrite: true });
    expect(state.overwrite).toBe(true);
    state = uploadFormReducer(state, { type: 'reset', state: createUploadFormState({ path: 'docs' }) });
    expect(state.path).toBe('docs');
    expect(state.file).toBeNull();
  });

  it('reduces move/copy form state transitions', () => {
    let state = createMoveCopyFormState({ sourcePath: 'datasets/report.csv' });
    expect(state.targetPath).toBe('datasets/report.csv');
    state = moveCopyFormReducer(state, { type: 'setTargetPath', path: 'archive/report.csv' });
    expect(state.targetPath).toBe('archive/report.csv');
    state = moveCopyFormReducer(state, { type: 'setOverwrite', overwrite: true });
    expect(state.overwrite).toBe(true);
  });

  it('reduces delete form state transitions', () => {
    let state = createDeleteFormState({ path: 'datasets/report.csv' });
    state = deleteFormReducer(state, { type: 'setRecursive', recursive: true });
    expect(state.recursive).toBe(true);
    state = deleteFormReducer(state, { type: 'setConfirmation', confirmation: 'report.csv' });
    expect(state.confirmation).toBe('report.csv');
  });
});
