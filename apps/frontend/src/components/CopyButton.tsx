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
    'inline-flex items-center justify-center rounded-full border border-slate-200/70 bg-white/80 font-semibold text-violet-600 transition-colors hover:border-violet-300 hover:bg-violet-50/80 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-violet-300 dark:hover:border-slate-500 dark:hover:bg-slate-800/70';
  if (size === 'sm') {
    return `${base} px-3 py-1 text-xs uppercase tracking-[0.2em]`;
  }
  return `${base} px-2 py-0.5 text-[10px] uppercase tracking-[0.3em]`;
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
