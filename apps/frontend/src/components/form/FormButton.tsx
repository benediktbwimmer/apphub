import { forwardRef, type ButtonHTMLAttributes } from 'react';

type FormButtonVariant = 'primary' | 'secondary' | 'tertiary';
type FormButtonSize = 'md' | 'sm';

type FormButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: FormButtonVariant;
  size?: FormButtonSize;
};

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60';

const VARIANT_CLASSES: Record<FormButtonVariant, string> = {
  primary:
    'bg-violet-600 text-white shadow-lg shadow-violet-500/30 hover:bg-violet-500 dark:bg-slate-200/20 dark:text-slate-50 dark:hover:bg-slate-200/30',
  secondary:
    'border border-slate-200/70 bg-white/80 text-slate-600 hover:border-violet-300 hover:text-violet-700 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100',
  tertiary:
    'border border-slate-200/70 bg-white/70 text-slate-600 hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100'
};

function getSizeClasses(variant: FormButtonVariant, size: FormButtonSize) {
  if (variant === 'primary') {
    return size === 'sm' ? 'px-4 py-2 text-sm' : 'px-5 py-2.5 text-sm';
  }

  if (variant === 'secondary') {
    return size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  }

  return size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-xs sm:text-sm';
}

const FormButton = forwardRef<HTMLButtonElement, FormButtonProps>(function FormButton(
  { variant = 'primary', size = 'md', className, ...props },
  ref
) {
  const sizeClasses = getSizeClasses(variant, size);
  const merged = `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${sizeClasses}${className ? ` ${className}` : ''}`;
  return <button ref={ref} className={merged} {...props} />;
});

export default FormButton;
