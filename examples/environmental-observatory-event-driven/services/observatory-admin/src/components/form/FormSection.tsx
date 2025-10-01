import { forwardRef, createElement, type FormHTMLAttributes, type HTMLAttributes } from 'react';

type ElementTag = 'div' | 'section' | 'form' | 'aside';

type FormSectionProps = (HTMLAttributes<HTMLElement> & FormHTMLAttributes<HTMLFormElement>) & {
  as?: ElementTag;
  padded?: boolean;
};

const PADDED_CLASSES = 'flex flex-col gap-5 rounded-xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur';
const UNPADDED_CLASSES = 'flex flex-col gap-5 rounded-xl border border-slate-200 bg-white/90 shadow-sm backdrop-blur';

export const FormSection = forwardRef<HTMLElement, FormSectionProps>(function FormSection(
  { as = 'section', padded = true, className, ...props },
  ref
) {
  const base = padded ? PADDED_CLASSES : UNPADDED_CLASSES;
  const merged = className ? `${base} ${className}` : base;
  return createElement(as, { ...props, className: merged, ref });
});
