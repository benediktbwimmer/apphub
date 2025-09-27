import { useMemo } from 'react';
import type { DatasetRecord } from '../types';

interface DatasetListProps {
  datasets: DatasetRecord[];
  selectedId: string | null;
  onSelect: (datasetId: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function DatasetList({ datasets, selectedId, onSelect, loading, error, onRetry }: DatasetListProps) {
  const items = useMemo(() => datasets, [datasets]);

  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white/80 shadow-[0_25px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200/60 px-5 py-4 dark:border-slate-700/60">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Datasets</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Search across registered timestore datasets.</p>
        </div>
      </header>
      <div className="max-h-[520px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center px-5 py-6 text-sm text-slate-600 dark:text-slate-400">Loading datasets…</div>
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
        ) : items.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">No datasets found.</div>
        ) : (
          <ul className="flex flex-col">
            {items.map((dataset) => {
              const isActive = dataset.id === selectedId;
              return (
                <li key={dataset.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(dataset.id)}
                    className={`flex w-full flex-col items-start gap-1 border-b border-slate-200/50 px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-violet-500/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 ${
                      isActive
                        ? 'bg-violet-500/10 text-violet-700 dark:text-violet-200'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span className="text-sm font-semibold">
                      {dataset.displayName ?? dataset.name ?? dataset.slug}
                    </span>
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      {dataset.slug}
                    </span>
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
