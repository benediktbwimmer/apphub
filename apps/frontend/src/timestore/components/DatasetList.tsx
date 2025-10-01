import { useMemo } from 'react';
import type { DatasetRecord } from '../types';
import {
  PANEL_SURFACE_LARGE,
  SECONDARY_BUTTON_COMPACT,
  STATUS_BANNER_DANGER,
  STATUS_MESSAGE
} from '../timestoreTokens';

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
    <div className={`${PANEL_SURFACE_LARGE} shadow-[0_25px_70px_-45px_rgba(15,23,42,0.65)]`}>
      <header className="flex items-center justify-between gap-3 border-b border-subtle px-5 py-4">
        <div>
          <h2 className="text-scale-base font-weight-semibold text-primary">Datasets</h2>
          <p className={STATUS_MESSAGE}>Search across registered timestore datasets.</p>
        </div>
      </header>
      <div className="max-h-[520px] overflow-y-auto">
        {loading ? (
          <div className={`px-5 py-6 ${STATUS_MESSAGE}`}>Loading datasets…</div>
        ) : error ? (
          <div className="flex flex-col gap-3 px-5 py-6">
            <div className={STATUS_BANNER_DANGER}>{error}</div>
            <button type="button" onClick={onRetry} className={SECONDARY_BUTTON_COMPACT}>
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className={`px-5 py-6 ${STATUS_MESSAGE}`}>No datasets found.</div>
        ) : (
          <ul className="flex flex-col">
            {items.map((dataset) => {
              const isActive = dataset.id === selectedId;
              return (
                <li key={dataset.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(dataset.id)}
                    className={`flex w-full flex-col items-start gap-1 border-b border-subtle px-5 py-4 text-left transition-colors last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      isActive
                        ? 'bg-accent-soft text-accent'
                        : 'text-secondary hover:bg-surface-glass-soft'
                    }`}
                  >
                    <span className="text-scale-sm font-weight-semibold text-primary">
                      {dataset.displayName ?? dataset.name ?? dataset.slug}
                    </span>
                    <span className="text-scale-xs uppercase tracking-[0.2em] text-muted">
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
