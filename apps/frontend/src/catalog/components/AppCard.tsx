import { API_BASE_URL } from '../constants';
import {
  formatBytes,
  formatDuration,
  formatNormalizedScore,
  formatScore,
  highlightSegments
} from '../utils';
import type { AppRecord, BuildTimelineState, HistoryState, LaunchListState, TagKV } from '../types';

type AppCardProps = {
  app: AppRecord;
  activeTokens: string[];
  highlightEnabled: boolean;
  retryingId: string | null;
  onRetry: (id: string) => void;
  historyEntry?: HistoryState[string];
  onToggleHistory: (id: string) => void;
  buildEntry?: BuildTimelineState;
  onToggleBuilds: (id: string) => void;
  onLoadMoreBuilds: (id: string) => void;
  onToggleLogs: (appId: string, buildId: string) => void;
  onRetryBuild: (appId: string, buildId: string) => void;
  launchEntry?: LaunchListState[string];
  onToggleLaunches: (id: string) => void;
  onLaunch: (id: string) => void;
  onStopLaunch: (appId: string, launchId: string) => void;
  launchingId: string | null;
  stoppingLaunchId: string | null;
  launchErrors: Record<string, string | null>;
};

function TagList({ tags, activeTokens, highlightEnabled }: { tags: TagKV[]; activeTokens: string[]; highlightEnabled: boolean }) {
  return (
    <div className="tag-row">
      {tags.map((tag) => (
        <span key={`${tag.key}:${tag.value}`} className="tag-chip">
          <span className="tag-key">{highlightSegments(tag.key, activeTokens, highlightEnabled)}</span>
          <span className="tag-separator">:</span>
          <span>{highlightSegments(tag.value, activeTokens, highlightEnabled)}</span>
        </span>
      ))}
    </div>
  );
}

function BuildSummarySection({ build }: { build: AppRecord['latestBuild'] }) {
  if (!build) {
    return (
      <div className="build-section build-section-empty">
        <span className="status-badge status-pending">build pending</span>
        <span className="build-note">Awaiting first build run.</span>
      </div>
    );
  }

  const statusClass =
    build.status === 'succeeded'
      ? 'status-succeeded'
      : build.status === 'failed'
      ? 'status-failed'
      : build.status === 'running'
      ? 'status-processing'
      : 'status-pending';

  const updatedAt = build.completedAt ?? build.startedAt ?? build.updatedAt;

  return (
    <div className="build-section">
      <div className="build-head">
        <span className={`status-badge ${statusClass}`}>build {build.status}</span>
        {updatedAt && <time dateTime={updatedAt}>Updated {new Date(updatedAt).toLocaleString()}</time>}
        {build.imageTag && <code className="build-image-tag">{build.imageTag}</code>}
      </div>
      {build.errorMessage && <p className="build-error">{build.errorMessage}</p>}
      {build.status === 'pending' && <span className="build-note">Waiting for build worker…</span>}
      {build.status === 'running' && <span className="build-note">Docker build in progress…</span>}
      {build.logsPreview && (
        <pre className="build-logs">
          {build.logsPreview}
          {build.logsTruncated ? '\n…' : ''}
        </pre>
      )}
    </div>
  );
}

