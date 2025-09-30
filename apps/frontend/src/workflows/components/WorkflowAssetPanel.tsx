import { useCallback } from 'react';
import { Spinner } from '../../components';
import { formatDuration, formatTimestamp } from '../formatters';
import { getStatusToneClasses } from '../../theme/statusTokens';
import StatusBadge from './StatusBadge';
import type {
  WorkflowAssetDetail,
  WorkflowAssetInventoryEntry,
  WorkflowAssetPartitions,
  WorkflowAssetRoleDescriptor
} from '../types';

type WorkflowAssetPanelProps = {
  assets: WorkflowAssetInventoryEntry[];
  loading: boolean;
  error: string | null;
  selectedAssetId: string | null;
  onSelectAsset: (assetId: string) => void;
  onClearSelection: () => void;
  assetDetail: WorkflowAssetDetail | null;
  assetDetailLoading: boolean;
  assetDetailError: string | null;
  assetPartitions: WorkflowAssetPartitions | null;
  assetPartitionsLoading: boolean;
  assetPartitionsError: string | null;
  onRefreshAssetDetail: (assetId: string) => void;
};

function summarizePartitioning(partitioning: WorkflowAssetRoleDescriptor['partitioning']) {
  if (!partitioning) {
    return null;
  }
  if (partitioning.type === 'timeWindow') {
    const bits: string[] = [`Time window (${partitioning.granularity})`];
    if (partitioning.timezone) {
      bits.push(`TZ ${partitioning.timezone}`);
    }
    if (typeof partitioning.lookbackWindows === 'number' && partitioning.lookbackWindows > 0) {
      bits.push(`Lookback ${partitioning.lookbackWindows}`);
    }
    return bits.join(' • ');
  }
  if (partitioning.type === 'static') {
    return `Static (${partitioning.keys.length} keys)`;
  }
  if (partitioning.type === 'dynamic') {
    const bits: string[] = ['Dynamic'];
    if (typeof partitioning.maxKeys === 'number' && partitioning.maxKeys > 0) {
      bits.push(`max ${partitioning.maxKeys}`);
    }
    if (typeof partitioning.retentionDays === 'number' && partitioning.retentionDays > 0) {
      bits.push(`retention ${partitioning.retentionDays}d`);
    }
    return bits.join(' • ');
  }
  return null;
}

function buildRoleMetadataChips(role: WorkflowAssetRoleDescriptor) {
  const chips: string[] = [];
  const { freshness, autoMaterialize, partitioning } = role;
  if (freshness) {
    if (typeof freshness.ttlMs === 'number' && freshness.ttlMs > 0) {
      chips.push(`TTL ${formatDuration(freshness.ttlMs)}`);
    }
    if (typeof freshness.cadenceMs === 'number' && freshness.cadenceMs > 0) {
      chips.push(`Cadence ${formatDuration(freshness.cadenceMs)}`);
    }
    if (typeof freshness.maxAgeMs === 'number' && freshness.maxAgeMs > 0) {
      chips.push(`Max age ${formatDuration(freshness.maxAgeMs)}`);
    }
  }
  if (autoMaterialize) {
    if (autoMaterialize.onUpstreamUpdate) {
      chips.push('Auto on upstream update');
    }
    if (typeof autoMaterialize.priority === 'number') {
      chips.push(`Priority ${autoMaterialize.priority}`);
    }
  }
  const partitioningSummary = summarizePartitioning(partitioning);
  if (partitioningSummary) {
    chips.push(partitioningSummary);
  }
  return chips;
}

const PANEL_CONTAINER =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg backdrop-blur-md transition-colors';

const PANEL_TITLE = 'text-scale-lg font-weight-semibold text-primary';

const PANEL_SUBTEXT = 'text-scale-xs text-secondary';

const REFRESH_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const CLEAR_BUTTON_CLASSES =
  `${REFRESH_BUTTON_CLASSES} border-status-danger text-status-danger hover:border-status-danger hover:text-status-danger focus-visible:outline-status-danger`;

const ERROR_TEXT_CLASSES = 'mt-3 text-scale-sm font-weight-semibold text-status-danger';

const MESSAGE_TEXT_CLASSES = 'mt-3 text-scale-sm text-secondary';

const TABLE_WRAPPER_CLASSES = 'mt-4 overflow-hidden rounded-2xl border border-subtle';

const TABLE_CLASSES = 'min-w-full divide-y divide-subtle text-scale-sm';

