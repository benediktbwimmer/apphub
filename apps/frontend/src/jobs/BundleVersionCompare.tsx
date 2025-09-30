import classNames from 'classnames';
import { useEffect, useMemo, useState } from 'react';
import DiffViewer from '../components/DiffViewer';
import { Spinner } from '../components';
import { API_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import type { AuthorizedFetch } from '../workflows/api';
import type { BundleEditorData } from './api';
import { fetchBundleVersionDetail } from './api';
import { extractBundleArchive, type BundleArchiveFile } from './bundleArchive';
import { getStatusToneClasses } from '../theme/statusTokens';
import {
  JOB_CARD_CONTAINER_CLASSES,
  JOB_EMPTY_STATE_CONTAINER_CLASSES,
  JOB_FILE_META_TEXT_CLASSES,
  JOB_FORM_ERROR_TEXT_CLASSES,
  JOB_FORM_LABEL_BADGE_TITLE_CLASSES,
  JOB_FORM_LABEL_SMALL_CLASSES,
  JOB_FORM_INPUT_CLASSES,
  JOB_LIST_BUTTON_ACTIVE_CLASSES,
  JOB_LIST_BUTTON_BASE_CLASSES,
  JOB_LIST_BUTTON_INACTIVE_CLASSES,
  JOB_SECTION_PARAGRAPH_CLASSES,
  JOB_SECTION_TITLE_SMALL_CLASSES,
  JOB_STATUS_BADGE_BASE_CLASSES
} from './jobTokens';

type VersionSnapshot = {
  version: string;
  files: BundleArchiveFile[];
};

type SnapshotState = {
  snapshot: VersionSnapshot | null;
  loading: boolean;
  error: string | null;
};

type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

type DiffItem = {
  path: string;
  left: BundleArchiveFile | null;
  right: BundleArchiveFile | null;
  status: DiffStatus;
  diffable: boolean;
};

function resolveDownloadUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `${API_BASE_URL}${url}`;
}

async function loadVersionSnapshot(
  fetcher: AuthorizedFetch,
  slug: string,
  version: string
): Promise<VersionSnapshot> {
  const detail = await fetchBundleVersionDetail(fetcher, slug, version);
  const downloadUrl = detail.version.download?.url;
  if (!downloadUrl) {
    throw new Error('Bundle version does not include a downloadable artifact.');
  }
  const response = await fetcher(resolveDownloadUrl(downloadUrl));
  if (!response.ok) {
    throw new Error('Failed to download bundle artifact');
  }
  const buffer = await response.arrayBuffer();
  const files = extractBundleArchive(new Uint8Array(buffer));
  return { version: detail.version.version, files };
}

