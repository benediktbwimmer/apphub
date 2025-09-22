import { getStatusBadgeClasses } from './statusBadgeClasses';

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize ${getStatusBadgeClasses(status)}`}
    >
      {status}
    </span>
  );
}

export default StatusBadge;
