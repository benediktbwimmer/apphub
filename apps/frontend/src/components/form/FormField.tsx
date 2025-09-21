import { type ReactNode } from 'react';

type FormFieldProps = {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
};

const LABEL_CLASSES = 'text-sm font-semibold text-slate-700 dark:text-slate-200';
const HINT_CLASSES = 'text-xs text-slate-500 dark:text-slate-400';

export default function FormField({ label, htmlFor, hint, children, className }: FormFieldProps) {
  return (
    <div className={className ? `flex flex-col gap-2 ${className}` : 'flex flex-col gap-2'}>
      {label !== undefined && (
        <label className={LABEL_CLASSES} htmlFor={typeof htmlFor === 'string' ? htmlFor : undefined}>
          {label}
        </label>
      )}
      {children}
      {hint !== undefined && <p className={HINT_CLASSES}>{hint}</p>}
    </div>
  );
}
