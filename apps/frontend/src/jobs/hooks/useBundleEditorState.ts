import { useCallback, useMemo, useReducer } from 'react';
import type { BundleEditorData } from '../api';
import {
  buildInitialFiles,
  cloneFileState,
  filesEqual,
  normalizeCapabilityFlagArray,
  normalizeCapabilityFlags,
  type EditorBaseline,
  type FileState
} from '../utils';

type BundleEditorState = {
  baseline: EditorBaseline | null;
  files: FileState[];
  activePath: string | null;
  entryPoint: string;
  manifestPath: string;
  manifestText: string;
  manifestError: string | null;
  capabilityFlagsInput: string;
  versionInput: string;
  regenerating: boolean;
  regenerateError: string | null;
  regenerateSuccess: string | null;
  showDiff: boolean;
  aiReviewPending: boolean;
};

type BundleEditorAction =
  | { type: 'LOAD_SNAPSHOT'; bundle: BundleEditorData | null }
  | { type: 'RESET_TO_BASELINE' }
  | { type: 'SELECT_FILE'; path: string | null }
  | { type: 'UPDATE_FILE'; path: string; contents: string }
  | { type: 'RENAME_FILE'; path: string; nextPath: string }
  | { type: 'TOGGLE_EXECUTABLE'; path: string }
  | { type: 'REMOVE_FILE'; path: string }
  | { type: 'ADD_FILE' }
  | { type: 'SET_ENTRY_POINT'; value: string }
  | { type: 'SET_MANIFEST_PATH'; value: string }
  | { type: 'SET_MANIFEST_TEXT'; value: string }
  | { type: 'SET_MANIFEST_ERROR'; value: string | null }
  | { type: 'SET_CAPABILITY_FLAGS_INPUT'; value: string }
  | { type: 'SET_VERSION_INPUT'; value: string }
  | { type: 'SET_REGENERATING'; value: boolean }
  | { type: 'SET_REGENERATE_ERROR'; value: string | null }
  | { type: 'SET_REGENERATE_SUCCESS'; value: string | null }
  | { type: 'SET_SHOW_DIFF'; value: boolean }
  | { type: 'SET_AI_REVIEW_PENDING'; value: boolean }
  | {
      type: 'APPLY_AI_UPDATE';
      payload: {
        files: FileState[];
        entryPoint: string;
        manifestPath: string;
        manifestText: string;
        capabilityFlagsInput: string;
        activePath: string | null;
        showDiff: boolean;
        aiReviewPending: boolean;
      };
    };

const initialState: BundleEditorState = {
  baseline: null,
  files: [],
  activePath: null,
  entryPoint: '',
  manifestPath: 'manifest.json',
  manifestText: '',
  manifestError: null,
  capabilityFlagsInput: '',
  versionInput: '',
  regenerating: false,
  regenerateError: null,
  regenerateSuccess: null,
  showDiff: false,
  aiReviewPending: false
};

function makeBaseline(bundle: BundleEditorData): {
  baseline: EditorBaseline;
  files: FileState[];
  activePath: string | null;
  capabilityFlagsInput: string;
  manifestText: string;
} {
  const initialFiles = buildInitialFiles(bundle.editor.files);
  const manifestJson = JSON.stringify(bundle.editor.manifest ?? {}, null, 2);
  const capabilityFlags = normalizeCapabilityFlagArray(bundle.bundle.capabilityFlags);
  return {
    baseline: {
      files: initialFiles.map(cloneFileState),
      manifestText: manifestJson,
      manifestPath: bundle.editor.manifestPath,
      entryPoint: bundle.editor.entryPoint,
      capabilityFlags
    },
    files: initialFiles.map(cloneFileState),
    activePath: initialFiles[0]?.path ?? null,
    capabilityFlagsInput: capabilityFlags.join(', '),
    manifestText: manifestJson
  };
}

function normalizeActivePath(
  desired: string | null,
  files: FileState[]
): string | null {
  if (!desired) {
    return files[0]?.path ?? null;
  }
  if (files.some((file) => file.path === desired)) {
    return desired;
  }
  return files[0]?.path ?? null;
}

