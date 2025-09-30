import type { MetastoreRecordSummary } from '../types';
import classNames from 'classnames';
import { formatInstant } from '../utils';
import {
  METASTORE_META_TEXT_CLASSES,
  METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
  METASTORE_STATUS_ROW_TEXT_CLASSES,
  METASTORE_STATUS_TONE_CLASSES,
  METASTORE_CHIP_WARNING_CLASSES,
  METASTORE_TAG_BADGE_CLASSES,
  METASTORE_TABLE_BODY_CLASSES,
  METASTORE_TABLE_CONTAINER_CLASSES,
  METASTORE_TABLE_EMPTY_CLASSES,
  METASTORE_TABLE_ERROR_CONTAINER_CLASSES,
  METASTORE_TABLE_HEADER_CLASSES,
  METASTORE_TABLE_HEADER_META_CLASSES,
  METASTORE_TABLE_HEADER_TITLE_CLASSES,
  METASTORE_TABLE_REFRESH_BUTTON_CLASSES,
  METASTORE_TABLE_ROW_ACTIVE_CLASSES,
  METASTORE_TABLE_ROW_CLASSES,
  METASTORE_TABLE_ROW_INACTIVE_CLASSES
} from '../metastoreTokens';

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
    <div className={METASTORE_TABLE_CONTAINER_CLASSES}>
      <header className={METASTORE_TABLE_HEADER_CLASSES}>
        <div>
          <h2 className={METASTORE_TABLE_HEADER_TITLE_CLASSES}>Records</h2>
          <p className={METASTORE_TABLE_HEADER_META_CLASSES}>{total} total records</p>
        </div>
        <button type="button" onClick={onRetry} className={METASTORE_TABLE_REFRESH_BUTTON_CLASSES}>
          Refresh
        </button>
      </header>
      <div className={METASTORE_TABLE_BODY_CLASSES}>
        {loading ? (
          <div className={classNames('flex items-center justify-center px-5 py-6', METASTORE_META_TEXT_CLASSES)}>
            Loading records…
          </div>
        ) : error ? (
          <div className={METASTORE_TABLE_ERROR_CONTAINER_CLASSES}>
            <span>{error}</span>
            <button type="button" onClick={onRetry} className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}>
              Retry
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className={METASTORE_TABLE_EMPTY_CLASSES}>No records found.</div>
        ) : (
          <ul className="flex flex-col">
            {records.map((record) => {
              const isActive = record.id === selectedId;
              const isDeleted = Boolean(record.deletedAt);
              const tone = isDeleted ? 'danger' : 'neutral';
              return (
                <li key={record.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(record.id)}
                    className={classNames(
                      METASTORE_TABLE_ROW_CLASSES,
                      METASTORE_STATUS_TONE_CLASSES[tone === 'danger' ? 'error' : 'neutral'],
                      isActive ? METASTORE_TABLE_ROW_ACTIVE_CLASSES : METASTORE_TABLE_ROW_INACTIVE_CLASSES,
                      isDeleted ? 'opacity-70' : undefined
                    )}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-scale-sm font-weight-semibold text-primary">{record.recordKey}</span>
                      {isDeleted && (
                        <span className={METASTORE_CHIP_WARNING_CLASSES}>
                          Deleted
                        </span>
                      )}
                    </div>
                    <div className={classNames('flex w-full flex-wrap items-center justify-between gap-2', METASTORE_STATUS_ROW_TEXT_CLASSES)}>
                      <span>{record.namespace}</span>
                      <span>v{record.version}</span>
                      <span>{formatInstant(record.updatedAt)}</span>
                    </div>
                    {record.tags && record.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {record.tags.slice(0, 6).map((tag) => (
                          <span key={tag} className={METASTORE_TAG_BADGE_CLASSES}>
                            {tag}
                          </span>
                        ))}
                        {record.tags.length > 6 && (
                          <span className={METASTORE_META_TEXT_CLASSES}>+{record.tags.length - 6} more</span>
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
