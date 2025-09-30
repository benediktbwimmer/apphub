import type { BundleEditorData } from '../api';
import { formatDate } from '../utils';

type BundleHistoryPanelProps = {
  bundle: BundleEditorData;
};

export function BundleHistoryPanel({ bundle }: BundleHistoryPanelProps) {
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
                <div className="break-all text-xs text-slate-500 dark:text-slate-400">
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
                <div className="break-all text-xs text-slate-500 dark:text-slate-400">Checksum: {version.checksum}</div>
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
          <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {JSON.stringify(bundle.aiBuilder, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
