import { useMemo } from 'react';
import { Editor } from '../../components/Editor';
import DiffViewer from '../../components/DiffViewer';
import {
  inferLanguage,
  type FileState
} from '../utils';

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
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Bundle editor</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Edit bundle source files and manifest. Regenerate to publish a new version.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={onReset}
              disabled={!isDirty || regenerating || aiBusy}
            >
              Reset changes
            </button>
            <button
              type="button"
              className="rounded-full border border-violet-500 px-3 py-1 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-400 dark:text-violet-200 dark:hover:bg-violet-400/20"
              onClick={onOpenAiEdit}
              disabled={aiBusy || regenerating}
            >
              {aiBusy ? 'AI drafting…' : 'Ask AI'}
            </button>
            <button
              type="button"
              className="rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
              onClick={onRegenerate}
              disabled={regenerating || aiBusy}
            >
              {regenerating ? 'Publishing…' : 'Regenerate'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showDiff}
              onChange={(event) => onShowDiffChange(event.target.checked)}
            />
            Show diff view
          </label>
          {aiReviewPending && (
            <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-700 dark:bg-amber-500/30 dark:text-amber-200">
              Review AI changes
            </span>
          )}
          {regenerateSuccess && (
            <span className="rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
              {regenerateSuccess}
            </span>
          )}
          {regenerateError && (
            <span className="rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-200">
              {regenerateError}
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span>Files</span>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
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
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${active ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate font-medium">{item.path}</span>
                      {status && (
                        <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {status}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
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
              <li className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                No files in bundle
              </li>
            )}
          </ul>
        </div>
        <div className="flex flex-col gap-4">
          {showDiff ? (
            activeItem ? (
              diffUnavailable ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
                  Binary files cannot be diffed. Exit diff view to make manual adjustments.
                </div>
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
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
                Select a file to compare the AI changes.
              </div>
            )
          ) : activeFile ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-violet-400"
                  value={activeFile.path}
                  onChange={(event) => onRenameFile(activeFile.path, event.target.value)}
                  disabled={activeFile.readOnly || regenerating || aiBusy}
                />
                <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={activeFile.executable}
                    onChange={() => onToggleExecutable(activeFile.path)}
                    disabled={activeFile.readOnly || regenerating || aiBusy}
                  />
                  Executable
                </label>
                <button
                  type="button"
                  className="rounded-full border border-red-300 px-3 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 dark:border-red-500 dark:text-red-300 dark:hover:bg-red-500/10"
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
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  This file is stored as binary data. Convert it to UTF-8 if you need to edit it here.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
              Select a file to view or edit its contents.
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Entry point
              </label>
              <input
                type="text"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-violet-400"
                value={entryPoint}
                onChange={(event) => onEntryPointChange(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Manifest path
              </label>
              <input
                type="text"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-violet-400"
                value={manifestPath}
                onChange={(event) => onManifestPathChange(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Capability flags
              </label>
              <textarea
                className="min-h-[72px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-violet-400"
                value={capabilityFlagsInput}
                onChange={(event) => onCapabilityFlagsChange(event.target.value)}
                placeholder="comma-separated"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Explicit version (optional)
              </label>
              <input
                type="text"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-violet-400"
                value={versionInput}
                onChange={(event) => onVersionInputChange(event.target.value)}
                placeholder="auto increment"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
              <p className="text-xs text-red-600 dark:text-red-400">{manifestError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
