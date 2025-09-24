import type { ReactNode } from 'react';

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'h-3 w-3 border',
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-7 w-7 border-[3px]'
};

export type SpinnerProps = {
  label?: ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  labelClassName?: string;
  iconClassName?: string;
};

export function Spinner({
  label,
  size = 'md',
  className,
  labelClassName,
  iconClassName
}: SpinnerProps) {
  const wrapperClasses = ['inline-flex items-center gap-2 text-current', className]
    .filter(Boolean)
    .join(' ');
  const iconClasses = [
    'inline-block rounded-full border-current border-t-transparent animate-spin motion-reduce:animate-none',
    SIZE_CLASSES[size],
    iconClassName
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={wrapperClasses} role="status" aria-live="polite" aria-busy="true">
      <span className={iconClasses} aria-hidden="true" />
      {label ? <span className={labelClassName}>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}
