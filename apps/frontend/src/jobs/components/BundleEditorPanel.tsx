import { useMemo } from 'react';
import { Editor } from '../../components/Editor';
import DiffViewer from '../../components/DiffViewer';
import { getStatusToneClasses } from '../../theme/statusTokens';
import {
  inferLanguage,
  type FileState
} from '../utils';

const PANEL_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass shadow-elevation-xl transition-colors';

const HEADER_CONTAINER_CLASSES = 'border-b border-subtle px-6 py-4';

const HEADER_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

const HEADER_SUBTEXT_CLASSES = 'text-scale-xs text-muted';

const TOOLBAR_BUTTON_BASE =
  'rounded-full border px-3 py-1 text-scale-xs font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const TOOLBAR_BUTTON_MUTED =
  `${TOOLBAR_BUTTON_BASE} border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong`;

const TOOLBAR_BUTTON_ACCENT =
  `${TOOLBAR_BUTTON_BASE} border-accent bg-transparent text-accent hover:bg-accent-soft`;

const TOOLBAR_BUTTON_PRIMARY =
  'rounded-full bg-accent px-3 py-1 text-scale-xs font-weight-semibold text-on-accent shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const CHIP_BASE =
  'inline-flex items-center gap-2 rounded-full border px-2 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.25em]';

const FILE_LIST_BUTTON_BASE =
  'w-full rounded-lg border border-transparent px-2 py-1.5 text-left text-scale-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const FILE_LIST_BUTTON_ACTIVE = 'border-accent bg-accent text-on-accent shadow-elevation-md';

const FILE_LIST_BUTTON_INACTIVE = 'hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong text-secondary';

const FILE_BADGE_CLASSES =
  'ml-2 rounded-full border border-accent-soft bg-accent-soft px-2 py-0.5 text-[10px] font-weight-semibold uppercase tracking-wide text-accent';

const FIELD_LABEL_CLASSES = 'text-scale-xs font-weight-semibold uppercase tracking-wide text-muted';

const INPUT_BASE_CLASSES =
  'rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const TEXTAREA_BASE_CLASSES = `${INPUT_BASE_CLASSES} min-h-[72px]`; 

const MESSAGE_BLOCK_CLASSES =
  'rounded-lg border border-dashed border-subtle bg-surface-muted p-8 text-center text-scale-sm text-muted';

const DANGER_BUTTON_CLASSES =
  'rounded-full border border-status-danger px-3 py-1 text-scale-xs font-weight-semibold text-status-danger transition-colors hover:bg-status-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

function buildStatusBadge(status: string): string {
  return `${CHIP_BASE} ${getStatusToneClasses(status)}`;
}

type BundleEditorPanelProps = {
  files: FileState[];
  activeFile: FileState | null;
  activePath: string | null;
  onSelectFile: (path: string) => void;
  onChangeFile: (path: string, contents: string) => void;
  onRenameFile: (path: string, nextPath: string) => void;
  onToggleExecutable: (path: string) => void;
  onRemoveFile: (path: string) => void;
  onAddFile: () => void;
  entryPoint: string;
  onEntryPointChange: (value: string) => void;
  manifestPath: string;
  onManifestPathChange: (value: string) => void;
  manifestText: string;
  onManifestTextChange: (value: string) => void;
  manifestError: string | null;
  capabilityFlagsInput: string;
  onCapabilityFlagsChange: (value: string) => void;
  versionInput: string;
  onVersionInputChange: (value: string) => void;
  isDirty: boolean;
  onReset: () => void;
  onOpenAiEdit: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  regenerateError: string | null;
  regenerateSuccess: string | null;
  aiBusy: boolean;
  baselineFiles: FileState[] | null;
  showDiff: boolean;
  onShowDiffChange: (value: boolean) => void;
  aiReviewPending: boolean;
};

type FileListItem = {
  path: string;
  current: FileState | null;
  baseline: FileState | null;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
};

