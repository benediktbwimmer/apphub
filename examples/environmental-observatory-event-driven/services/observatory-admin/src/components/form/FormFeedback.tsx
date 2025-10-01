import { type HTMLAttributes, type ReactNode } from 'react';

type Tone = 'info' | 'success' | 'error';

type FormFeedbackProps = HTMLAttributes<HTMLDivElement> & {
  tone?: Tone;
  children: ReactNode;
};

const TONE_CLASSES: Record<Tone, string> = {
  info: 'border-slate-300 bg-white text-slate-700',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  error: 'border-rose-300 bg-rose-50 text-rose-900'
};

export function FormFeedback({ tone = 'info', className, children, ...props }: FormFeedbackProps) {
  const base = `rounded-lg border px-3 py-2 text-sm ${TONE_CLASSES[tone]}`;
  const merged = className ? `${base} ${className}` : base;
  return (
    <div className={merged} {...props}>
      {children}
    </div>
  );
}
