import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import type { JobDefinitionSummary } from '../workflows/api';
import { Editor } from '../components/Editor';
import { useToasts } from '../components/toast';
import {
  fetchJobs,
  fetchJobDetail,
  fetchJobBundleEditor,
  regenerateJobBundle,
  fetchJobRuntimeStatuses,
  type JobRuntimeStatus,
  type BundleEditorData,
  type BundleEditorFile,
  type BundleRegenerateInput,
  type JobDetailResponse
} from './api';
import JobCreateDialog from './JobCreateDialog';
import JobAiEditDialog from './JobAiEditDialog';

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function normalizeCapabilityFlags(raw: string): string[] {
  const entries = raw
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return normalizeCapabilityFlagArray(entries);
}

function normalizeCapabilityFlagArray(flags: string[]): string[] {
  const unique = new Map<string, string>();
  for (const flag of flags) {
    const trimmed = flag.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  }
  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
}

type FileState = {
  path: string;
  contents: string;
  encoding: 'utf8' | 'base64';
  executable: boolean;
  readOnly: boolean;
};

type EditorBaseline = {
  files: FileState[];
  manifestText: string;
  manifestPath: string;
  entryPoint: string;
  capabilityFlags: string[];
};

type JobPanelState = {
  detail: JobDetailResponse | null;
  detailError: string | null;
  detailLoading: boolean;
  bundle: BundleEditorData | null;
  bundleError: string | null;
  bundleLoading: boolean;
};

