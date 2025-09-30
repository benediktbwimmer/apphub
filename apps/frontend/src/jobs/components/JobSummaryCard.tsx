import classNames from 'classnames';
import type { BundleEditorData, JobDetailResponse } from '../api';
import { formatDate } from '../utils';

const CARD_CONTAINER_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass p-6 shadow-elevation-md transition-colors';

const CARD_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

const CARD_SUBTITLE_CLASSES = 'text-scale-sm text-secondary';

const CARD_BADGE_BASE_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-muted px-3 py-1 text-scale-xs font-weight-semibold text-secondary';

const CARD_META_LABEL_CLASSES = 'text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted';

const CARD_META_VALUE_CLASSES = 'text-scale-sm text-primary';

type JobSummaryCardProps = {
  detail: JobDetailResponse;
  bundle: BundleEditorData;
};

export function JobSummaryCard({ detail, bundle }: JobSummaryCardProps) {
  const definition = detail.job;
  const binding = bundle.binding;
  return (
    <div className={CARD_CONTAINER_CLASSES}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className={CARD_TITLE_CLASSES}>
            {definition.name}
          </h2>
          <p className={CARD_SUBTITLE_CLASSES}>{definition.slug}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-scale-xs text-secondary">
          <span className={CARD_BADGE_BASE_CLASSES}>Type: {definition.type}</span>
          <span className={CARD_BADGE_BASE_CLASSES}>Runtime: {definition.runtime}</span>
          <span className={CARD_BADGE_BASE_CLASSES}>Version: {definition.version}</span>
          <span className={CARD_BADGE_BASE_CLASSES}>
            Bundle: {binding.slug}@{binding.version}
          </span>
        </div>
      </div>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className={CARD_META_LABEL_CLASSES}>Entry point</dt>
          <dd className={classNames('break-words', CARD_META_VALUE_CLASSES)}>{definition.entryPoint}</dd>
        </div>
        <div>
          <dt className={CARD_META_LABEL_CLASSES}>Timeout</dt>
          <dd className={CARD_META_VALUE_CLASSES}>
            {definition.timeoutMs ? `${Math.round(definition.timeoutMs / 1000)}s` : 'Default'}
          </dd>
        </div>
        <div>
          <dt className={CARD_META_LABEL_CLASSES}>Created</dt>
          <dd className={CARD_META_VALUE_CLASSES}>{formatDate(definition.createdAt)}</dd>
        </div>
        <div>
          <dt className={CARD_META_LABEL_CLASSES}>Updated</dt>
          <dd className={CARD_META_VALUE_CLASSES}>{formatDate(definition.updatedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}
