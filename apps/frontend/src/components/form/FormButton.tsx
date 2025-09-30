import { forwardRef, type ButtonHTMLAttributes } from 'react';

type FormButtonVariant = 'primary' | 'secondary' | 'tertiary';
type FormButtonSize = 'md' | 'sm';

type FormButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: FormButtonVariant;
  size?: FormButtonSize;
};

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-2 rounded-full font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const VARIANT_CLASSES: Record<FormButtonVariant, string> = {
  primary: 'bg-accent text-on-accent shadow-accent-soft hover:bg-accent-strong',
  secondary:
    'border border-subtle bg-surface-glass text-muted hover:border-accent hover:bg-accent-soft hover:text-accent',
  tertiary:
    'border border-subtle bg-surface-glass-soft text-muted hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong'
};

function getSizeClasses(variant: FormButtonVariant, size: FormButtonSize) {
  if (variant === 'primary') {
    return size === 'sm' ? 'px-4 py-2 text-scale-sm' : 'px-5 py-2.5 text-scale-sm';
  }

  if (variant === 'secondary') {
    return size === 'sm' ? 'px-3 py-1.5 text-scale-xs' : 'px-4 py-2 text-scale-sm';
  }

  return size === 'sm' ? 'px-3 py-1.5 text-scale-xs' : 'px-3.5 py-2 text-scale-sm';
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