function buildInitialFiles(files: BundleEditorFile[]): FileState[] {
  return files
    .map((file) => ({
      path: file.path,
      contents: file.contents,
      encoding: file.encoding,
      executable: Boolean(file.executable),
      readOnly: file.encoding !== 'utf8'
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function filesEqual(a: FileState[], b: FileState[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.path !== right.path ||
      left.contents !== right.contents ||
      left.encoding !== right.encoding ||
      left.executable !== right.executable
    ) {
      return false;
    }
  }
  return true;
}

function useJobs(): {
  jobs: JobDefinitionSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const authorizedFetch = useAuthorizedFetch();
  const [jobs, setJobs] = useState<JobDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const data = await fetchJobs(authorizedFetch);
        if (!canceled) {
          setJobs(data.sort((a, b) => a.slug.localeCompare(b.slug)));
        }
      } catch (err) {
        if (!canceled) {
          const message = err instanceof Error ? err.message : 'Failed to load jobs';
          setError(message);
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, [authorizedFetch, refreshToken]);

  const refresh = () => setRefreshToken((token) => token + 1);

  return { jobs, loading, error, refresh };
}

export default function JobsPage() {
  const authorizedFetch = useAuthorizedFetch();
  const { pushToast } = useToasts();
  const { jobs, loading: jobsLoading, error: jobsError, refresh: refreshJobs } = useJobs();
  const [runtimeStatuses, setRuntimeStatuses] = useState<JobRuntimeStatus[]>([]);
  const [runtimeStatusLoading, setRuntimeStatusLoading] = useState(false);
  const [runtimeStatusError, setRuntimeStatusError] = useState<string | null>(null);
  const refreshRuntimeStatuses = useCallback(() => {
    setRuntimeStatusLoading(true);
    setRuntimeStatusError(null);
    fetchJobRuntimeStatuses(authorizedFetch)
      .then((statuses) => {
        setRuntimeStatuses(statuses);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load runtime readiness';
        setRuntimeStatusError(message);
      })
      .finally(() => {
        setRuntimeStatusLoading(false);
      });
  }, [authorizedFetch]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [panelState, setPanelState] = useState<JobPanelState>({
    detail: null,
    detailError: null,
    detailLoading: false,
    bundle: null,
    bundleError: null,
    bundleLoading: false
  });

  const [files, setFiles] = useState<FileState[]>([]);
  const [baseline, setBaseline] = useState<EditorBaseline | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [entryPoint, setEntryPoint] = useState('');
  const [manifestPath, setManifestPath] = useState('manifest.json');
  const [manifestText, setManifestText] = useState('');
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [capabilityFlagsInput, setCapabilityFlagsInput] = useState('');
  const [versionInput, setVersionInput] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regenerateSuccess, setRegenerateSuccess] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createRuntime, setCreateRuntime] = useState<'node' | 'python'>('node');
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    refreshRuntimeStatuses();
  }, [refreshRuntimeStatuses]);

  const handleOpenCreate = useCallback((runtime: 'node' | 'python') => {
    setCreateRuntime(runtime);
    setCreateDialogOpen(true);
  }, []);

  const handleJobCreated = useCallback(
    (job: JobDefinitionSummary) => {
      pushToast({
        tone: 'success',
        title: 'Job created',
        description: `${job.name} registered successfully.`
      });
      setCreateDialogOpen(false);
      refreshJobs();
      setSelectedSlug(job.slug);
      refreshRuntimeStatuses();
    },
    [pushToast, refreshJobs, refreshRuntimeStatuses]
  );

  const pythonStatus = runtimeStatuses.find((status) => status.runtime === 'python');
  const pythonReady = pythonStatus ? pythonStatus.ready : true;
  const pythonButtonTitle = pythonReady
    ? undefined
    : pythonStatus?.reason ?? 'Python runtime is not ready';

  const currentJobForAi = panelState.detail
    ? {
        slug: panelState.detail.job.slug,
        name: panelState.detail.job.name,
        runtime: panelState.detail.job.runtime ?? null
      }
    : null;
  const currentBundleForAi = panelState.bundle
    ? {
        slug: panelState.bundle.binding.slug,
        version: panelState.bundle.bundle.version,
        entryPoint: panelState.bundle.editor.entryPoint
      }
    : null;

  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedSlug(null);
      return;
    }
    if (!selectedSlug) {
      setSelectedSlug(jobs[0]?.slug ?? null);
    }
  }, [jobs, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug) {
      setPanelState((prev) => ({
        ...prev,
        detail: null,
        bundle: null
      }));
      return;
    }

    let canceled = false;
    setPanelState({
      detail: null,
      detailError: null,
      detailLoading: true,
      bundle: null,
      bundleError: null,
      bundleLoading: true
    });

    const run = async () => {
      try {
        const [detail, bundle] = await Promise.all([
          fetchJobDetail(authorizedFetch, selectedSlug),
          fetchJobBundleEditor(authorizedFetch, selectedSlug)
        ]);
        if (canceled) {
          return;
        }
        setPanelState({
          detail,
          detailError: null,
          detailLoading: false,
          bundle,
          bundleError: null,
          bundleLoading: false
        });
      } catch (err) {
        if (canceled) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load job detail';
        setPanelState({
          detail: null,
          detailError: message,
          detailLoading: false,
          bundle: null,
          bundleError: message,
          bundleLoading: false
        });
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, [authorizedFetch, selectedSlug]);

  useEffect(() => {
    const snapshot = panelState.bundle;
    if (!snapshot) {
      setFiles([]);
      setBaseline(null);
      setActivePath(null);
      setEntryPoint('');
      setManifestPath('manifest.json');
      setManifestText('');
      setCapabilityFlagsInput('');
      return;
    }

    const initialFiles = buildInitialFiles(snapshot.editor.files);
    const manifestJson = JSON.stringify(snapshot.editor.manifest ?? {}, null, 2);
    const capabilityFlags = normalizeCapabilityFlagArray(snapshot.bundle.capabilityFlags);

    setFiles(initialFiles.map((file) => ({ ...file })));
    setBaseline({
      files: initialFiles.map((file) => ({ ...file })),
      manifestText: manifestJson,
      manifestPath: snapshot.editor.manifestPath,
      entryPoint: snapshot.editor.entryPoint,
      capabilityFlags
    });
    setActivePath(initialFiles[0]?.path ?? null);
    setEntryPoint(snapshot.editor.entryPoint);
    setManifestPath(snapshot.editor.manifestPath);
    setManifestText(manifestJson);
    setManifestError(null);
    setCapabilityFlagsInput(capabilityFlags.join(', '));
    setVersionInput('');
    setRegenerateError(null);
    setRegenerateSuccess(null);
  }, [panelState.bundle]);

  const isDirty = useMemo(() => {
    if (!baseline) {
      return false;
    }
    if (versionInput.trim().length > 0) {
      return true;
    }
    if (entryPoint !== baseline.entryPoint) {
      return true;
    }
    if (manifestPath !== baseline.manifestPath) {
      return true;
    }
    if (manifestText.trim() !== baseline.manifestText.trim()) {
      return true;
    }
    const currentFlags = normalizeCapabilityFlags(capabilityFlagsInput);
    if (currentFlags.length !== baseline.capabilityFlags.length) {
      return true;
    }
    for (let index = 0; index < currentFlags.length; index += 1) {
      if (currentFlags[index] !== baseline.capabilityFlags[index]) {
        return true;
      }
    }
    if (!filesEqual(files, baseline.files)) {
      return true;
    }
    return false;
  }, [baseline, capabilityFlagsInput, entryPoint, files, manifestPath, manifestText, versionInput]);

  const handleFileSelect = (path: string) => {
    setActivePath(path);
  };

  const handleFileChange = (path: string, contents: string) => {
    setFiles((prev) =>
      prev.map((file) => (file.path === path ? { ...file, contents } : file))
    );
  };

  const handleFileRename = (path: string, nextPath: string) => {
    const trimmed = nextPath.trim();
    if (!trimmed || trimmed.startsWith('/') || trimmed.includes('..')) {
      return;
    }
    const normalized = trimmed.split(/[\\/]+/).join('/');
    setFiles((prev) => {
      if (prev.some((file) => file.path === normalized)) {
        return prev;
      }
      return prev.map((file) => (file.path === path ? { ...file, path: normalized } : file)).sort((a, b) => a.path.localeCompare(b.path));
    });
    setActivePath(normalized);
  };

  const handleFileToggleExecutable = (path: string) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.path === path ? { ...file, executable: !file.executable } : file
      )
    );
  };

  const handleFileRemove = (path: string) => {
    const nextFiles = files.filter((file) => file.path !== path);
    setFiles(nextFiles);
    setActivePath((current) => (current === path ? nextFiles[0]?.path ?? null : current));
  };

  const handleFileAdd = () => {
    const baseName = 'new-file.ts';
    let candidate = baseName;
    let counter = 1;
    const existing = new Set(files.map((file) => file.path));
    while (existing.has(candidate)) {
      candidate = `new-file-${counter}.ts`;
      counter += 1;
    }
    const next: FileState = {
      path: candidate,
      contents: '// TODO: implement\n',
      encoding: 'utf8',
      executable: false,
      readOnly: false
    };
    setFiles((prev) => [...prev, next].sort((a, b) => a.path.localeCompare(b.path)));
    setActivePath(candidate);
  };

  const activeFile = files.find((file) => file.path === activePath) ?? null;

  const handleReset = () => {
    if (!baseline) {
      return;
    }
    setFiles(baseline.files.map((file) => ({ ...file })));
    setEntryPoint(baseline.entryPoint);
    setManifestPath(baseline.manifestPath);
    setManifestText(baseline.manifestText);
    setManifestError(null);
    setCapabilityFlagsInput(baseline.capabilityFlags.join(', '));
    setVersionInput('');
    setRegenerateError(null);
    setRegenerateSuccess(null);
  };

  const handleRegenerate = async () => {
    if (!panelState.bundle || !selectedSlug || !baseline) {
      return;
    }
    let manifestValue: unknown = null;
    try {
      manifestValue = manifestText.trim().length > 0 ? JSON.parse(manifestText) : {};
      setManifestError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid manifest JSON';
      setManifestError(message);
      return;
    }

    const capabilityFlags = normalizeCapabilityFlags(capabilityFlagsInput);

    const payloadFiles = files.map((file) => {
      const result: {
        path: string;
        contents: string;
        encoding?: 'utf8' | 'base64';
        executable?: boolean;
      } = {
        path: file.path,
        contents: file.contents
      };
      if (file.encoding === 'base64') {
        result.encoding = 'base64';
      }
      if (file.executable) {
        result.executable = true;
      }
      return result;
    });

    const versionValue = versionInput.trim();
    const payload: BundleRegenerateInput = {
      entryPoint,
      manifestPath: manifestPath.trim() || 'manifest.json',
      manifest: manifestValue,
      files: payloadFiles,
      capabilityFlags,
      metadata: panelState.bundle.bundle.metadata ?? undefined,
      description: undefined,
      displayName: undefined
    };
    if (versionValue.length > 0) {
      payload.version = versionValue;
    }

    setRegenerating(true);
    setRegenerateError(null);
    setRegenerateSuccess(null);

    try {
      const response = await regenerateJobBundle(authorizedFetch, selectedSlug, payload);
      setPanelState((prev) => ({
        detail: prev.detail ? { ...prev.detail, job: response.job } : prev.detail,
        detailError: prev.detailError,
        detailLoading: false,
        bundle: response,
        bundleError: null,
        bundleLoading: false
      }));
      setRegenerateSuccess(
        `Published ${response.binding.slug}@${response.bundle.version}`
      );
      refreshJobs();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate bundle';
      setRegenerateError(message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleOpenAiEdit = useCallback(() => {
    if (!panelState.bundle || aiBusy) {
      return;
    }
    setRegenerateError(null);
    setRegenerateSuccess(null);
    setAiDialogOpen(true);
  }, [panelState.bundle, aiBusy]);

  const handleAiEditComplete = useCallback(
    (data: BundleEditorData) => {
      setPanelState((prev) => ({
        detail: prev.detail ? { ...prev.detail, job: data.job } : prev.detail,
        detailError: prev.detailError,
        detailLoading: false,
        bundle: data,
        bundleError: null,
        bundleLoading: false
      }));
      setRegenerateError(null);
      setRegenerateSuccess(`Published ${data.binding.slug}@${data.bundle.version} via AI`);
      refreshJobs();
      pushToast({
        tone: 'success',
        title: 'Bundle updated',
        description: `Published ${data.binding.slug}@${data.bundle.version}.`
      });
    },
    [pushToast, refreshJobs]
  );

  const handleAiBusyChange = useCallback((busy: boolean) => {
    setAiBusy(busy);
  }, []);

  return (
    <>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Jobs</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Inspect job definitions, review recent runs, and manage bundle source code.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <div className="flex flex-wrap gap-2">
            {runtimeStatusLoading ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Checking runtimes…
              </span>
            ) : runtimeStatuses.length > 0 ? (
              runtimeStatuses.map((status) => {
                const label = status.runtime === 'python' ? 'Python runtime' : 'Node runtime';
                const badgeClass = status.ready
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
                  : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
                const tooltip = status.ready
                  ? status.details && typeof status.details.version === 'string'
                    ? `Version ${status.details.version}`
                    : 'Ready'
                  : status.reason ?? 'Unavailable';
                return (
                  <span
                    key={status.runtime}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}
                    title={tooltip}
                  >
                    {label}: {status.ready ? 'Ready' : 'Unavailable'}
                  </span>
                );
              })
            ) : (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Runtime readiness unknown
              </span>
            )}
          </div>
          {runtimeStatusError && (
            <p className="text-[11px] text-rose-600 dark:text-rose-300">{runtimeStatusError}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => handleOpenCreate('node')}
            >
              New Node job
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => handleOpenCreate('python')}
              disabled={!pythonReady}
              title={pythonButtonTitle}
            >
              New Python job
            </button>
          </div>
        </div>
        </header>
        <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-64">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Job catalog</h2>
              {jobsLoading && <span className="text-xs text-slate-500">Loading…</span>}
            </div>
            {jobsError && (
              <p className="text-xs text-red-600 dark:text-red-400">{jobsError}</p>
            )}
            <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto pr-2 text-sm">
              {jobs.map((job) => {
                const isActive = job.slug === selectedSlug;
                return (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedSlug(job.slug)}
                      className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${isActive ? 'bg-violet-100 text-violet-900 dark:bg-violet-600/20 dark:text-violet-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                    >
                      <div className="font-semibold">{job.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{job.slug}</div>
                    </button>
                  </li>
                );
              })}
              {jobs.length === 0 && !jobsLoading && !jobsError && (
                <li className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  No jobs registered yet.
                </li>
              )}
            </ul>
          </div>
        </aside>
        <section className="flex-1">
          {panelState.detailLoading || panelState.bundleLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              Loading job details…
            </div>
          ) : null}
          {(panelState.detailError || panelState.bundleError) && !panelState.bundleLoading ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-200">
              {panelState.detailError ?? panelState.bundleError}
            </div>
          ) : null}
          {panelState.detail && panelState.bundle && !panelState.bundleLoading && (
            <div className="flex flex-col gap-6">
              <JobSummary detail={panelState.detail} bundle={panelState.bundle} />
              <BundleEditorPanel
                files={files}
                activeFile={activeFile}
                onSelectFile={handleFileSelect}
                onChangeFile={handleFileChange}
                onRenameFile={handleFileRename}
                onToggleExecutable={handleFileToggleExecutable}
                onRemoveFile={handleFileRemove}
                onAddFile={handleFileAdd}
                entryPoint={entryPoint}
                onEntryPointChange={setEntryPoint}
                manifestPath={manifestPath}
                onManifestPathChange={setManifestPath}
                manifestText={manifestText}
                onManifestTextChange={setManifestText}
                manifestError={manifestError}
                capabilityFlagsInput={capabilityFlagsInput}
                onCapabilityFlagsChange={setCapabilityFlagsInput}
                versionInput={versionInput}
                onVersionInputChange={setVersionInput}
                isDirty={isDirty}
                onReset={handleReset}
                onOpenAiEdit={handleOpenAiEdit}
                onRegenerate={handleRegenerate}
                regenerating={regenerating}
                regenerateError={regenerateError}
                regenerateSuccess={regenerateSuccess}
                aiBusy={aiBusy}
              />
              <BundleHistoryPanel bundle={panelState.bundle} />
              <JobRunsPanel detail={panelState.detail} />
            </div>
          )}
        </section>
        </div>
      </div>
      <JobCreateDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        authorizedFetch={authorizedFetch}
        defaultRuntime={createRuntime}
        runtimeStatuses={runtimeStatuses}
        onCreated={handleJobCreated}
      />
      <JobAiEditDialog
        open={aiDialogOpen}
        onClose={() => setAiDialogOpen(false)}
        authorizedFetch={authorizedFetch}
        job={currentJobForAi}
        bundle={currentBundleForAi}
        onComplete={handleAiEditComplete}
        onBusyChange={handleAiBusyChange}
      />
    </>
  );
}

