import { useContext } from 'react';
import { ToastContext, type ToastContextValue } from './ToastContext';

export function useToasts(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToasts must be used within a ToastProvider');
  }
  return context;
}
