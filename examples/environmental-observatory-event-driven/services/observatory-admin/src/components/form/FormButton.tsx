import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary';
type Size = 'md' | 'sm';

type FormButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const VARIANT_STYLES: Record<Variant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-slate-500'
};

const SIZE_STYLES: Record<Size, string> = {
  md: 'px-4 py-2 text-sm',
  sm: 'px-3 py-1.5 text-xs'
};

export const FormButton = forwardRef<HTMLButtonElement, FormButtonProps>(function FormButton(
  { variant = 'primary', size = 'md', className, ...props },
  ref
) {
  const base = 'inline-flex items-center justify-center rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
  const merged = `${base} ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]}${className ? ` ${className}` : ''}`;
  return <button ref={ref} className={merged} {...props} />;
});
