import { useState } from 'react';
import Modal from '../../components/Modal';
import { useToastHelpers } from '../../components/toast';
import { prepareBulkPayload } from '../utils';
import type { BulkRequestPayload, BulkResponsePayload } from '../types';

interface BulkOperationsDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: BulkRequestPayload) => Promise<BulkResponsePayload>;
}

export function BulkOperationsDialog({ open, onClose, onSubmit }: BulkOperationsDialogProps) {
  const { showError, showSuccess } = useToastHelpers();
  const [input, setInput] = useState('');
  const [continueOnError, setContinueOnError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResponsePayload | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      const payload = prepareBulkPayload(input, continueOnError);
      const response = await onSubmit(payload);
      setResult(response);
      showSuccess('Bulk operations submitted', `${response.operations.length} operations processed.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit bulk operations';
      setError(message);
      showError('Bulk operations failed', err);
      setResult(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setResult(null);
    setInput('');
    setContinueOnError(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Bulk operations">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Provide an array of operations or a JSON payload with an <code className="font-mono">operations</code> property.
          Each operation supports <code className="font-mono">upsert</code> or <code className="font-mono">delete</code> semantics.
        </p>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={10}
          className="w-full rounded-2xl border border-slate-300/70 bg-white/80 px-3 py-2 font-mono text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
          placeholder='[{"namespace":"default","key":"example","metadata":{"foo":"bar"}}]'
        />
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={continueOnError}
            onChange={(event) => setContinueOnError(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
          Continue on error
        </label>
        {error && <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-slate-300/70 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Run bulk operations
          </button>
        </div>
        {result && (
          <div className="mt-2 space-y-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-sm dark:border-slate-700/60 dark:bg-slate-800/60">
            <h4 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Results</h4>
            <ul className="space-y-2">
              {result.operations.map((op, index) => (
                <li key={index} className="flex flex-col gap-1">
                  <span className={`text-sm font-semibold ${op.status === 'ok' ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600 dark:text-rose-300'}`}>
                    {op.status === 'ok' ? 'Success' : 'Error'} ({op.namespace ?? 'unknown'}/{op.key ?? ''})
                  </span>
                  {op.error && <span className="text-xs text-slate-500 dark:text-slate-400">{op.error.message}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Modal>
  );
}
