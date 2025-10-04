import { type ReactNode } from 'react';

type FormFieldProps = {
  label?: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
};

export function FormField({ label, hint, htmlFor, children, className }: FormFieldProps) {
  return (
    <div className={className ? `flex flex-col gap-2 ${className}` : 'flex flex-col gap-2'}>
      {label !== undefined && (
        <label className="text-sm font-medium text-slate-700" htmlFor={typeof htmlFor === 'string' ? htmlFor : undefined}>
          {label}
        </label>
      )}
      {children}
      {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
