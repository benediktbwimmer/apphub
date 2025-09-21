import { createContext } from 'react';

type ToastTone = 'info' | 'success' | 'error';

type ToastPayload = {
  title?: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
};

type ToastContextValue = {
  pushToast: (toast: ToastPayload) => string;
  dismissToast: (id: string) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);

export type { ToastTone, ToastPayload, ToastContextValue };
