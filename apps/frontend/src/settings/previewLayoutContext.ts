import { createContext, useContext } from 'react';

export const PREVIEW_WIDTH_BOUNDS = {
  min: 320,
  max: 960,
  default: 520
} as const;

export const PREVIEW_HEIGHT_BOUNDS = {
  min: 180,
  max: 720,
  default: 320
} as const;

export type PreviewLayoutContextValue = {
  width: number;
  height: number;
  setWidth: (value: number) => void;
  setHeight: (value: number) => void;
};

export const PreviewLayoutContext = createContext<PreviewLayoutContextValue>({
  width: PREVIEW_WIDTH_BOUNDS.default,
  height: PREVIEW_HEIGHT_BOUNDS.default,
  setWidth: () => {},
  setHeight: () => {}
});

export function usePreviewLayout(): PreviewLayoutContextValue {
  return useContext(PreviewLayoutContext);
}
