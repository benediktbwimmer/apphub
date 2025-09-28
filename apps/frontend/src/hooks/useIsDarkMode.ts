import { useEffect, useState } from 'react';

function prefersDarkMode(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function hasDarkModeClass(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const element = document.documentElement;
  return element.classList.contains('dark') || element.classList.contains('theme-dark');
}

function resolveDarkMode(): boolean {
  return hasDarkModeClass() || prefersDarkMode();
}

/**
 * ReactFlow does not expose theme toggles, so we infer dark mode by listening for
 * `prefers-color-scheme` changes and the `dark` class Tailwind applies to `<html>`.
 */
export function useIsDarkMode(): boolean {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => resolveDarkMode());

  useEffect(() => {
    if (typeof document === 'undefined') {
      return () => {
        // noop for SSR
      };
    }

    const element = document.documentElement;

    const updateMode = () => {
      setIsDarkMode(resolveDarkMode());
    };

    const observer = new MutationObserver(updateMode);
    observer.observe(element, { attributes: true, attributeFilter: ['class', 'data-theme'] });

    let media: MediaQueryList | null = null;

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        media = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = updateMode;
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', listener);
        } else if (typeof media.addListener === 'function') {
          media.addListener(listener);
        }
      } catch {
        media = null;
      }
    }

    updateMode();

    return () => {
      observer.disconnect();
      if (media) {
        if (typeof media.removeEventListener === 'function') {
          media.removeEventListener('change', updateMode);
        } else if (typeof media.removeListener === 'function') {
          media.removeListener(updateMode);
        }
      }
    };
  }, []);

  return isDarkMode;
}
