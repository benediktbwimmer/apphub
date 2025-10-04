import { useContext } from 'react';
import { ToastContext, type ToastContextValue } from './ToastContext';

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToasts must be used within a ToastProvider');
  }
  return ctx;
}