const TABLE_HEAD_CLASSES = 'bg-surface-muted';

const TABLE_HEAD_CELL_CLASSES =
  'px-4 py-3 text-left text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted';

const TABLE_BODY_CLASSES = 'divide-y divide-subtle';

const TABLE_CELL_CLASSES = 'px-4 py-3 text-scale-sm text-secondary';

const TABLE_CELL_EMPHASIS = `${TABLE_CELL_CLASSES} font-weight-semibold text-primary`;

const TABLE_META_TEXT = 'text-scale-xs text-muted';

const TABLE_ROW_BASE = 'cursor-pointer transition-colors hover:bg-surface-glass-soft';

const TABLE_ROW_SELECTED = 'bg-accent-soft shadow-elevation-sm';

const SECTION_HEADING = 'text-scale-sm font-weight-semibold text-primary';

const DETAIL_CARD_CONTAINER =
  'mt-6 rounded-2xl border border-subtle bg-surface-glass p-5 shadow-elevation-md transition-colors';

const DETAIL_MESSAGE_TEXT = 'mt-2 text-scale-sm text-secondary';

const ROLE_GROUP_LIST = 'space-y-2';

const ROLE_LIST_EMPTY_TEXT = 'text-scale-sm text-secondary';

const ROLE_CARD =
  'inline-flex min-w-[200px] max-w-full flex-col gap-2 rounded-2xl border border-subtle bg-surface-muted px-3 py-2 text-scale-xs font-weight-medium text-secondary';

const ROLE_CARD_TITLE = 'font-weight-semibold text-primary';

const ROLE_CARD_META = 'uppercase tracking-[0.3em] text-muted';

const ROLE_METADATA_CHIP =
  'inline-flex items-center rounded-full border border-subtle bg-surface-glass px-2 py-[2px] text-[10px] font-weight-semibold uppercase tracking-[0.25em] text-secondary';

const DETAIL_TABLE_WRAPPER = 'overflow-hidden rounded-xl border border-subtle';

const DETAIL_TABLE_ROW_HIGHLIGHT = 'bg-status-warning-soft';

const STALE_BADGE_BASE =
  'inline-flex w-fit items-center rounded-full border px-2 py-[2px] text-[11px] font-weight-semibold uppercase tracking-[0.25em]';

const STATUS_META_TEXT = 'text-scale-xs text-muted';

const PARTITION_SECTION_DIVIDER = 'mt-4 border-t border-subtle pt-4';

