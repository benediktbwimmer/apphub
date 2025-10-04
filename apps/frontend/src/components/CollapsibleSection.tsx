import { useState, type ReactNode } from 'react';
import classNames from 'classnames';

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  description?: string;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
  onToggle?: (open: boolean) => void;
}

const WRAPPER_CLASS = 'overflow-hidden rounded-3xl border border-subtle bg-surface-glass shadow-elevation-lg';
const SUMMARY_CLASS =
  'flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left outline-none transition-colors hover:bg-surface-glass-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const SUMMARY_TEXT_CLASS = 'flex flex-col gap-1';
const DESCRIPTION_CLASS = 'text-scale-xs text-secondary';
const TOGGLE_HINT_CLASS = 'text-scale-xs font-weight-medium text-muted';
const CONTENT_CLASS = 'border-t border-subtle bg-surface-glass-soft px-5 py-4';

export function CollapsibleSection({
  title,
  description,
  children,
  defaultOpen = false,
  className,
  contentClassName,
  onToggle
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className={classNames('group', WRAPPER_CLASS, className)}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        onToggle?.(next);
      }}
    >
      <summary className={SUMMARY_CLASS}>
        <span className={SUMMARY_TEXT_CLASS}>
          <span className="text-scale-sm font-weight-semibold text-primary">{title}</span>
          {description ? <span className={DESCRIPTION_CLASS}>{description}</span> : null}
        </span>
        <span className={TOGGLE_HINT_CLASS}>{open ? 'Hide' : 'Show'}</span>
      </summary>
      <div className={classNames(CONTENT_CLASS, contentClassName)}>{children}</div>
    </details>
  );
}