function editorReducer(state: BundleEditorState, action: BundleEditorAction): BundleEditorState {
  switch (action.type) {
    case 'LOAD_SNAPSHOT': {
      if (!action.bundle) {
        return { ...initialState };
      }
      const {
        baseline,
        files,
        activePath,
        capabilityFlagsInput,
        manifestText
      } = makeBaseline(action.bundle);
      return {
        baseline,
        files,
        activePath,
        entryPoint: action.bundle.editor.entryPoint,
        manifestPath: action.bundle.editor.manifestPath,
        manifestText,
        manifestError: null,
        capabilityFlagsInput,
        versionInput: '',
        regenerating: false,
        regenerateError: null,
        regenerateSuccess: null,
        showDiff: false,
        aiReviewPending: false
      };
    }
    case 'RESET_TO_BASELINE': {
      if (!state.baseline) {
        return state;
      }
      const files = state.baseline.files.map(cloneFileState);
      const activePath = normalizeActivePath(state.activePath, files);
      return {
        ...state,
        files,
        activePath,
        entryPoint: state.baseline.entryPoint,
        manifestPath: state.baseline.manifestPath,
        manifestText: state.baseline.manifestText,
        manifestError: null,
        capabilityFlagsInput: state.baseline.capabilityFlags.join(', '),
        versionInput: '',
        regenerateError: null,
        regenerateSuccess: null,
        showDiff: false,
        aiReviewPending: false
      };
    }
    case 'SELECT_FILE': {
      return {
        ...state,
        activePath: action.path
      };
    }
    case 'UPDATE_FILE': {
      return {
        ...state,
        files: state.files.map((file) =>
          file.path === action.path ? { ...file, contents: action.contents } : file
        )
      };
    }
    case 'RENAME_FILE': {
      const files = state.files
        .map((file) => (file.path === action.path ? { ...file, path: action.nextPath } : file))
        .sort((a, b) => a.path.localeCompare(b.path));
      return {
        ...state,
        files,
        activePath: action.nextPath
      };
    }
    case 'TOGGLE_EXECUTABLE': {
      return {
        ...state,
        files: state.files.map((file) =>
          file.path === action.path ? { ...file, executable: !file.executable } : file
        )
      };
    }
    case 'REMOVE_FILE': {
      const files = state.files.filter((file) => file.path !== action.path);
      const activePath =
        state.activePath === action.path ? files[0]?.path ?? null : state.activePath;
      return {
        ...state,
        files,
        activePath
      };
    }
    case 'ADD_FILE': {
      const baseName = 'new-file.ts';
      let candidate = baseName;
      let counter = 1;
      const existing = new Set(state.files.map((file) => file.path));
      while (existing.has(candidate)) {
        candidate = `new-file-${counter}.ts`;
        counter += 1;
      }
      const nextFile: FileState = {
        path: candidate,
        contents: '// TODO: implement\n',
        encoding: 'utf8',
        executable: false,
        readOnly: false
      };
      const files = [...state.files, nextFile].sort((a, b) => a.path.localeCompare(b.path));
      return {
        ...state,
        files,
        activePath: candidate
      };
    }
    case 'SET_ENTRY_POINT': {
      return {
        ...state,
        entryPoint: action.value
      };
    }
    case 'SET_MANIFEST_PATH': {
      return {
        ...state,
        manifestPath: action.value
      };
    }
    case 'SET_MANIFEST_TEXT': {
      return {
        ...state,
        manifestText: action.value
      };
    }
    case 'SET_MANIFEST_ERROR': {
      return {
        ...state,
        manifestError: action.value
      };
    }
    case 'SET_CAPABILITY_FLAGS_INPUT': {
      return {
        ...state,
        capabilityFlagsInput: action.value
      };
    }
    case 'SET_VERSION_INPUT': {
      return {
        ...state,
        versionInput: action.value
      };
    }
    case 'SET_REGENERATING': {
      return {
        ...state,
        regenerating: action.value
      };
    }
    case 'SET_REGENERATE_ERROR': {
      return {
        ...state,
        regenerateError: action.value
      };
    }
    case 'SET_REGENERATE_SUCCESS': {
      return {
        ...state,
        regenerateSuccess: action.value
      };
    }
    case 'SET_SHOW_DIFF': {
      return {
        ...state,
        showDiff: action.value
      };
    }
    case 'SET_AI_REVIEW_PENDING': {
      return {
        ...state,
        aiReviewPending: action.value
      };
    }
    case 'APPLY_AI_UPDATE': {
      return {
        ...state,
        files: action.payload.files,
        activePath: action.payload.activePath,
        entryPoint: action.payload.entryPoint,
        manifestPath: action.payload.manifestPath,
        manifestText: action.payload.manifestText,
        manifestError: null,
        capabilityFlagsInput: action.payload.capabilityFlagsInput,
        versionInput: '',
        regenerateError: null,
        regenerateSuccess: null,
        showDiff: action.payload.showDiff,
        aiReviewPending: action.payload.aiReviewPending
      };
    }
    default:
      return state;
  }
}