function LaunchSummarySection({
  app,
  activeTokens,
  highlightEnabled,
  launchingId,
  stoppingLaunchId,
  onLaunch,
  onStop,
  launchErrors
}: {
  app: AppRecord;
  activeTokens: string[];
  highlightEnabled: boolean;
  launchingId: string | null;
  stoppingLaunchId: string | null;
  onLaunch: (id: string) => void;
  onStop: (appId: string, launchId: string) => void;
  launchErrors: Record<string, string | null>;
}) {
  const launch = app.latestLaunch;
  const statusClass = launch
    ? launch.status === 'running'
      ? 'status-succeeded'
      : launch.status === 'failed'
      ? 'status-failed'
      : launch.status === 'starting' || launch.status === 'stopping'
      ? 'status-processing'
      : 'status-pending'
    : 'status-pending';
  const updatedAt = launch?.updatedAt ?? null;
  const isLaunching = launchingId === app.id;
  const isStopping = launch ? stoppingLaunchId === launch.id : false;
  const canLaunch = app.latestBuild?.status === 'succeeded';
  const canStop = launch ? ['running', 'starting', 'stopping'].includes(launch.status) : false;
  const launchError = launchErrors[app.id] ?? null;

  return (
    <div className={`launch-section${launch ? '' : ' launch-section-empty'}`}>
      <div className="launch-head">
        <span className={`status-badge ${statusClass}`}>
          {launch ? `launch ${launch.status}` : 'launch pending'}
        </span>
        {updatedAt && <time dateTime={updatedAt}>Updated {new Date(updatedAt).toLocaleString()}</time>}
        {launch?.instanceUrl && (
          <a className="launch-preview-link" href={launch.instanceUrl} target="_blank" rel="noreferrer">
            Preview
          </a>
        )}
      </div>
      {(launchError || launch?.errorMessage) && (
        <p className="launch-error">
          {highlightSegments(launchError ?? launch?.errorMessage ?? '', activeTokens, highlightEnabled)}
        </p>
      )}
      {!canLaunch && <p className="launch-note">Launch requires a successful build.</p>}
      {launch?.status === 'starting' && <p className="launch-note">Container starting…</p>}
      {launch?.status === 'stopping' && <p className="launch-note">Stopping container…</p>}
      {launch?.status === 'stopped' && <p className="launch-note">Last launch has ended.</p>}
      <div className="launch-actions">
        <button
          type="button"
          className="launch-button"
          onClick={() => onLaunch(app.id)}
          disabled={isLaunching || !canLaunch || canStop}
        >
          {isLaunching ? 'Launching…' : 'Launch app'}
        </button>
        <button
          type="button"
          className="launch-button secondary"
          onClick={() => {
            if (launch) {
              onStop(app.id, launch.id);
            }
          }}
          disabled={!launch || !canStop || isStopping}
        >
          {isStopping ? 'Stopping…' : 'Stop launch'}
        </button>
      </div>
      {launch?.instanceUrl && (
        <div className="launch-preview-row">
          <span>Preview URL:</span>
          <a href={launch.instanceUrl} target="_blank" rel="noreferrer">
            {launch.instanceUrl}
          </a>
        </div>
      )}
      {launch?.resourceProfile && <div className="launch-note">Profile: {launch.resourceProfile}</div>}
    </div>
  );
}

