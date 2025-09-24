import { useEffect, useMemo, useState } from 'react';
import { Editor } from '../../components/Editor';
import { formatTimestamp } from '../../workflows/formatters';
import type { WorkflowAssetPartitionSummary } from '../../workflows/types';

const EMPTY_JSON_TEXT = '{\n}\n';

type AssetRecomputeDialogProps = {
  open: boolean;
  workflowSlug: string | null;
  assetId: string | null;
  partition: WorkflowAssetPartitionSummary | null;
  onClose: () => void;
  onSubmit: (input: {
    partitionKey: string | null;
    parameters: unknown;
    persistParameters: boolean;
  }) => Promise<void>;
  onClearStored?: (partitionKey: string | null) => Promise<void>;
};

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

function formatParameters(value: unknown): string {
  if (value === null || value === undefined) {
    return EMPTY_JSON_TEXT;
  }
  try {
    return `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    return EMPTY_JSON_TEXT;
  }
}

function parseParameters(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: {} };
  }
  try {
    const parsed = JSON.parse(text);
    return { ok: true, value: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON';
    return { ok: false, error: `Invalid JSON: ${message}` };
  }
}

function describeSource(source: string | null): string | null {
  if (!source) {
    return null;
  }
  switch (source) {
    case 'workflow-run':
      return 'Captured from workflow run';
    case 'manual':
      return 'Manually set';
    case 'system':
      return 'System default';
    default:
      return source;
  }
}

export function AssetRecomputeDialog({
  open,
  workflowSlug,
  assetId,
  partition,
  onClose,
  onSubmit,
  onClearStored
}: AssetRecomputeDialogProps) {
  const [parametersText, setParametersText] = useState(EMPTY_JSON_TEXT);
  const [persistParameters, setPersistParameters] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const partitionKey = partition?.partitionKey ?? null;

  useEffect(() => {
    if (!open || !partition) {
      return;
    }
    setParametersText(formatParameters(partition.parameters));
    setPersistParameters(Boolean(partition.parameters));
    setFormError(null);
  }, [open, partition]);

  const sourceDescription = useMemo(() => describeSource(partition?.parametersSource ?? null), [partition]);
  const updatedLabel = useMemo(
    () => (partition?.parametersUpdatedAt ? formatTimestamp(partition.parametersUpdatedAt) : null),
    [partition]
  );

  if (!open || !partition) {
    return null;
  }

  const handleClose = () => {
    if (submitting || clearing) {
      return;
    }
    onClose();
  };

  const handleSubmit = async () => {
    if (submitting) {
      return;
    }
    setFormError(null);
    const parsed = parseParameters(parametersText);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        partitionKey,
        parameters: parsed.value,
        persistParameters
      });
      setSubmitting(false);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to trigger run';
      setFormError(message);
      setSubmitting(false);
    }
  };

  const handleClearStored = async () => {
    if (!onClearStored || clearing) {
      return;
    }
    setFormError(null);
    setClearing(true);
    try {
      await onClearStored(partitionKey);
      setParametersText(EMPTY_JSON_TEXT);
      setPersistParameters(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear stored parameters';
      setFormError(message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 pt-10 backdrop-blur-sm overscroll-contain sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-2xl dark:border-slate-700/70 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200/60 bg-slate-50/60 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-900/60">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Trigger workflow run
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {workflowSlug ? `${workflowSlug} · ` : ''}
              {assetId ?? 'Unknown asset'} · Partition {partitionKey ?? 'default'}
            </p>
            {sourceDescription && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {sourceDescription}
                {updatedLabel ? ` · ${updatedLabel}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={handleClose}
          >
            Close
          </button>
        </header>

        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Workflow parameters
            </label>
            <Editor
              value={parametersText}
              onChange={(value) => setParametersText(value)}
              language="json"
              height={260}
              ariaLabel="Workflow run parameters JSON"
              className="rounded-2xl border border-slate-200/70 bg-white/80 dark:border-slate-700/60 dark:bg-slate-900/70"
            />
            {formError && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{formError}</p>
            )}
          </div>

          <label className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              checked={persistParameters}
              onChange={(event) => setPersistParameters(event.target.checked)}
            />
            <span>Save these parameters for future auto-materialized runs</span>
          </label>
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-200/60 bg-slate-50/60 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between">
          {onClearStored && partition.parameters ? (
            <button
              type="button"
              className="text-xs font-semibold text-slate-500 hover:text-rose-600 disabled:opacity-60 dark:text-slate-400 dark:hover:text-rose-400"
              onClick={handleClearStored}
              disabled={submitting || clearing}
            >
              {clearing ? 'Clearing…' : 'Clear stored parameters'}
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={handleClose}
              disabled={submitting || clearing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-60"
              onClick={handleSubmit}
              disabled={submitting || clearing}
            >
              {submitting ? 'Enqueuing…' : 'Trigger run'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default AssetRecomputeDialog;
