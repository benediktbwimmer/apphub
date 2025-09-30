import type { BundleEditorData, JobDetailResponse } from '../api';
import { formatDate } from '../utils';

type JobSummaryCardProps = {
  detail: JobDetailResponse;
  bundle: BundleEditorData;
};

export function JobSummaryCard({ detail, bundle }: JobSummaryCardProps) {
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
          <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
            Type: {definition.type}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
            Runtime: {definition.runtime}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
            Version: {definition.version}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
            Bundle: {binding.slug}@{binding.version}
          </span>
        </div>
      </div>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="font-semibold text-slate-600 dark:text-slate-300">Entry point</dt>
          <dd className="break-words text-slate-700 dark:text-slate-200">{definition.entryPoint}</dd>
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
