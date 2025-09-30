import { useEffect, type PropsWithChildren } from 'react';

type ModalProps = {
  open: boolean;
  onClose?: () => void;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
  contentClassName?: string;
  closeOnBackdrop?: boolean;
  role?: 'dialog' | 'alertdialog';
};

const BASE_OVERLAY_CLASSES =
  'fixed inset-0 z-50 flex overflow-y-auto overscroll-contain bg-overlay-scrim backdrop-blur-sm';
const BASE_CONTENT_CLASSES =
  'relative w-full max-w-2xl rounded-3xl border border-subtle bg-surface-raised shadow-elevation-xl';

function joinClassNames(...values: Array<string | null | undefined | false>) {
  return values
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

let openModalCount = 0;
let previousBodyOverflow: string | null = null;
let previousBodyPaddingRight: string | null = null;

function lockBodyScroll(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  const body = document.body;
  const docEl = document.documentElement;
  if (!body || !docEl) {
    return;
  }

  if (openModalCount === 0) {
    previousBodyOverflow = body.style.overflow;
    previousBodyPaddingRight = body.style.paddingRight;

    const scrollbarWidth = window.innerWidth - docEl.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }

  openModalCount += 1;
}

function unlockBodyScroll(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const body = document.body;
  if (!body) {
    return;
  }

  openModalCount = Math.max(openModalCount - 1, 0);
  if (openModalCount === 0) {
    if (previousBodyOverflow !== null) {
      body.style.overflow = previousBodyOverflow;
    } else {
      body.style.removeProperty('overflow');
    }
    if (previousBodyPaddingRight !== null) {
      body.style.paddingRight = previousBodyPaddingRight;
    } else {
      body.style.removeProperty('padding-right');
    }
    previousBodyOverflow = null;
    previousBodyPaddingRight = null;
  }
}

function useBodyScrollLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    lockBodyScroll();

    return () => {
      unlockBodyScroll();
    };
  }, [enabled]);
}

/**
 * Shared modal container that enforces consistent backdrop styling, scroll containment,
 * and body locking. Supply layout-specific classes via `className` and `contentClassName`.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  className,
  contentClassName,
  closeOnBackdrop = true,
  role = 'dialog',
  children
}: PropsWithChildren<ModalProps>) {
  useBodyScrollLock(open);

  if (!open) {
    return null;
  }

  const overlayClasses = joinClassNames(BASE_OVERLAY_CLASSES, className);
  const contentClasses = joinClassNames(BASE_CONTENT_CLASSES, contentClassName);

  const handleOverlayClick = () => {
    if (onClose && closeOnBackdrop) {
      onClose();
    }
  };

  return (
    <div
      className={overlayClasses}
      role={role}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={onClose ? handleOverlayClick : undefined}
    >
      <div className={contentClasses} onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export default Modal;