function BuildTimeline({
  appId,
  entry,
  onToggleLogs,
  onRetryBuild,
  onLoadMore
}: {
  appId: string;
  entry?: BuildTimelineState;
  onToggleLogs: (appId: string, buildId: string) => void;
  onRetryBuild: (appId: string, buildId: string) => void;
  onLoadMore: (appId: string) => void;
}) {
  if (!entry) {
    return null;
  }

  const builds = entry.builds ?? [];

  return (
    <div className="build-timeline">
      {entry.loading && <div className="build-status">Loading builds…</div>}
      {entry.error && !entry.loading && <div className="build-status error">{entry.error}</div>}
      {!entry.loading && !entry.error && builds.length === 0 && (
        <div className="build-status">No builds recorded yet.</div>
      )}
      {builds.map((build) => {
        const logState = entry.logs[build.id];
        const logOpen = logState?.open ?? false;
        const logLoading = logState?.loading ?? false;
        const logError = logState?.error ?? null;
        const logSize = logState?.size ?? build.logsSize;
        const logUpdatedAt = logState?.updatedAt ?? null;
        const isRetryingBuild = entry.retrying?.[build.id] ?? false;
        const completedAt = build.completedAt ?? build.startedAt ?? build.updatedAt;
        const durationLabel = formatDuration(build.durationMs);
        const downloadUrl = `${API_BASE_URL}/builds/${build.id}/logs?download=1`;
        return (
          <div key={build.id} className="build-timeline-item">
            <div className="build-timeline-header">
              <span className={`status-badge status-${build.status}`}>build {build.status}</span>
              {build.commitSha && <code className="build-commit">{build.commitSha.slice(0, 10)}</code>}
              {completedAt && <time dateTime={completedAt}>{new Date(completedAt).toLocaleString()}</time>}
              {durationLabel && <span className="build-duration">{durationLabel}</span>}
              {build.imageTag && <code className="build-image-tag">{build.imageTag}</code>}
            </div>
            {build.errorMessage && <p className="build-error">{build.errorMessage}</p>}
            {build.logsPreview && (
              <pre className="build-logs-preview">
                {build.logsPreview}
                {build.logsTruncated ? '\n…' : ''}
              </pre>
            )}
            <div className="build-timeline-actions">
              <button type="button" className="log-toggle" onClick={() => onToggleLogs(appId, build.id)}>
                {logOpen ? 'Hide logs' : 'View logs'}
              </button>
              <a className="log-download" href={downloadUrl} target="_blank" rel="noreferrer">
                Download logs
              </a>
              {build.status === 'failed' && (
                <button
                  type="button"
                  className="retry-button"
                  disabled={isRetryingBuild}
                  onClick={() => onRetryBuild(appId, build.id)}
                >
                  {isRetryingBuild ? 'Retrying…' : 'Retry build'}
                </button>
              )}
            </div>
            {logOpen && (
              <div className="build-log-viewer">
                {logLoading && <div className="build-log-status">Loading logs…</div>}
                {logError && !logLoading && <div className="build-log-status error">{logError}</div>}
                {!logLoading && !logError && (
                  <>
                    <div className="build-log-meta">
                      <span>Size {formatBytes(logSize)}</span>
                      {logUpdatedAt && (
                        <time dateTime={logUpdatedAt}>Updated {new Date(logUpdatedAt).toLocaleString()}</time>
                      )}
                    </div>
                    <pre className="build-log-output">{logState?.content ?? 'No logs available yet.'}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {entry.meta?.hasMore && (
        <button
          type="button"
          className="build-load-more"
          onClick={() => onLoadMore(appId)}
          disabled={entry.loadingMore}
        >
          {entry.loadingMore ? 'Loading…' : 'Load more builds'}
        </button>
      )}
    </div>
  );
}

function LaunchTimeline({
  entry,
  activeTokens,
  highlightEnabled
}: {
  entry?: LaunchListState[string];
  activeTokens: string[];
  highlightEnabled: boolean;
}) {
  if (!entry) {
    return null;
  }

  const launches = entry.launches ?? [];

  return (
    <div className="launch-history">
      {entry.loading && <div className="launch-status">Loading launches…</div>}
      {entry.error && <div className="launch-status error">{entry.error}</div>}
      {!entry.loading && !entry.error && launches.length === 0 && (
        <div className="launch-status">No launches recorded yet.</div>
      )}
      {launches.length > 0 && (
        <ul className="launch-list">
          {launches.map((launchItem) => {
            const timestamp = launchItem.updatedAt ?? launchItem.createdAt;
            return (
              <li key={launchItem.id}>
                <div className="launch-row">
                  <span className={`launch-status-pill status-${launchItem.status}`}>{launchItem.status}</span>
                  <time dateTime={timestamp}>{new Date(timestamp).toLocaleString()}</time>
                  <code className="launch-build">{launchItem.buildId.slice(0, 8)}</code>
                </div>
                <div className="launch-detail">
                  {launchItem.instanceUrl && (
                    <a href={launchItem.instanceUrl} target="_blank" rel="noreferrer" className="launch-preview-link">
                      Open preview
                    </a>
                  )}
                  {launchItem.errorMessage && (
                    <div className="launch-error-text">
                      {highlightSegments(launchItem.errorMessage, activeTokens, highlightEnabled)}
                    </div>
                  )}
                  {launchItem.resourceProfile && <span className="launch-profile">{launchItem.resourceProfile}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HistoryTimeline({ entry }: { entry?: HistoryState[string] }) {
  if (!entry) {
    return null;
  }

  const events = entry.events ?? [];

  return (
    <div className="history-section">
      {entry.loading && <div className="history-status">Loading history…</div>}
      {entry.error && <div className="history-status error">{entry.error}</div>}
      {!entry.loading && !entry.error && events.length === 0 && (
        <div className="history-status">No events recorded yet.</div>
      )}
      {events.length > 0 && (
        <ul className="history-list">
          {events.map((event) => (
            <li key={event.id}>
              <div className="history-row">
                <span className={`history-status-pill status-${event.status}`}>{event.status}</span>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
              </div>
              <div className="history-detail">
                <div className="history-message">{event.message ?? 'No additional message'}</div>
                <div className="history-meta">
                  {event.attempt !== null && <span className="history-attempt">Attempt {event.attempt}</span>}
                  {typeof event.durationMs === 'number' && (
                    <span className="history-duration">{`${Math.max(event.durationMs, 0)} ms`}</span>
                  )}
                  {event.commitSha && <code className="history-commit">{event.commitSha.slice(0, 10)}</code>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AppCard({
  app,
  activeTokens,
  highlightEnabled,
  retryingId,
  onRetry,
  historyEntry,
  onToggleHistory,
  buildEntry,
  onToggleBuilds,
  onLoadMoreBuilds,
  onToggleLogs,
  onRetryBuild,
  launchEntry,
  onToggleLaunches,
  onLaunch,
  onStopLaunch,
  launchingId,
  stoppingLaunchId,
  launchErrors
}: AppCardProps) {
  const showHistory = historyEntry?.open ?? false;
  const showBuilds = buildEntry?.open ?? false;
  const showLaunches = launchEntry?.open ?? false;

  return (
    <article className="app-card">
      <div className="app-card-header">
        <h2>{highlightSegments(app.name, activeTokens, highlightEnabled)}</h2>
        <div className="app-card-meta">
          <span className={`status-badge status-${app.ingestStatus}`}>{app.ingestStatus}</span>
          <time dateTime={app.updatedAt}>Updated {new Date(app.updatedAt).toLocaleDateString()}</time>
          <span className="attempts-pill">Attempts {app.ingestAttempts}</span>
        </div>
        {app.relevance && (
          <div className="relevance-panel">
            <div className="relevance-score-row">
              <span className="relevance-score">Score {formatScore(app.relevance.score)}</span>
              <span className="relevance-score secondary">
                Normalized {formatNormalizedScore(app.relevance.normalizedScore)}
              </span>
            </div>
            <div className="relevance-breakdown">
              <span
                title={`${app.relevance.components.name.hits} name hits × ${app.relevance.components.name.weight}`}
              >
                Name {formatScore(app.relevance.components.name.score)}
              </span>
              <span
                title={`${app.relevance.components.description.hits} description hits × ${app.relevance.components.description.weight}`}
              >
                Description {formatScore(app.relevance.components.description.score)}
              </span>
              <span
                title={`${app.relevance.components.tags.hits} tag hits × ${app.relevance.components.tags.weight}`}
              >
                Tags {formatScore(app.relevance.components.tags.score)}
              </span>
            </div>
          </div>
        )}
      </div>
      <p className="app-description">
        {highlightSegments(app.description, activeTokens, highlightEnabled)}
      </p>
      {app.ingestError && (
        <p className="ingest-error">
          {highlightSegments(app.ingestError, activeTokens, highlightEnabled)}
        </p>
      )}
      <TagList tags={app.tags} activeTokens={activeTokens} highlightEnabled={highlightEnabled} />
      <BuildSummarySection build={app.latestBuild} />
      <LaunchSummarySection
        app={app}
        activeTokens={activeTokens}
        highlightEnabled={highlightEnabled}
        launchingId={launchingId}
        stoppingLaunchId={stoppingLaunchId}
        onLaunch={onLaunch}
        onStop={onStopLaunch}
        launchErrors={launchErrors}
      />
      <div className="app-links">
        <a href={app.repoUrl} target="_blank" rel="noreferrer">
          View repository
        </a>
        <code>{highlightSegments(app.dockerfilePath, activeTokens, highlightEnabled)}</code>
        {app.ingestStatus === 'failed' && (
          <button
            type="button"
            className="retry-button"
            disabled={retryingId === app.id}
            onClick={() => onRetry(app.id)}
          >
            {retryingId === app.id ? 'Retrying…' : 'Retry ingest'}
          </button>
        )}
        <button type="button" className="timeline-button" onClick={() => onToggleBuilds(app.id)}>
          {showBuilds ? 'Hide builds' : 'View builds'}
        </button>
        <button type="button" className="history-button" onClick={() => onToggleLaunches(app.id)}>
          {showLaunches ? 'Hide launches' : 'View launches'}
        </button>
        <button type="button" className="history-button" onClick={() => onToggleHistory(app.id)}>
          {showHistory ? 'Hide history' : 'View history'}
        </button>
      </div>
      {showBuilds && (
        <BuildTimeline
          appId={app.id}
          entry={buildEntry}
          onToggleLogs={onToggleLogs}
          onRetryBuild={onRetryBuild}
          onLoadMore={onLoadMoreBuilds}
        />
      )}
      {showLaunches && (
        <LaunchTimeline entry={launchEntry} activeTokens={activeTokens} highlightEnabled={highlightEnabled} />
      )}
      {showHistory && <HistoryTimeline entry={historyEntry} />}
    </article>
  );
}

export default AppCard;
