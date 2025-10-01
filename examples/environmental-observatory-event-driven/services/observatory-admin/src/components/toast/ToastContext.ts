import { createContext } from 'react';

export type ToastTone = 'info' | 'success' | 'error' | 'warning';

export type ToastPayload = {
  title?: string;
  description?: string;
  tone?: ToastTone;
  duration?: number;
};

export type ToastContextValue = {
  pushToast: (toast: ToastPayload) => string;
  dismissToast: (id: string) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);
