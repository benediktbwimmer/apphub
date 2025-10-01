import classNames from 'classnames';
import { Spinner } from '../../components';
import { getStatusToneClasses } from '../../theme/statusTokens';
import {
  JOB_FORM_ACTION_PRIMARY_CLASSES,
  JOB_FORM_ACTION_SECONDARY_CLASSES,
  JOB_FORM_ERROR_TEXT_CLASSES,
  JOB_RUNTIME_BADGE_BASE_CLASSES,
  JOB_RUNTIME_BADGE_NEUTRAL_CLASSES
} from '../jobTokens';
import type { JobRuntimeStatus } from '../api';

const HEADER_TITLE_CLASSES = 'text-scale-2xl font-weight-semibold text-primary';

const HEADER_SUBTITLE_CLASSES = 'text-scale-sm text-secondary';

const RUNTIME_LABELS: Record<JobRuntimeStatus['runtime'], string> = {
  node: 'Node runtime',
  python: 'Python runtime',
  docker: 'Docker runtime',
  module: 'Module runtime'
};

type JobsHeaderProps = {
  runtimeStatuses: JobRuntimeStatus[];
  runtimeStatusLoading: boolean;
  runtimeStatusError: string | null;
  pythonReady: boolean;
  pythonButtonTitle?: string;
  onCreateNode: () => void;
  onCreatePython: () => void;
};

export function JobsHeader({
  runtimeStatuses,
  runtimeStatusLoading,
  runtimeStatusError,
  pythonReady,
  pythonButtonTitle,
  onCreateNode,
  onCreatePython
}: JobsHeaderProps) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 className={HEADER_TITLE_CLASSES}>Jobs</h1>
        <p className={HEADER_SUBTITLE_CLASSES}>
          Inspect job definitions, review recent runs, and manage bundle source code.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 lg:items-end">
        <div className="flex flex-wrap gap-2">
          {runtimeStatusLoading ? (
            <Spinner
              label="Checking runtimes…"
              size="xs"
              className={classNames(JOB_RUNTIME_BADGE_BASE_CLASSES, JOB_RUNTIME_BADGE_NEUTRAL_CLASSES)}
            />
          ) : runtimeStatuses.length > 0 ? (
            runtimeStatuses.map((status) => {
              const label = RUNTIME_LABELS[status.runtime] ?? `Runtime: ${status.runtime}`;
              const details = status.details as Record<string, unknown> | null;
              const version = details && typeof details.version === 'string' ? details.version : null;
              const tooltip = status.ready ? (version ? `Version ${version}` : 'Ready') : status.reason ?? 'Unavailable';
              return (
                <span
                  key={status.runtime}
                  className={classNames(
                    JOB_RUNTIME_BADGE_BASE_CLASSES,
                    getStatusToneClasses(status.ready ? 'ready' : 'error')
                  )}
                  title={tooltip}
                >
                  {label}: {status.ready ? 'Ready' : 'Unavailable'}
                </span>
              );
            })
          ) : (
            <span className={classNames(JOB_RUNTIME_BADGE_BASE_CLASSES, JOB_RUNTIME_BADGE_NEUTRAL_CLASSES)}>
              Runtime readiness unknown
            </span>
          )}
        </div>
        {runtimeStatusError && (
          <p className={JOB_FORM_ERROR_TEXT_CLASSES}>{runtimeStatusError}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={JOB_FORM_ACTION_PRIMARY_CLASSES}
            onClick={onCreateNode}
          >
            New Node job
          </button>
          <button
            type="button"
            className={JOB_FORM_ACTION_SECONDARY_CLASSES}
            onClick={onCreatePython}
            disabled={!pythonReady}
            title={pythonButtonTitle}
          >
            New Python job
          </button>
        </div>
      </div>
    </header>
  );
}
