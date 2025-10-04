import classNames from 'classnames';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { JobDefinitionSummary } from '../workflows/api';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { Spinner } from '../components';
import { useToasts } from '../components/toast';
import JobCreateDialog from './JobCreateDialog';
import JobAiEditDialog from './JobAiEditDialog';
import BundleVersionCompare from './BundleVersionCompare';
import {
  regenerateJobBundle,
  type BundleEditorData,
  type BundleRegenerateInput
} from './api';
import { useJobsList } from './hooks/useJobsList';
import { useRuntimeStatuses } from './hooks/useRuntimeStatuses';
import { useJobSnapshot } from './hooks/useJobSnapshot';
import { useBundleEditorState } from './hooks/useBundleEditorState';
import { JobsHeader } from './components/JobsHeader';
import { JobsSidebar } from './components/JobsSidebar';
import { JobSummaryCard } from './components/JobSummaryCard';
import { BundleEditorPanel } from './components/BundleEditorPanel';
import { BundleHistoryPanel } from './components/BundleHistoryPanel';
import { JobRunsPanel } from './components/JobRunsPanel';
import { normalizeCapabilityFlags } from './utils';
import { getStatusToneClasses } from '../theme/statusTokens';
import {
  JOB_CARD_CONTAINER_CLASSES,
  JOB_FORM_ERROR_TEXT_CLASSES,
  JOB_SECTION_PARAGRAPH_CLASSES
} from './jobTokens';

type RuntimeFilter = 'all' | 'module' | 'node' | 'python' | 'docker';

const RUNTIME_OPTIONS: Array<{ key: RuntimeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'module', label: 'Module' },
  { key: 'node', label: 'Node' },
  { key: 'python', label: 'Python' },
  { key: 'docker', label: 'Docker' }
];

