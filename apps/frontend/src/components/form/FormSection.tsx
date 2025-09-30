import { createElement, forwardRef, type FormHTMLAttributes, type HTMLAttributes } from 'react';

type FormSectionElement = HTMLElement;

type FormSectionProps = HTMLAttributes<FormSectionElement> & FormHTMLAttributes<HTMLFormElement> & {
  as?: 'div' | 'section' | 'form' | 'aside';
  padded?: boolean;
};

const BASE_SECTION_CLASSES =
  'flex flex-col gap-5 rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg';

const UNPADDED_SECTION_CLASSES =
  'flex flex-col gap-5 rounded-3xl border border-subtle bg-surface-glass shadow-elevation-lg';

const joinClasses = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

const FormSection = forwardRef<FormSectionElement, FormSectionProps>(function FormSection(
  { as = 'div', padded = true, className, ...props },
  ref
) {
  const mergedProps = {
    ...props,
    className: joinClasses(padded ? BASE_SECTION_CLASSES : UNPADDED_SECTION_CLASSES, className),
    ref
  };
  return createElement(as, mergedProps);
});

export default FormSection;
