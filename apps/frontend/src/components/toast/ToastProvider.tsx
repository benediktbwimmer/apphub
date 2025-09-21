import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ToastContext, type ToastContextValue, type ToastPayload, type ToastTone } from './ToastContext';

type Toast = ToastPayload & {
  id: string;
};

const TOAST_BASE_CLASSES =
  'pointer-events-auto flex min-w-[260px] max-w-sm flex-col gap-1 rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur-sm';

const TONE_STYLES: Record<ToastTone, string> = {
  info: 'border-slate-200/70 bg-white/95 text-slate-900 dark:border-slate-700/60 dark:bg-slate-900/90 dark:text-slate-100',
  success: 'border-emerald-300/70 bg-emerald-50/95 text-emerald-800 dark:border-emerald-400/60 dark:bg-emerald-900/50 dark:text-emerald-200',
  error: 'border-rose-300/70 bg-rose-50/95 text-rose-700 dark:border-rose-500/60 dark:bg-rose-900/60 dark:text-rose-200'
};

const CLOSE_BUTTON_CLASSES =
  'absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-500 dark:hover:text-slate-300';

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
                        <strong className="text-sm font-semibold">{toast.title}</strong>
                      )}
                      {toast.description && <p className="text-sm leading-snug">{toast.description}</p>}
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
