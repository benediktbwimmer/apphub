export function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/40 dark:border-emerald-400/40 dark:text-emerald-300';
    case 'running':
      return 'bg-sky-500/10 text-sky-600 border-sky-500/40 dark:border-sky-400/40 dark:text-sky-300 running-badge';
    case 'failed':
      return 'bg-rose-500/10 text-rose-600 border-rose-500/40 dark:border-rose-400/40 dark:text-rose-300';
    case 'canceled':
    case 'skipped':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/40 dark:border-amber-400/40 dark:text-amber-300';
    case 'pending':
      return 'bg-slate-400/10 text-slate-600 border-slate-400/40 dark:border-slate-400/40 dark:text-slate-300';
    default:
      return 'bg-slate-500/10 text-slate-600 border-slate-500/40 dark:border-slate-400/40 dark:text-slate-300';
  }
}