type BundleEditorControls = {
  state: BundleEditorState;
  activeFile: FileState | null;
  baselineFiles: FileState[] | null;
  isDirty: boolean;
  loadSnapshot: (bundle: BundleEditorData | null) => void;
  resetToBaseline: () => void;
  selectFile: (path: string | null) => void;
  updateFile: (path: string, contents: string) => void;
  renameFile: (path: string, nextPath: string) => void;
  toggleExecutable: (path: string) => void;
  removeFile: (path: string) => void;
  addFile: () => void;
  setEntryPoint: (value: string) => void;
  setManifestPath: (value: string) => void;
  setManifestText: (value: string) => void;
  setManifestError: (value: string | null) => void;
  setCapabilityFlagsInput: (value: string) => void;
  setVersionInput: (value: string) => void;
  setRegenerating: (value: boolean) => void;
  setRegenerateError: (value: string | null) => void;
  setRegenerateSuccess: (value: string | null) => void;
  setShowDiff: (value: boolean) => void;
  setAiReviewPending: (value: boolean) => void;
  applyAiUpdate: (bundle: BundleEditorData) => boolean;
};

export function useBundleEditorState(): BundleEditorControls {
  const [state, dispatch] = useReducer(editorReducer, initialState);

  const loadSnapshot = useCallback(
    (bundle: BundleEditorData | null) => {
      dispatch({ type: 'LOAD_SNAPSHOT', bundle });
    },
    []
  );
  const resetToBaseline = useCallback(() => {
    dispatch({ type: 'RESET_TO_BASELINE' });
  }, []);
  const selectFile = useCallback((path: string | null) => {
    dispatch({ type: 'SELECT_FILE', path });
  }, []);
  const updateFile = useCallback((path: string, contents: string) => {
    dispatch({ type: 'UPDATE_FILE', path, contents });
  }, []);
  const renameFile = useCallback(
    (path: string, nextPath: string) => {
      const trimmed = nextPath.trim();
      if (!trimmed || trimmed.startsWith('/') || trimmed.includes('..')) {
        return;
      }
      const normalized = trimmed.split(/[\\/]+/).join('/');
      if (state.files.some((file) => file.path === normalized)) {
        return;
      }
      dispatch({ type: 'RENAME_FILE', path, nextPath: normalized });
    },
    [state.files]
  );
  const toggleExecutable = useCallback((path: string) => {
    dispatch({ type: 'TOGGLE_EXECUTABLE', path });
  }, []);
  const removeFile = useCallback((path: string) => {
    dispatch({ type: 'REMOVE_FILE', path });
  }, []);
  const addFile = useCallback(() => {
    dispatch({ type: 'ADD_FILE' });
  }, []);
  const setEntryPoint = useCallback((value: string) => {
    dispatch({ type: 'SET_ENTRY_POINT', value });
  }, []);
  const setManifestPath = useCallback((value: string) => {
    dispatch({ type: 'SET_MANIFEST_PATH', value });
  }, []);
  const setManifestText = useCallback((value: string) => {
    dispatch({ type: 'SET_MANIFEST_TEXT', value });
  }, []);
  const setManifestError = useCallback((value: string | null) => {
    dispatch({ type: 'SET_MANIFEST_ERROR', value });
  }, []);
  const setCapabilityFlagsInput = useCallback((value: string) => {
    dispatch({ type: 'SET_CAPABILITY_FLAGS_INPUT', value });
  }, []);
  const setVersionInput = useCallback((value: string) => {
    dispatch({ type: 'SET_VERSION_INPUT', value });
  }, []);
  const setRegenerating = useCallback((value: boolean) => {
    dispatch({ type: 'SET_REGENERATING', value });
  }, []);
  const setRegenerateError = useCallback((value: string | null) => {
    dispatch({ type: 'SET_REGENERATE_ERROR', value });
  }, []);
  const setRegenerateSuccess = useCallback((value: string | null) => {
    dispatch({ type: 'SET_REGENERATE_SUCCESS', value });
  }, []);
  const setShowDiff = useCallback((value: boolean) => {
    dispatch({ type: 'SET_SHOW_DIFF', value });
  }, []);
  const setAiReviewPending = useCallback((value: boolean) => {
    dispatch({ type: 'SET_AI_REVIEW_PENDING', value });
  }, []);
  const applyAiUpdate = useCallback(
    (bundle: BundleEditorData) => {
      const files = buildInitialFiles(bundle.editor.files).map(cloneFileState);
      const manifestJson = JSON.stringify(bundle.editor.manifest ?? {}, null, 2);
      const capabilityFlags = normalizeCapabilityFlagArray(bundle.bundle.capabilityFlags);
      const capabilityFlagsInput = capabilityFlags.join(', ');
      let hasChanges = true;
      if (state.baseline) {
        const sameFiles = filesEqual(files, state.baseline.files);
        const sameEntryPoint = bundle.editor.entryPoint === state.baseline.entryPoint;
        const sameManifestPath = bundle.editor.manifestPath === state.baseline.manifestPath;
        const sameManifest = manifestJson.trim() === state.baseline.manifestText.trim();
        const sameFlags =
          capabilityFlags.length === state.baseline.capabilityFlags.length &&
          capabilityFlags.every((flag, index) => flag === state.baseline!.capabilityFlags[index]);
        hasChanges = !(sameFiles && sameEntryPoint && sameManifestPath && sameManifest && sameFlags);
      }
      const activePath = state.activePath && files.some((file) => file.path === state.activePath)
        ? state.activePath
        : files[0]?.path ?? state.baseline?.files[0]?.path ?? null;

      dispatch({
        type: 'APPLY_AI_UPDATE',
        payload: {
          files,
          entryPoint: bundle.editor.entryPoint,
          manifestPath: bundle.editor.manifestPath,
          manifestText: manifestJson,
          capabilityFlagsInput,
          activePath,
          showDiff: hasChanges,
          aiReviewPending: hasChanges
        }
      });

      return hasChanges;
    },
    [state.activePath, state.baseline]
  );

  const activeFile = useMemo(() => {
    if (!state.activePath) {
      return null;
    }
    return state.files.find((file) => file.path === state.activePath) ?? null;
  }, [state.activePath, state.files]);

  const baselineFiles = useMemo(() => state.baseline?.files ?? null, [state.baseline]);

  const isDirty = useMemo(() => {
    if (!state.baseline) {
      return false;
    }
    if (state.versionInput.trim().length > 0) {
      return true;
    }
    if (state.entryPoint !== state.baseline.entryPoint) {
      return true;
    }
    if (state.manifestPath !== state.baseline.manifestPath) {
      return true;
    }
    if (state.manifestText.trim() !== state.baseline.manifestText.trim()) {
      return true;
    }
    const currentFlags = normalizeCapabilityFlags(state.capabilityFlagsInput);
    if (currentFlags.length !== state.baseline.capabilityFlags.length) {
      return true;
    }
    for (let index = 0; index < currentFlags.length; index += 1) {
      if (currentFlags[index] !== state.baseline.capabilityFlags[index]) {
        return true;
      }
    }
    if (!filesEqual(state.files, state.baseline.files)) {
      return true;
    }
    return false;
  }, [state]);

  return {
    state,
    activeFile,
    baselineFiles,
    isDirty,
    loadSnapshot,
    resetToBaseline,
    selectFile,
    updateFile,
    renameFile,
    toggleExecutable,
    removeFile,
    addFile,
    setEntryPoint,
    setManifestPath,
    setManifestText,
    setManifestError,
    setCapabilityFlagsInput,
    setVersionInput,
    setRegenerating,
    setRegenerateError,
    setRegenerateSuccess,
    setShowDiff,
    setAiReviewPending,
    applyAiUpdate
  };
}
