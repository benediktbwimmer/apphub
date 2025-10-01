import { type HTMLAttributes } from 'react';

interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function Spinner({ label, className, ...props }: SpinnerProps) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`} role="status" {...props}>
      <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" aria-hidden="true" />
      {label ? <span className="text-sm text-slate-600">{label}</span> : null}
    </div>
  );
}
