import { type HTMLAttributes, type ReactNode } from 'react';

type FormFeedbackTone = 'info' | 'success' | 'error';

type FormFeedbackProps = HTMLAttributes<HTMLDivElement> & {
  tone?: FormFeedbackTone;
  children: ReactNode;
};

const TONE_CLASSES: Record<FormFeedbackTone, string> = {
  info: 'rounded-2xl border border-slate-200/70 bg-slate-50/80 px-3 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300',
  success:
    'rounded-2xl border border-emerald-300/70 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-500/15 dark:text-emerald-200',
  error:
    'rounded-2xl border border-rose-300/70 bg-rose-50/80 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/60 dark:bg-rose-500/15 dark:text-rose-200'
};

export default function FormFeedback({ tone = 'info', className, children, ...props }: FormFeedbackProps) {
  const merged = className ? `${TONE_CLASSES[tone]} ${className}` : TONE_CLASSES[tone];
  return (
    <div className={merged} {...props}>
      {children}
    </div>
  );
}
