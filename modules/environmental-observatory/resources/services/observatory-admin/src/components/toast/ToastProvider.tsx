import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ToastContext, type ToastContextValue, type ToastPayload, type ToastTone } from './ToastContext';

type Toast = ToastPayload & { id: string };

const TONE_STYLES: Record<ToastTone, string> = {
  info: 'border-slate-300 bg-white/90 text-slate-900',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-rose-300 bg-rose-50 text-rose-900'
};

const CLOSE_BUTTON_CLASSES =
  'absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs text-slate-500 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500';

function generateId(): string {
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
        const timeoutId = window.setTimeout(() => dismissToast(id), duration);
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
            <div className="pointer-events-none fixed inset-x-0 top-6 z-[999] flex justify-center px-4 sm:top-8 sm:justify-end sm:px-6">
              <div className="flex flex-col gap-3">
                {toasts.map((toast) => {
                  const tone = toast.tone ?? 'info';
                  const toneClasses = TONE_STYLES[tone];
                  return (
                    <div
                      key={toast.id}
                      role="status"
                      aria-live={tone === 'error' ? 'assertive' : 'polite'}
                      className={`pointer-events-auto relative min-w-[240px] max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${toneClasses}`}
                    >
                      <button
                        type="button"
                        className={CLOSE_BUTTON_CLASSES}
                        aria-label="Dismiss notification"
                        onClick={() => dismissToast(toast.id)}
                      >
                        ×
                      </button>
                      {toast.title && <strong className="font-semibold">{toast.title}</strong>}
                      {toast.description && <p className="mt-1 text-sm">{toast.description}</p>}
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
