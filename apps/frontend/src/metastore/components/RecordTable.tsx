import type { MetastoreRecordSummary } from '../types';
import { formatInstant } from '../utils';

interface RecordTableProps {
  records: MetastoreRecordSummary[];
  selectedId: string | null;
  onSelect: (recordId: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  total: number;
}

export function RecordTable({ records, selectedId, onSelect, loading, error, onRetry, total }: RecordTableProps) {
  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white/80 shadow-[0_25px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200/60 px-5 py-4 dark:border-slate-700/60">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Records</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{total} total records</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
        >
          Refresh
        </button>
      </header>
      <div className="max-h-[520px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center px-5 py-6 text-sm text-slate-600 dark:text-slate-400">Loading records…</div>
        ) : error ? (
          <div className="flex flex-col gap-3 px-5 py-6 text-sm text-rose-600 dark:text-rose-300">
            <span>{error}</span>
            <button
              type="button"
              onClick={onRetry}
              className="self-start rounded-full border border-rose-400/60 px-3 py-1 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/10 dark:border-rose-400/40 dark:text-rose-200"
            >
              Retry
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">No records found.</div>
        ) : (
          <ul className="flex flex-col">
            {records.map((record) => {
              const isActive = record.id === selectedId;
              const isDeleted = Boolean(record.deletedAt);
              return (
                <li key={record.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(record.id)}
                    className={`flex w-full flex-col items-start gap-1 border-b border-slate-200/50 px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-violet-500/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 ${
                      isActive
                        ? 'bg-violet-500/10 text-violet-700 dark:text-violet-200'
                        : 'text-slate-700 dark:text-slate-200'
                    } ${isDeleted ? 'opacity-70' : ''}`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-sm font-semibold">{record.recordKey}</span>
                      {isDeleted && (
                        <span className="rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">
                          Deleted
                        </span>
                      )}
                    </div>
                    <div className="flex w-full flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      <span>{record.namespace}</span>
                      <span>v{record.version}</span>
                      <span>{formatInstant(record.updatedAt)}</span>
                    </div>
                    {record.tags && record.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {record.tags.slice(0, 6).map((tag) => (
                          <span key={tag} className="rounded-full bg-slate-200/60 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                            {tag}
                          </span>
                        ))}
                        {record.tags.length > 6 && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">+{record.tags.length - 6} more</span>
                        )}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
