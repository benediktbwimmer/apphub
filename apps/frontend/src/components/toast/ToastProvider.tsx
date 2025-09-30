import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ToastContext, type ToastContextValue, type ToastPayload, type ToastTone } from './ToastContext';

type Toast = ToastPayload & {
  id: string;
};

const TOAST_BASE_CLASSES =
  'pointer-events-auto flex min-w-[260px] max-w-sm flex-col gap-1 rounded-2xl border px-4 py-3 text-scale-sm shadow-elevation-md backdrop-blur-sm';

const TONE_STYLES: Record<ToastTone, string> = {
  info: [
    'border-[color:var(--color-status-info)]',
    'bg-[color:color-mix(in_srgb,var(--color-status-info)_12%,var(--color-surface-raised))]',
    'text-status-info'
  ].join(' '),
  success: [
    'border-[color:var(--color-status-success)]',
    'bg-[color:color-mix(in_srgb,var(--color-status-success)_12%,var(--color-surface-raised))]',
    'text-status-success'
  ].join(' '),
  warning: [
    'border-[color:var(--color-status-warning)]',
    'bg-[color:color-mix(in_srgb,var(--color-status-warning)_14%,var(--color-surface-raised))]',
    'text-status-warning'
  ].join(' '),
  error: [
    'border-[color:var(--color-status-danger)]',
    'bg-[color:color-mix(in_srgb,var(--color-status-danger)_14%,var(--color-surface-raised))]',
    'text-status-danger'
  ].join(' ')
};

const TONE_TEXT_CLASSES: Record<ToastTone, string> = {
  info: 'text-status-info-on',
  success: 'text-status-success-on',
  warning: 'text-status-warning-on',
  error: 'text-status-danger-on'
};

const CLOSE_BUTTON_CLASSES =
  'absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-scale-xs text-muted transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `toast-${Math.random().toString(36).slice(2, 10)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timeoutId = timers.current.get(id);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      timers.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (toast: ToastPayload) => {
      const id = generateId();
      setToasts((prev) => [...prev, { id, ...toast }]);
      const duration = typeof toast.duration === 'number' ? toast.duration : 5000;
      if (duration > 0) {
        const timeoutId = window.setTimeout(() => {
          dismissToast(id);
        }, duration);
        timers.current.set(id, timeoutId);
      }
      return id;
    },
    [dismissToast]
  );

  useEffect(() => {
    const timersMap = timers.current;
    return () => {
      timersMap.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timersMap.clear();
    };
  }, []);

  const contextValue = useMemo<ToastContextValue>(
    () => ({ pushToast, dismissToast }),
    [pushToast, dismissToast]
  );

  const portalTarget = typeof document === 'undefined' ? null : document.body;

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {portalTarget
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 top-6 z-[9999] flex justify-center px-4 sm:top-8 sm:justify-end sm:px-6">
              <div className="flex flex-col gap-3">
                {toasts.map((toast) => {
                  const tone = toast.tone ?? 'info';
                  const toneTextClass = TONE_TEXT_CLASSES[tone];
                  return (
                    <div
                      key={toast.id}
                      role="status"
                      aria-live={tone === 'error' ? 'assertive' : 'polite'}
                      className={`${TOAST_BASE_CLASSES} ${TONE_STYLES[tone]} relative`}
                    >
                      <button
                        type="button"
                        onClick={() => dismissToast(toast.id)}
                        className={CLOSE_BUTTON_CLASSES}
                        aria-label="Dismiss notification"
                      >
                        ×
                      </button>
                      {toast.title && (
                        <strong className={`text-scale-sm font-weight-semibold ${toneTextClass}`}>{toast.title}</strong>
                      )}
                      {toast.description && (
                        <p className={`text-scale-sm leading-scale-snug ${toneTextClass}`}>{toast.description}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>,
            portalTarget
          )
        : null}
    </ToastContext.Provider>
  );
}