type JobSummaryProps = {
  detail: JobDetailResponse;
  bundle: BundleEditorData;
};

function JobSummary({ detail, bundle }: JobSummaryProps) {
  const definition = detail.job;
  const binding = bundle.binding;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {definition.name}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{definition.slug}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
          <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">Type: {definition.type}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">Runtime: {definition.runtime}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">Version: {definition.version}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
            Bundle: {binding.slug}@{binding.version}
          </span>
        </div>
      </div>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="font-semibold text-slate-600 dark:text-slate-300">Entry point</dt>
          <dd className="text-slate-700 break-words dark:text-slate-200">{definition.entryPoint}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-600 dark:text-slate-300">Timeout</dt>
          <dd className="text-slate-700 dark:text-slate-200">
            {definition.timeoutMs ? `${Math.round(definition.timeoutMs / 1000)}s` : 'Default'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-600 dark:text-slate-300">Created</dt>
          <dd className="text-slate-700 dark:text-slate-200">{formatDate(definition.createdAt)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-600 dark:text-slate-300">Updated</dt>
          <dd className="text-slate-700 dark:text-slate-200">{formatDate(definition.updatedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

type BundleEditorPanelProps = {
  files: FileState[];
  activeFile: FileState | null;
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
};

function BundleEditorPanel({
  files,
  activeFile,
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
  aiBusy
}: BundleEditorPanelProps) {
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
              className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={onReset}
              disabled={!isDirty || regenerating || aiBusy}
            >
              Reset changes
            </button>
            <button
              type="button"
              className="rounded-full border border-violet-500/70 px-4 py-1.5 text-xs font-semibold text-violet-700 shadow-sm transition-colors hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-500/60 dark:text-violet-200 dark:hover:bg-violet-500/10"
              onClick={onOpenAiEdit}
              disabled={regenerating || aiBusy}
            >
              Edit with AI
            </button>
            <button
              type="button"
              className="rounded-full bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-50"
              onClick={onRegenerate}
              disabled={regenerating || aiBusy || !isDirty}
            >
              {regenerating ? 'Publishing…' : 'Regenerate bundle'}
            </button>
          </div>
        </div>
        {regenerateError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{regenerateError}</p>
        )}
        {regenerateSuccess && (
          <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{regenerateSuccess}</p>
        )}
      </div>
      <div className="grid gap-6 px-6 py-4 lg:grid-cols-[240px_1fr]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Files
            </span>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={onAddFile}
            >
              + Add file
            </button>
          </div>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1 text-sm">
            {files.map((file) => {
              const isActive = activeFile?.path === file.path;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => onSelectFile(file.path)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${isActive ? 'bg-violet-100 text-violet-900 dark:bg-violet-600/30 dark:text-violet-100' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                  >
                    <div className="font-medium break-words">{file.path}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {file.encoding === 'base64' ? 'Binary (read-only)' : file.executable ? 'Executable' : 'Text'}
                    </div>
                  </button>
                </li>
              );
            })}
            {files.length === 0 && (
              <li className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                No files in bundle
              </li>
            )}
          </ul>
        </div>
        <div className="flex flex-col gap-4">
          {activeFile ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-violet-400"
                  value={activeFile.path}
                  onChange={(event) => onRenameFile(activeFile.path, event.target.value)}
                  disabled={activeFile.readOnly}
                />
                <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={activeFile.executable}
                    onChange={() => onToggleExecutable(activeFile.path)}
                    disabled={activeFile.readOnly}
                  />
                  Executable
                </label>
                <button
                  type="button"
                  className="rounded-full border border-red-300 px-3 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 dark:border-red-500 dark:text-red-300 dark:hover:bg-red-500/10"
                  onClick={() => onRemoveFile(activeFile.path)}
                >
                  Remove
                </button>
              </div>
              <Editor
                value={activeFile.contents}
                onChange={(value) => onChangeFile(activeFile.path, value)}
                language={activeFile.path.endsWith('.json') ? 'json' : activeFile.path.endsWith('.ts') || activeFile.path.endsWith('.tsx') ? 'typescript' : 'javascript'}
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

type BundleHistoryPanelProps = {
  bundle: BundleEditorData;
};

function BundleHistoryPanel({ bundle }: BundleHistoryPanelProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Version history</h3>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Recent publishes</h4>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {bundle.history.length === 0 && (
              <li className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                No regeneration events recorded.
              </li>
            )}
            {bundle.history.map((entry) => (
              <li key={`${entry.slug}@${entry.version}`} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="font-medium text-slate-700 dark:text-slate-200">
                  {entry.slug}@{entry.version}
                </div>
                <div className="text-xs text-slate-500 break-all dark:text-slate-400">
                  Checksum: {entry.checksum ?? 'n/a'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Regenerated: {formatDate(entry.regeneratedAt ?? null)}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Available versions</h4>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {bundle.availableVersions.map((version) => (
              <li key={version.version} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{version.version}</span>
                  <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {version.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 break-all dark:text-slate-400">Checksum: {version.checksum}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Published: {formatDate(version.publishedAt)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {bundle.aiBuilder && (
        <div className="mt-6">
          <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300">AI builder metadata</h4>
          <pre className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-700 whitespace-pre-wrap break-words dark:bg-slate-800 dark:text-slate-200">
            {JSON.stringify(bundle.aiBuilder, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

type JobRunsPanelProps = {
  detail: JobDetailResponse;
};

function JobRunsPanel({ detail }: JobRunsPanelProps) {
  const runs = detail.runs.slice(0, 8);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Recent runs</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">Showing {runs.length} of {detail.runs.length}</span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Run ID</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Started</th>
              <th className="px-3 py-2 text-left">Completed</th>
              <th className="px-3 py-2 text-left">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {runs.map((run) => {
              const started = run.startedAt ? new Date(run.startedAt).getTime() : null;
              const completed = run.completedAt ? new Date(run.completedAt).getTime() : null;
              const durationMs = started && completed ? completed - started : null;
              return (
                <tr key={run.id} className="bg-white dark:bg-slate-900">
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">{run.id}</td>
                  <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {run.status}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{formatDate(run.startedAt)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{formatDate(run.completedAt)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {durationMs !== null ? `${Math.round(durationMs / 1000)}s` : '—'}
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  No runs recorded for this job yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