export default function JobsPage() {
  const [searchParams] = useSearchParams();
  const initialJobSlug = searchParams.get('job');
  const initialJobSlugRef = useRef<string | null>(initialJobSlug);
  const authorizedFetch = useAuthorizedFetch();
  const { pushToast } = useToasts();

  const {
    sortedJobs,
    loading: jobsLoading,
    error: jobsError,
    refresh: refreshJobs
  } = useJobsList();

  const [jobSearch, setJobSearch] = useState(() => initialJobSlug ?? '');
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>('all');

  const {
    statuses: runtimeStatuses,
    loading: runtimeStatusLoading,
    error: runtimeStatusError,
    refresh: refreshRuntimeStatuses
  } = useRuntimeStatuses();

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const jobSnapshot = useJobSnapshot(selectedSlug);
  const bundleEditor = useBundleEditorState();

  const {
    state: editorState,
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
  } = bundleEditor;

  useEffect(() => {
    loadSnapshot(jobSnapshot.bundle ?? null);
  }, [loadSnapshot, jobSnapshot.bundle]);

  const filteredJobs = useMemo(() => {
    const normalizedSearch = jobSearch.trim().toLowerCase();
    return sortedJobs.filter((job) => {
      if (runtimeFilter !== 'all' && job.runtime !== runtimeFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return (
        job.name.toLowerCase().includes(normalizedSearch) ||
        job.slug.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [sortedJobs, jobSearch, runtimeFilter]);

  useEffect(() => {
    if (filteredJobs.length === 0) {
      setSelectedSlug(null);
      return;
    }
    setSelectedSlug((current) => {
      if (current && filteredJobs.some((job) => job.slug === current)) {
        return current;
      }
      return filteredJobs[0]?.slug ?? null;
    });
  }, [filteredJobs]);

  useEffect(() => {
    if (!initialJobSlugRef.current) {
      return;
    }
    const target = initialJobSlugRef.current;
    if (target && filteredJobs.some((job) => job.slug === target)) {
      setSelectedSlug(target);
      initialJobSlugRef.current = null;
    }
  }, [filteredJobs]);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createRuntime, setCreateRuntime] = useState<'node' | 'python'>('node');
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const pythonStatus = runtimeStatuses.find((status) => status.runtime === 'python');
  const pythonReady = pythonStatus ? pythonStatus.ready : true;
  const pythonButtonTitle = pythonReady
    ? undefined
    : pythonStatus?.reason ?? 'Python runtime is not ready';

  const currentJobForAi = jobSnapshot.detail
    ? {
        slug: jobSnapshot.detail.job.slug,
        name: jobSnapshot.detail.job.name,
        runtime: jobSnapshot.detail.job.runtime ?? null
      }
    : null;

  const currentBundleForAi = jobSnapshot.bundle
    ? {
        slug: jobSnapshot.bundle.binding.slug,
        version: jobSnapshot.bundle.bundle.version,
        entryPoint: jobSnapshot.bundle.editor.entryPoint
      }
    : null;

  const handleOpenCreate = (runtime: 'node' | 'python') => {
    setCreateRuntime(runtime);
    setCreateDialogOpen(true);
  };

  const handleJobCreated = (job: JobDefinitionSummary) => {
    pushToast({
      tone: 'success',
      title: 'Job created',
      description: `${job.name} registered successfully.`
    });
    setCreateDialogOpen(false);
    refreshJobs();
    setSelectedSlug(job.slug);
    refreshRuntimeStatuses();
  };

  const handleRegenerate = async () => {
    if (!jobSnapshot.bundle || !selectedSlug) {
      return;
    }

    let manifestValue: unknown = {};
    try {
      manifestValue = editorState.manifestText.trim().length
        ? JSON.parse(editorState.manifestText)
        : {};
      setManifestError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid manifest JSON';
      setManifestError(message);
      return;
    }

    const capabilityFlags = normalizeCapabilityFlags(editorState.capabilityFlagsInput);

    const payloadFiles = editorState.files.map((file) => {
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

    const versionValue = editorState.versionInput.trim();
    const payload: BundleRegenerateInput = {
      entryPoint: editorState.entryPoint,
      manifestPath: editorState.manifestPath.trim() || 'manifest.json',
      manifest: manifestValue,
      files: payloadFiles,
      capabilityFlags,
      metadata: jobSnapshot.bundle.bundle.metadata ?? undefined,
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
      loadSnapshot(response);
      setRegenerateSuccess(`Published ${response.binding.slug}@${response.bundle.version}`);
      refreshJobs();
      setShowDiff(false);
      setAiReviewPending(false);
      jobSnapshot.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate bundle';
      setRegenerateError(message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleOpenAiEdit = () => {
    if (!jobSnapshot.bundle || aiBusy) {
      return;
    }
    setRegenerateError(null);
    setRegenerateSuccess(null);
    setAiDialogOpen(true);
  };

  const handleAiEditComplete = (data: BundleEditorData) => {
    const hasChanges = applyAiUpdate(data);
    setManifestError(null);
    setVersionInput('');
    setRegenerateError(null);
    setRegenerateSuccess(null);
    if (hasChanges) {
      pushToast({
        tone: 'info',
        title: 'Review AI changes',
        description: 'Inspect the diff and regenerate to publish the new bundle.'
      });
    } else {
      pushToast({
        tone: 'info',
        title: 'No changes applied',
        description: 'The AI response matches the current bundle.'
      });
    }
  };

  const handleAiBusyChange = (busy: boolean) => {
    setAiBusy(busy);
  };

  const handleSelectJob = (slug: string) => {
    setSelectedSlug(slug);
  };

  const showLoading = jobSnapshot.detailLoading || jobSnapshot.bundleLoading;
  const showError = (jobSnapshot.detailError || jobSnapshot.bundleError) && !jobSnapshot.bundleLoading;

  return (
    <>
      <div className="flex flex-col gap-6">
        <JobsHeader
          runtimeStatuses={runtimeStatuses}
          runtimeStatusLoading={runtimeStatusLoading}
          runtimeStatusError={runtimeStatusError}
          pythonReady={pythonReady}
          pythonButtonTitle={pythonButtonTitle}
          onCreateNode={() => handleOpenCreate('node')}
          onCreatePython={() => handleOpenCreate('python')}
        />
        <div className="flex flex-col gap-6 lg:flex-row">
          <JobsSidebar
            jobs={sortedJobs}
            filteredJobs={filteredJobs}
            selectedSlug={selectedSlug}
            jobsLoading={jobsLoading}
            jobsError={jobsError}
            jobSearch={jobSearch}
            onJobSearchChange={setJobSearch}
            runtimeFilter={runtimeFilter}
            runtimeOptions={RUNTIME_OPTIONS}
            onRuntimeFilterChange={setRuntimeFilter}
            onSelectJob={handleSelectJob}
          />
          <section className="flex-1">
            {showLoading && (
              <div className={classNames(JOB_CARD_CONTAINER_CLASSES, 'flex items-center gap-3')}>
                <Spinner label="Loading job details…" />
                <span className={JOB_SECTION_PARAGRAPH_CLASSES}>Preparing selected job metadata…</span>
              </div>
            )}
            {showError && (
              <div className={classNames(JOB_CARD_CONTAINER_CLASSES, getStatusToneClasses('danger'))}>
                <p className={JOB_FORM_ERROR_TEXT_CLASSES}>{jobSnapshot.detailError ?? jobSnapshot.bundleError}</p>
              </div>
            )}
            {jobSnapshot.detail && jobSnapshot.bundle && !jobSnapshot.bundleLoading && (
              <div className="flex flex-col gap-6">
                <JobSummaryCard detail={jobSnapshot.detail} bundle={jobSnapshot.bundle} />
                <BundleEditorPanel
                  files={editorState.files}
                  activeFile={activeFile}
                  activePath={editorState.activePath}
                  onSelectFile={selectFile}
                  onChangeFile={updateFile}
                  onRenameFile={renameFile}
                  onToggleExecutable={toggleExecutable}
                  onRemoveFile={removeFile}
                  onAddFile={addFile}
                  entryPoint={editorState.entryPoint}
                  onEntryPointChange={setEntryPoint}
                  manifestPath={editorState.manifestPath}
                  onManifestPathChange={setManifestPath}
                  manifestText={editorState.manifestText}
                  onManifestTextChange={setManifestText}
                  manifestError={editorState.manifestError}
                  capabilityFlagsInput={editorState.capabilityFlagsInput}
                  onCapabilityFlagsChange={setCapabilityFlagsInput}
                  versionInput={editorState.versionInput}
                  onVersionInputChange={setVersionInput}
                  isDirty={isDirty}
                  onReset={resetToBaseline}
                  onOpenAiEdit={handleOpenAiEdit}
                  onRegenerate={handleRegenerate}
                  regenerating={editorState.regenerating}
                  regenerateError={editorState.regenerateError}
                  regenerateSuccess={editorState.regenerateSuccess}
                  aiBusy={aiBusy}
                  baselineFiles={baselineFiles}
                  showDiff={editorState.showDiff}
                  onShowDiffChange={setShowDiff}
                  aiReviewPending={editorState.aiReviewPending}
                />
                <BundleHistoryPanel bundle={jobSnapshot.bundle} />
                <BundleVersionCompare bundle={jobSnapshot.bundle} />
                <JobRunsPanel detail={jobSnapshot.detail} />
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
