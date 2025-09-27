import { useEffect, useState } from 'react';

function getDocumentVisibility(): boolean {
  if (typeof document === 'undefined') {
    return true;
  }
  const state = (document as Document & { visibilityState?: Document['visibilityState'] }).visibilityState;
  if (typeof state === 'undefined') {
    return true;
  }
  return state !== 'hidden';
}

export function useDocumentVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => getDocumentVisibility());

  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return;
    }

    const handleVisibilityChange = () => {
      setIsVisible(getDocumentVisibility());
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
