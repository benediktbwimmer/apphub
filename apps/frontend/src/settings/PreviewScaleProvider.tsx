import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  PREVIEW_HEIGHT_BOUNDS,
  PREVIEW_WIDTH_BOUNDS,
  PreviewLayoutContext
} from './previewLayoutContext';

const STORAGE_KEY = 'apphub.previewDimensions.v1';

type StoredLayoutSettings = {
  width: number;
  height: number;
};

const DEFAULT_SETTINGS: StoredLayoutSettings = {
  width: PREVIEW_WIDTH_BOUNDS.default,
  height: PREVIEW_HEIGHT_BOUNDS.default
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeSettings(raw: Partial<StoredLayoutSettings> | null): StoredLayoutSettings {
  if (!raw) {
    return { ...DEFAULT_SETTINGS };
  }
  const width = clamp(raw.width ?? DEFAULT_SETTINGS.width, PREVIEW_WIDTH_BOUNDS.min, PREVIEW_WIDTH_BOUNDS.max);
  const height = clamp(raw.height ?? DEFAULT_SETTINGS.height, PREVIEW_HEIGHT_BOUNDS.min, PREVIEW_HEIGHT_BOUNDS.max);
  return { width, height };
}

export function PreviewScaleProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StoredLayoutSettings>(() => {
    if (typeof window === 'undefined') {
      return { ...DEFAULT_SETTINGS };
    }
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return { ...DEFAULT_SETTINGS };
      }
      const parsed = JSON.parse(stored) as Partial<StoredLayoutSettings>;
      return normalizeSettings(parsed);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage write errors in private browsing contexts.
    }
  }, [settings]);

  const setWidth = (value: number) => {
    setSettings((current) => ({
      ...current,
      width: clamp(value, PREVIEW_WIDTH_BOUNDS.min, PREVIEW_WIDTH_BOUNDS.max)
    }));
  };

  const setHeight = (value: number) => {
    setSettings((current) => ({
      ...current,
      height: clamp(value, PREVIEW_HEIGHT_BOUNDS.min, PREVIEW_HEIGHT_BOUNDS.max)
    }));
  };

  const value = useMemo(
    () => ({
      width: settings.width,
      height: settings.height,
      setWidth,
      setHeight
    }),
    [settings.width, settings.height]
  );

  return <PreviewLayoutContext.Provider value={value}>{children}</PreviewLayoutContext.Provider>;
}