function renderRoleList(label: string, roles: WorkflowAssetRoleDescriptor[]) {
  if (roles.length === 0) {
    return (
      <li className={ROLE_LIST_EMPTY_TEXT}>
        {label}: none declared
      </li>
    );
  }
  return (
    <li className="text-scale-sm text-secondary">
      <span className="font-weight-semibold text-primary">{label}:</span>
      <ul className="mt-1 flex flex-wrap gap-2 pl-0">
        {roles.map((role) => {
          const metadataChips = buildRoleMetadataChips(role);
          return (
            <li
              key={`${role.stepId}-${role.stepType}`}
              className={ROLE_CARD}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={ROLE_CARD_TITLE}>{role.stepName}</span>
                <span className={ROLE_CARD_META}>{role.stepType}</span>
              </div>
              {metadataChips.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {metadataChips.map((chip) => (
                    <span
                      key={`${role.stepId}-${chip}`}
                      className={ROLE_METADATA_CHIP}
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

export default function WorkflowAssetPanel({
  assets,
  loading,
  error,
  selectedAssetId,
  onSelectAsset,
  onClearSelection,
  assetDetail,
  assetDetailLoading,
  assetDetailError,
  assetPartitions,
  assetPartitionsLoading,
  assetPartitionsError,
  onRefreshAssetDetail
}: WorkflowAssetPanelProps) {
  const hasAssets = assets.length > 0;
  const hasSelection = Boolean(selectedAssetId);
  const handleRefreshAssetDetail = useCallback(() => {
    if (!selectedAssetId) {
      return;
    }
    onRefreshAssetDetail(selectedAssetId);
  }, [onRefreshAssetDetail, selectedAssetId]);

  return (
    <section className={PANEL_CONTAINER}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className={PANEL_TITLE}>Asset Inventory</h2>
          <p className={PANEL_SUBTEXT}>
            Discover the producers, consumers, and freshness of workflow data assets.
          </p>
        </div>
        {hasSelection && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={REFRESH_BUTTON_CLASSES}
              onClick={handleRefreshAssetDetail}
            >
              Refresh history
            </button>
            <button
              type="button"
              className={CLEAR_BUTTON_CLASSES}
              onClick={onClearSelection}
            >
              Clear selection
            </button>
          </div>
        )}
      </div>

      {error && <p className={ERROR_TEXT_CLASSES}>{error}</p>}

      {loading && (
        <p className={MESSAGE_TEXT_CLASSES}>
          <Spinner label="Loading assets…" size="xs" />
        </p>
      )}

      {!loading && !error && !hasAssets && (
        <p className={MESSAGE_TEXT_CLASSES}>No assets declared for this workflow.</p>
      )}

      {!loading && !error && hasAssets && (
        <div className={TABLE_WRAPPER_CLASSES}>
          <table className={TABLE_CLASSES}>
            <thead className={TABLE_HEAD_CLASSES}>
              <tr>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Asset
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Producers
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Consumers
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Partition
                </th>
                <th className={TABLE_HEAD_CELL_CLASSES}>
                  Latest Snapshot
                </th>
              </tr>
            </thead>
            <tbody className={TABLE_BODY_CLASSES}>
              {assets.map((asset) => {
                const isSelected = asset.assetId === selectedAssetId;
                const latest = asset.latest;
                return (
                  <tr
                    key={asset.assetId}
                    className={`${TABLE_ROW_BASE} ${isSelected ? TABLE_ROW_SELECTED : ''}`}
                    onClick={() => onSelectAsset(asset.assetId)}
                  >
                    <td className={TABLE_CELL_EMPHASIS}>
                      {asset.assetId}
                    </td>
                    <td className={TABLE_CELL_CLASSES}>
                      {asset.producers.length > 0 ? asset.producers.map((role) => role.stepName).join(', ') : '—'}
                    </td>
                    <td className={TABLE_CELL_CLASSES}>
                      {asset.consumers.length > 0 ? asset.consumers.map((role) => role.stepName).join(', ') : '—'}
                    </td>
                    <td className={TABLE_CELL_CLASSES}>
                      {latest?.partitionKey ?? '—'}
                    </td>
                    <td className={TABLE_CELL_CLASSES}>
                      {latest ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={latest.runStatus} />
                            <span className={TABLE_META_TEXT}>{latest.stepName}</span>
                          </div>
                          <span className={TABLE_META_TEXT}>
                            Produced {formatTimestamp(latest.producedAt)}
                          </span>
                        </div>
                      ) : (
                        <span className={TABLE_META_TEXT}>No runs yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasSelection && (
        <div className={DETAIL_CARD_CONTAINER}>
          <h3 className={SECTION_HEADING}>Asset history · {selectedAssetId}</h3>
          {assetDetailError && (
            <p className="mt-2 text-scale-sm font-weight-semibold text-status-danger">{assetDetailError}</p>
          )}
          {assetDetailLoading && (
            <p className={DETAIL_MESSAGE_TEXT}>
              <Spinner label="Loading history…" size="xs" />
            </p>
          )}
          {!assetDetailLoading && !assetDetailError && assetDetail && (
            <div className="mt-3 space-y-4">
              <ul className={ROLE_GROUP_LIST}>
                {renderRoleList('Producers', assetDetail.producers)}
                {renderRoleList('Consumers', assetDetail.consumers)}
              </ul>

              {assetDetail.history.length === 0 ? (
                <p className="text-scale-sm text-secondary">No production history yet.</p>
              ) : (
                <div className={DETAIL_TABLE_WRAPPER}>
                  <table className={TABLE_CLASSES}>
                    <thead className={TABLE_HEAD_CLASSES}>
                      <tr>
                        <th className={TABLE_HEAD_CELL_CLASSES}>
                          Produced
                        </th>
                        <th className={TABLE_HEAD_CELL_CLASSES}>
                          Run Status
                        </th>
                        <th className={TABLE_HEAD_CELL_CLASSES}>
                          Step
                        </th>
                        <th className={TABLE_HEAD_CELL_CLASSES}>
                          Partition
                        </th>
                        <th className={TABLE_HEAD_CELL_CLASSES}>
                          Step Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className={TABLE_BODY_CLASSES}>
                      {assetDetail.history.map((entry) => (
                        <tr key={`${entry.runId}-${entry.stepId}-${entry.producedAt}`}>
                          <td className={TABLE_CELL_CLASSES}>
                            {formatTimestamp(entry.producedAt)}
                          </td>
                          <td className={TABLE_CELL_CLASSES}>
                            <StatusBadge status={entry.runStatus} />
                          </td>
                          <td className={TABLE_CELL_CLASSES}>
                            {entry.stepName}
                          </td>
                          <td className={TABLE_CELL_CLASSES}>
                            {entry.partitionKey ?? '—'}
                          </td>
                          <td className={TABLE_CELL_CLASSES}>
                            {entry.stepStatus}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className={PARTITION_SECTION_DIVIDER}>
            <h4 className="text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted">
              Partitions
            </h4>
            {assetPartitionsError && (
              <p className="mt-2 text-scale-sm font-weight-semibold text-status-danger">{assetPartitionsError}</p>
            )}
            {assetPartitionsLoading && (
              <p className={DETAIL_MESSAGE_TEXT}>
                <Spinner label="Loading partitions…" size="xs" />
              </p>
            )}
            {!assetPartitionsLoading && !assetPartitionsError && assetPartitions && (
              <div className="mt-3 space-y-3">
                <p className={STATUS_META_TEXT}>
                  {summarizePartitioning(assetPartitions.partitioning) ?? 'No partitioning declared.'}
                </p>
                {assetPartitions.partitions.length === 0 ? (
                  <p className="text-scale-sm text-secondary">
                    No partition materializations yet.
                  </p>
                ) : (
                  <div className={DETAIL_TABLE_WRAPPER}>
                    <table className={TABLE_CLASSES}>
                      <thead className={TABLE_HEAD_CLASSES}>
                        <tr>
                          <th className={TABLE_HEAD_CELL_CLASSES}>
                            Partition
                          </th>
                          <th className={TABLE_HEAD_CELL_CLASSES}>
                            Status
                          </th>
                          <th className={TABLE_HEAD_CELL_CLASSES}>
                            Materializations
                          </th>
                          <th className={TABLE_HEAD_CELL_CLASSES}>
                            Latest Run
                          </th>
                          <th className={TABLE_HEAD_CELL_CLASSES}>
                            Produced
                          </th>
                        </tr>
                      </thead>
                      <tbody className={TABLE_BODY_CLASSES}>
                        {assetPartitions.partitions.map((partition) => (
                          <tr
                            key={partition.partitionKey ?? 'default'}
                            className={partition.isStale ? DETAIL_TABLE_ROW_HIGHLIGHT : undefined}
                          >
                            <td className={TABLE_CELL_CLASSES}>
                              {partition.partitionKey ?? '—'}
                            </td>
                            <td className={TABLE_CELL_CLASSES}>
                              {partition.isStale ? (
                                <div className="flex flex-col gap-1">
                                  <span
                                    className={`${STALE_BADGE_BASE} ${getStatusToneClasses('warning')}`}
                                  >
                                    Stale
                                  </span>
                                  {partition.staleMetadata && (
                                    <span className={STATUS_META_TEXT}>
                                      Since {formatTimestamp(partition.staleMetadata.requestedAt)}
                                      {partition.staleMetadata.note
                                        ? ` · ${partition.staleMetadata.note}`
                                        : partition.staleMetadata.requestedBy
                                        ? ` · ${partition.staleMetadata.requestedBy}`
                                        : ''}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className={STATUS_META_TEXT}>Fresh</span>
                              )}
                            </td>
                            <td className={TABLE_CELL_CLASSES}>
                              {partition.materializations}
                            </td>
                            <td className={TABLE_CELL_CLASSES}>
                              {partition.latest ? (
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <StatusBadge status={partition.latest.runStatus} />
                                    <span className={STATUS_META_TEXT}>
                                      {partition.latest.stepName}
                                    </span>
                                  </div>
                                  <span className={STATUS_META_TEXT}>
                                    Step {partition.latest.stepStatus}
                                  </span>
                                </div>
                              ) : (
                                <span className={STATUS_META_TEXT}>No runs yet</span>
                              )}
                            </td>
                            <td className={TABLE_CELL_CLASSES}>
                              {partition.latest ? formatTimestamp(partition.latest.producedAt) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {!assetPartitionsLoading && !assetPartitionsError && !assetPartitions && (
              <p className={DETAIL_MESSAGE_TEXT}>
                This asset has no recorded partition metadata.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
