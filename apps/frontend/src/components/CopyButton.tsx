import { useCallback, type ReactNode } from 'react';
import { copyToClipboard } from '../utils/copy';

type CopyButtonProps = {
  value: string;
  ariaLabel?: string;
  children?: ReactNode;
  size?: 'xs' | 'sm';
  className?: string;
};

function buildBaseClasses(size: 'xs' | 'sm'): string {
  const base =
    'inline-flex items-center justify-center rounded-full border border-subtle bg-surface-glass font-weight-semibold text-accent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent hover:border-accent hover:bg-accent-soft hover:text-accent-strong';
  if (size === 'sm') {
    return `${base} px-3 py-1 text-scale-sm uppercase tracking-scale-wide`;
  }
  return `${base} px-2 py-0.5 text-scale-xs uppercase tracking-scale-wider`;
}

export function CopyButton({
  value,
  ariaLabel,
  children = 'Copy',
  size = 'xs',
  className
}: CopyButtonProps) {
  const handleCopy = useCallback(() => {
    void copyToClipboard(value);
  }, [value]);

  const classes = className ? `${buildBaseClasses(size)} ${className}` : buildBaseClasses(size);

  return (
    <button type="button" className={classes} onClick={handleCopy} aria-label={ariaLabel ?? 'Copy value'}>
      {children}
    </button>
  );
}

export default CopyButton;
