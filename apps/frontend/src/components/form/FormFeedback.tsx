import { type HTMLAttributes, type ReactNode } from 'react';

type FormFeedbackTone = 'info' | 'success' | 'error';

type FormFeedbackProps = HTMLAttributes<HTMLDivElement> & {
  tone?: FormFeedbackTone;
  children: ReactNode;
};

const TONE_CLASSES: Record<FormFeedbackTone, string> = {
  info: 'rounded-2xl border border-[color:var(--color-status-info)] bg-[color:color-mix(in_srgb,var(--color-status-info)_12%,var(--color-surface-raised))] px-3 py-2 text-scale-sm text-status-info',
  success:
    'rounded-2xl border border-[color:var(--color-status-success)] bg-[color:color-mix(in_srgb,var(--color-status-success)_12%,var(--color-surface-raised))] px-3 py-2 text-scale-sm text-status-success',
  error:
    'rounded-2xl border border-[color:var(--color-status-danger)] bg-[color:color-mix(in_srgb,var(--color-status-danger)_14%,var(--color-surface-raised))] px-3 py-2 text-scale-sm text-status-danger'
};

export default function FormFeedback({ tone = 'info', className, children, ...props }: FormFeedbackProps) {
  const merged = className ? `${TONE_CLASSES[tone]} ${className}` : TONE_CLASSES[tone];
  return (
    <div className={merged} {...props}>
      {children}
    </div>
  );
}
