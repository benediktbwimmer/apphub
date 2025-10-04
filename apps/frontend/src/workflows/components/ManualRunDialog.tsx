import { Modal } from '../../components';
import ManualRunPanel from './ManualRunPanel';
import type { WorkflowDefinition, WorkflowRun } from '../types';

type ManualRunDialogProps = {
  open: boolean;
  workflow: WorkflowDefinition | null;
  onClose: () => void;
  onSubmit: (input: { parameters: unknown; triggeredBy?: string | null }) => Promise<void>;
  pending: boolean;
  error: string | null;
  authorized: boolean;
  lastRun?: WorkflowRun | null;
  unreachableServices: string[];
};

export default function ManualRunDialog({
  open,
  workflow,
  onClose,
  onSubmit,
  pending,
  error,
  authorized,
  lastRun,
  unreachableServices
}: ManualRunDialogProps) {
  return (
    <Modal open={open} onClose={onClose} contentClassName="max-w-4xl">
      <div className="max-h-[80vh] overflow-y-auto p-4 sm:p-6">
        <ManualRunPanel
          workflow={workflow}
          onSubmit={onSubmit}
          pending={pending}
          error={error}
          authorized={authorized}
          lastRun={lastRun}
          unreachableServices={unreachableServices}
        />
      </div>
    </Modal>
  );
}
