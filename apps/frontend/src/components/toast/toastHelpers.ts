import { useCallback } from 'react';
import { useToasts } from './useToasts';

type ToastTone = 'success' | 'error' | 'info' | 'warning';

function resolveDescription(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }
  return fallback;
}

export function useToastHelpers() {
  const { pushToast } = useToasts();

  const showToast = useCallback(
    (
      tone: ToastTone,
      title: string,
      description?: string
    ) => {
      pushToast({ tone, title, description });
    },
    [pushToast]
  );

  const showSuccess = useCallback(
    (title: string, description?: string) => {
      showToast('success', title, description);
    },
    [showToast]
  );

  const showInfo = useCallback(
    (title: string, description?: string) => {
      showToast('info', title, description);
    },
    [showToast]
  );

  const showWarning = useCallback(
    (title: string, description?: string) => {
      showToast('warning', title, description);
    },
    [showToast]
  );

  const showError = useCallback(
    (title: string, error: unknown, fallback = 'An unexpected error occurred.') => {
      const description = resolveDescription(error, fallback);
      showToast('error', title, description);
    },
    [showToast]
  );

  const showDestructiveSuccess = useCallback(
    (action: string, targetLabel?: string | null) => {
      const normalizedAction = action.trim();
      const subject = targetLabel?.trim() ? ` ${targetLabel.trim()}` : '';
      showToast('success', `${normalizedAction} completed`, `The request${subject ? ` for${subject}` : ''} finished successfully.`);
    },
    [showToast]
  );

  const showDestructiveError = useCallback(
    (action: string, error: unknown) => {
      const normalizedAction = action.trim();
      showError(`${normalizedAction} failed`, error, `Unable to ${normalizedAction.toLowerCase()}.`);
    },
    [showError]
  );

  return {
    showToast,
    showSuccess,
    showInfo,
    showWarning,
    showError,
    showDestructiveSuccess,
    showDestructiveError
  };
}
