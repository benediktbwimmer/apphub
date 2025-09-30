import type { BundleEditorData } from '../api';
import { formatDate } from '../utils';
import { getStatusToneClasses } from '../../theme/statusTokens';

const PANEL_CLASSES =
  'flex flex-col gap-4 rounded-2xl border border-subtle bg-surface-glass p-6 shadow-elevation-md transition-colors';

const SECTION_TITLE_CLASSES = 'text-scale-sm font-weight-semibold text-secondary';

const ITEM_CONTAINER_CLASSES = 'rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm shadow-elevation-md';

const EMPTY_ITEM_CLASSES =
  'rounded-lg border border-dashed border-subtle bg-surface-muted px-3 py-3 text-scale-xs text-muted';

const BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.25em]';

function buildStatusBadge(status: string): string {
  return `${BADGE_BASE} ${getStatusToneClasses(status)}`;
}

type BundleHistoryPanelProps = {
  bundle: BundleEditorData;
};

export function BundleHistoryPanel({ bundle }: BundleHistoryPanelProps) {
  return (
    <div className={PANEL_CLASSES}>
      <h3 className="text-scale-lg font-weight-semibold text-primary">Version history</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h4 className={SECTION_TITLE_CLASSES}>Recent publishes</h4>
          <ul className="flex flex-col gap-2">
            {bundle.history.length === 0 && (
              <li className={EMPTY_ITEM_CLASSES}>No regeneration events recorded.</li>
            )}
            {bundle.history.map((entry) => (
              <li key={`${entry.slug}@${entry.version}`} className={ITEM_CONTAINER_CLASSES}>
                <div className="font-weight-semibold text-primary">
                  {entry.slug}@{entry.version}
                </div>
                <div className="break-all text-scale-xs text-muted">Checksum: {entry.checksum ?? 'n/a'}</div>
                <div className="text-scale-xs text-muted">
                  Regenerated: {formatDate(entry.regeneratedAt ?? null)}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h4 className={SECTION_TITLE_CLASSES}>Available versions</h4>
          <ul className="flex flex-col gap-2">
            {bundle.availableVersions.map((version) => (
              <li key={version.version} className={ITEM_CONTAINER_CLASSES}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-weight-semibold text-primary">{version.version}</span>
                  <span className={buildStatusBadge(version.status)}>{version.status}</span>
                </div>
                <div className="break-all text-scale-xs text-muted">Checksum: {version.checksum}</div>
                <div className="text-scale-xs text-muted">Published: {formatDate(version.publishedAt)}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {bundle.aiBuilder && (
        <div className="mt-6 flex flex-col gap-2">
          <h4 className={SECTION_TITLE_CLASSES}>AI builder metadata</h4>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-subtle bg-surface-muted p-3 text-scale-xs text-secondary">
            {JSON.stringify(bundle.aiBuilder, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