function useBundleVersionSnapshot(
  fetcher: AuthorizedFetch,
  slug: string,
  version: string | null
): SnapshotState {
  const [state, setState] = useState<SnapshotState>({ snapshot: null, loading: false, error: null });

  useEffect(() => {
    if (!version) {
      setState({ snapshot: null, loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    let canceled = false;
    setState({ snapshot: null, loading: true, error: null });

    const run = async () => {
      try {
        const snapshot = await loadVersionSnapshot(
          (input, init) => fetcher(input, { ...init, signal: controller.signal }),
          slug,
          version
        );
        if (!canceled) {
          setState({ snapshot, loading: false, error: null });
        }
      } catch (err) {
        if (canceled) {
          return;
        }
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load bundle version';
        setState({ snapshot: null, loading: false, error: message });
      }
    };

    void run();

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [fetcher, slug, version]);

  return state;
}

function summarizeDiffStatus(status: DiffStatus): string {
  switch (status) {
    case 'added':
      return 'Added';
    case 'removed':
      return 'Removed';
    case 'changed':
      return 'Modified';
    default:
      return 'Unchanged';
  }
}

function diffStatusTone(status: DiffStatus): string {
  switch (status) {
    case 'added':
      return getStatusToneClasses('success');
    case 'removed':
      return getStatusToneClasses('danger');
    case 'changed':
      return getStatusToneClasses('warning');
    default:
      return getStatusToneClasses('neutral');
  }
}

function describeFile(file: BundleArchiveFile | null): string {
  if (!file) {
    return 'Not present';
  }
  if (file.encoding === 'base64') {
    return 'Binary file';
  }
  return file.executable ? 'Executable text file' : 'Text file';
}

type BundleVersionCompareProps = {
  bundle: BundleEditorData;
  className?: string;
};

export function BundleVersionCompare({ bundle, className }: BundleVersionCompareProps) {
  const authorizedFetch = useAuthorizedFetch();
  const slug = bundle.binding.slug;
  const versions = bundle.availableVersions;
  const [selection, setSelection] = useState<{ left: string | null; right: string | null }>({
    left: null,
    right: null
  });

  const versionsKey = useMemo(
    () => versions.map((entry) => entry.version).join('|'),
    [versions]
  );

  useEffect(() => {
    const availableSet = new Set(versions.map((entry) => entry.version));
    setSelection((current) => {
      let left = current.left && availableSet.has(current.left) ? current.left : null;
      let right = current.right && availableSet.has(current.right) ? current.right : null;

      if (!right) {
        right = versions[0]?.version ?? null;
      }

      if (!left) {
        const alternative = versions.find((entry) => entry.version !== right);
        left = alternative ? alternative.version : versions[1]?.version ?? null;
      }

      if (versions.length <= 1) {
        left = null;
      } else if (left && right && left === right) {
        const alternative = versions.find((entry) => entry.version !== right);
        left = alternative ? alternative.version : null;
      }

      if (left === current.left && right === current.right) {
        return current;
      }
      return { left, right };
    });
  }, [slug, versionsKey, versions]);

  const leftState = useBundleVersionSnapshot(authorizedFetch, slug, selection.left);
  const rightState = useBundleVersionSnapshot(authorizedFetch, slug, selection.right);

  const diffItems = useMemo<DiffItem[]>(() => {
    const leftFiles = leftState.snapshot?.files ?? [];
    const rightFiles = rightState.snapshot?.files ?? [];
    const leftMap = new Map(leftFiles.map((file) => [file.path, file] as const));
    const rightMap = new Map(rightFiles.map((file) => [file.path, file] as const));
    const paths = new Set<string>();
    for (const path of leftMap.keys()) {
      paths.add(path);
    }
    for (const path of rightMap.keys()) {
      paths.add(path);
    }
    const items: DiffItem[] = [];
    for (const path of Array.from(paths).sort((a, b) => a.localeCompare(b))) {
      const left = leftMap.get(path) ?? null;
      const right = rightMap.get(path) ?? null;
      let status: DiffStatus;
      if (left && right) {
        status =
          left.contents === right.contents &&
          left.encoding === right.encoding &&
          left.executable === right.executable
            ? 'unchanged'
            : 'changed';
      } else if (left && !right) {
        status = 'removed';
      } else if (!left && right) {
        status = 'added';
      } else {
        status = 'unchanged';
      }
      const diffable = (!left || left.encoding === 'utf8') && (!right || right.encoding === 'utf8');
      items.push({ path, left, right, status, diffable });
    }
    return items.filter((item) => item.status !== 'unchanged');
  }, [leftState.snapshot, rightState.snapshot]);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (diffItems.length === 0) {
      if (selectedPath !== null) {
        setSelectedPath(null);
      }
      return;
    }
    if (!selectedPath || !diffItems.some((item) => item.path === selectedPath)) {
      setSelectedPath(diffItems[0].path);
    }
  }, [diffItems, selectedPath]);

  const selectedItem = diffItems.find((item) => item.path === selectedPath) ?? null;
  const combinedError = leftState.error ?? rightState.error;
  const loading = (selection.left ? leftState.loading : false) || (selection.right ? rightState.loading : false);
  const hasEnoughVersions = versions.length >= 2;

  const containerClass = classNames(JOB_CARD_CONTAINER_CLASSES, className);

  return (
    <div className={containerClass}>
      <h4 className={JOB_SECTION_TITLE_SMALL_CLASSES}>Compare versions</h4>
      <p className={classNames('mt-1', JOB_SECTION_PARAGRAPH_CLASSES)}>
        Select two bundle versions to review changes in their files.
      </p>
      {!hasEnoughVersions ? (
        <p className={classNames('mt-3', JOB_SECTION_PARAGRAPH_CLASSES)}>
          Register at least two bundle versions to enable comparisons.
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className={JOB_FORM_LABEL_SMALL_CLASSES}>
              <span className={JOB_FORM_LABEL_BADGE_TITLE_CLASSES}>Version A</span>
              <select
                className={classNames('w-full', JOB_FORM_INPUT_CLASSES)}
                value={selection.left ?? ''}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  setSelection((current) => ({ ...current, left: value.length > 0 ? value : null }));
                }}
              >
                <option value="">Select version…</option>
                {versions.map((entry) => (
                  <option key={entry.version} value={entry.version}>
                    {entry.version} ({entry.status})
                  </option>
                ))}
              </select>
            </label>
            <label className={JOB_FORM_LABEL_SMALL_CLASSES}>
              <span className={JOB_FORM_LABEL_BADGE_TITLE_CLASSES}>Version B</span>
              <select
                className={classNames('w-full', JOB_FORM_INPUT_CLASSES)}
                value={selection.right ?? ''}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  setSelection((current) => ({ ...current, right: value.length > 0 ? value : null }));
                }}
              >
                <option value="">Select version…</option>
                {versions.map((entry) => (
                  <option key={entry.version} value={entry.version}>
                    {entry.version} ({entry.status})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {combinedError && (
            <p className={classNames('mt-3', JOB_FORM_ERROR_TEXT_CLASSES)}>{combinedError}</p>
          )}
          {loading && (
            <div className={classNames('mt-3 inline-flex items-center gap-2', JOB_SECTION_PARAGRAPH_CLASSES)}>
              <Spinner label="Loading bundle artifacts…" size="xs" />
            </div>
          )}
          {!loading && diffItems.length === 0 && (
            <p className={classNames('mt-3', JOB_SECTION_PARAGRAPH_CLASSES)}>
              No differences detected between the selected versions.
            </p>
          )}
          {diffItems.length > 0 && (
            <div className="mt-4 flex flex-col gap-4 lg:flex-row">
              <aside className="lg:w-72">
                <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-2 text-sm">
                  {diffItems.map((item) => {
                    const isActive = item.path === selectedPath;
                    return (
                      <li key={item.path}>
                        <button
                          type="button"
                          onClick={() => setSelectedPath(item.path)}
                          className={classNames(
                            JOB_LIST_BUTTON_BASE_CLASSES,
                            isActive ? JOB_LIST_BUTTON_ACTIVE_CLASSES : JOB_LIST_BUTTON_INACTIVE_CLASSES
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{item.path}</span>
                            <span
                              className={classNames(
                                'whitespace-nowrap px-2 py-0.5',
                                JOB_STATUS_BADGE_BASE_CLASSES,
                                diffStatusTone(item.status)
                              )}
                            >
                              {summarizeDiffStatus(item.status)}
                            </span>
                          </div>
                          <div className={JOB_FILE_META_TEXT_CLASSES}>
                            {describeFile(item.left)} → {describeFile(item.right)}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </aside>
              <section className="flex-1">
                {selectedItem ? (
                  selectedItem.diffable ? (
                    <DiffViewer
                      original={selectedItem.left?.encoding === 'utf8' ? selectedItem.left.contents : ''}
                      modified={selectedItem.right?.encoding === 'utf8' ? selectedItem.right.contents : ''}
                      language={selectedItem.path.endsWith('.json') ? 'json' : undefined}
                      height={320}
                      ariaLabel={`Diff for ${selectedItem.path}`}
                    />
                  ) : (
                    <div className={JOB_EMPTY_STATE_CONTAINER_CLASSES}>
                      {selectedItem.left?.encoding === 'base64' || selectedItem.right?.encoding === 'base64'
                        ? 'Binary files cannot be displayed in the diff viewer. Download the bundle artifact to inspect the file.'
                        : 'No textual content available for comparison.'}
                    </div>
                  )
                ) : (
                  <div className={JOB_EMPTY_STATE_CONTAINER_CLASSES}>
                    Select a file from the list to preview its changes.
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default BundleVersionCompare;