export function BundleEditorPanel({
  files,
  activeFile,
  activePath,
  onSelectFile,
  onChangeFile,
  onRenameFile,
  onToggleExecutable,
  onRemoveFile,
  onAddFile,
  entryPoint,
  onEntryPointChange,
  manifestPath,
  onManifestPathChange,
  manifestText,
  onManifestTextChange,
  manifestError,
  capabilityFlagsInput,
  onCapabilityFlagsChange,
  versionInput,
  onVersionInputChange,
  isDirty,
  onReset,
  onOpenAiEdit,
  onRegenerate,
  regenerating,
  regenerateError,
  regenerateSuccess,
  aiBusy,
  baselineFiles,
  showDiff,
  onShowDiffChange,
  aiReviewPending
}: BundleEditorPanelProps) {
  const baselineMap = useMemo(() => {
    const map = new Map<string, FileState>();
    baselineFiles?.forEach((file) => {
      map.set(file.path, file);
    });
    return map;
  }, [baselineFiles]);

  const fileItems = useMemo(() => {
    const items: FileListItem[] = [];
    const currentMap = new Map<string, FileState>();
    for (const file of files) {
      currentMap.set(file.path, file);
      const baselineFile = baselineMap.get(file.path) ?? null;
      let status: FileListItem['status'] = 'unchanged';
      if (!baselineFile) {
        status = 'added';
      } else if (
        baselineFile.contents !== file.contents ||
        baselineFile.encoding !== file.encoding ||
        baselineFile.executable !== file.executable
      ) {
        status = 'modified';
      }
      items.push({ path: file.path, current: file, baseline: baselineFile, status });
    }
    baselineFiles?.forEach((file) => {
      if (!currentMap.has(file.path)) {
        items.push({ path: file.path, current: null, baseline: file, status: 'removed' });
      }
    });
    return items.sort((a, b) => a.path.localeCompare(b.path));
  }, [baselineFiles, baselineMap, files]);

  const visibleItems = showDiff ? fileItems : fileItems.filter((item) => item.current !== null);
  const activeItem = activePath ? fileItems.find((item) => item.path === activePath) ?? null : null;
  const diffUnavailable = Boolean(
    showDiff &&
      activeItem &&
      (activeItem.current?.encoding === 'base64' || activeItem.baseline?.encoding === 'base64')
  );
  const diffLanguage = inferLanguage(activePath ?? activeItem?.current?.path ?? activeItem?.baseline?.path ?? null);
  const diffOriginal = activeItem?.baseline?.contents ?? '';
  const diffModified = activeItem?.current?.contents ?? '';

  const statusLabel = (status: FileListItem['status']) => {
    switch (status) {
      case 'added':
        return 'New';
      case 'removed':
        return 'Removed';
      case 'modified':
        return 'Updated';
      default:
        return null;
    }
  };

  return (
    <div className={PANEL_CLASSES}>
      <div className={HEADER_CONTAINER_CLASSES}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className={HEADER_TITLE_CLASSES}>Bundle editor</h3>
            <p className={HEADER_SUBTEXT_CLASSES}>
              Edit bundle source files and manifest. Regenerate to publish a new version.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={TOOLBAR_BUTTON_MUTED}
              onClick={onReset}
              disabled={!isDirty || regenerating || aiBusy}
            >
              Reset changes
            </button>
            <button
              type="button"
              className={TOOLBAR_BUTTON_ACCENT}
              onClick={onOpenAiEdit}
              disabled={aiBusy || regenerating}
            >
              {aiBusy ? 'AI drafting…' : 'Ask AI'}
            </button>
            <button
              type="button"
              className={TOOLBAR_BUTTON_PRIMARY}
              onClick={onRegenerate}
              disabled={regenerating || aiBusy}
            >
              {regenerating ? 'Publishing…' : 'Regenerate'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-scale-xs text-muted">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showDiff}
              onChange={(event) => onShowDiffChange(event.target.checked)}
              className="accent-accent"
            />
            Show diff view
          </label>
          {aiReviewPending && (
            <span className={buildStatusBadge('warning')}>Review AI changes</span>
          )}
          {regenerateSuccess && (
            <span className={buildStatusBadge('success')}>{regenerateSuccess}</span>
          )}
          {regenerateError && (
            <span className={buildStatusBadge('failed')}>{regenerateError}</span>
          )}
        </div>
      </div>
      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div className="mb-3 flex items-center justify-between text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">
            <span>Files</span>
            <button
              type="button"
              className={`${TOOLBAR_BUTTON_MUTED} px-2`}
              onClick={onAddFile}
              disabled={regenerating || aiBusy}
            >
              Add file
            </button>
          </div>
          <ul className="flex max-h-[320px] flex-col gap-1 overflow-y-auto pr-1 text-sm">
            {visibleItems.map((item) => {
              const active = item.path === activePath;
              const status = statusLabel(item.status);
              return (
                <li key={item.path}>
                  <button
                    type="button"
                    onClick={() => onSelectFile(item.path)}
                    className={`${FILE_LIST_BUTTON_BASE} ${active ? FILE_LIST_BUTTON_ACTIVE : FILE_LIST_BUTTON_INACTIVE}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate font-weight-medium text-primary">{item.path}</span>
                      {status && (
                        <span className={FILE_BADGE_CLASSES}>{status}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted">
                      {item.current?.encoding === 'base64' || item.baseline?.encoding === 'base64'
                        ? 'Binary'
                        : item.current?.executable ?? item.baseline?.executable
                        ? 'Executable'
                        : 'Text'}
                    </div>
                  </button>
                </li>
              );
            })}
            {visibleItems.length === 0 && (
              <li className="rounded-lg border border-dashed border-subtle bg-surface-muted px-3 py-4 text-center text-scale-xs text-muted">No files in bundle</li>
            )}
          </ul>
        </div>
        <div className="flex flex-col gap-4">
          {showDiff ? (
            activeItem ? (
              diffUnavailable ? (
                <div className={MESSAGE_BLOCK_CLASSES}>Binary files cannot be diffed. Exit diff view to make manual adjustments.</div>
              ) : (
                <DiffViewer
                  original={diffOriginal}
                  modified={diffModified}
                  language={diffLanguage}
                  height={320}
                  ariaLabel={`Review changes for ${activeItem.path}`}
                />
              )
            ) : (
              <div className={MESSAGE_BLOCK_CLASSES}>Select a file to compare the AI changes.</div>
            )
          ) : activeFile ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  className={`${INPUT_BASE_CLASSES} flex-1`}
                  value={activeFile.path}
                  onChange={(event) => onRenameFile(activeFile.path, event.target.value)}
                  disabled={activeFile.readOnly || regenerating || aiBusy}
                />
                <label className="flex items-center gap-1 text-scale-xs text-secondary">
                  <input
                    type="checkbox"
                    checked={activeFile.executable}
                    onChange={() => onToggleExecutable(activeFile.path)}
                    disabled={activeFile.readOnly || regenerating || aiBusy}
                    className="accent-accent"
                  />
                  Executable
                </label>
                <button
                  type="button"
                  className={DANGER_BUTTON_CLASSES}
                  onClick={() => onRemoveFile(activeFile.path)}
                  disabled={regenerating || aiBusy}
                >
                  Remove
                </button>
              </div>
              <Editor
                value={activeFile.contents}
                onChange={(value) => onChangeFile(activeFile.path, value)}
                language={inferLanguage(activeFile.path)}
                readOnly={activeFile.readOnly}
                height={320}
                ariaLabel={`Edit ${activeFile.path}`}
              />
              {activeFile.readOnly && (
                <p className="text-scale-xs text-muted">
                  This file is stored as binary data. Convert it to UTF-8 if you need to edit it here.
                </p>
              )}
            </div>
          ) : (
            <div className={MESSAGE_BLOCK_CLASSES}>Select a file to view or edit its contents.</div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className={FIELD_LABEL_CLASSES}>
                Entry point
              </label>
              <input
                type="text"
                className={INPUT_BASE_CLASSES}
                value={entryPoint}
                onChange={(event) => onEntryPointChange(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className={FIELD_LABEL_CLASSES}>
                Manifest path
              </label>
              <input
                type="text"
                className={INPUT_BASE_CLASSES}
                value={manifestPath}
                onChange={(event) => onManifestPathChange(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className={FIELD_LABEL_CLASSES}>
                Capability flags
              </label>
              <textarea
                className={TEXTAREA_BASE_CLASSES}
                value={capabilityFlagsInput}
                onChange={(event) => onCapabilityFlagsChange(event.target.value)}
                placeholder="comma-separated"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className={FIELD_LABEL_CLASSES}>
                Explicit version (optional)
              </label>
              <input
                type="text"
                className={INPUT_BASE_CLASSES}
                value={versionInput}
                onChange={(event) => onVersionInputChange(event.target.value)}
                placeholder="auto increment"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className={FIELD_LABEL_CLASSES}>
              Manifest
            </label>
            <Editor
              value={manifestText}
              onChange={onManifestTextChange}
              language="json"
              height={240}
              ariaLabel="Edit bundle manifest"
            />
            {manifestError && (
              <p className="text-scale-xs text-status-danger">{manifestError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
