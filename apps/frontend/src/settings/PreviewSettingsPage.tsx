import { useCallback, type ChangeEvent } from 'react';
import {
  PREVIEW_HEIGHT_BOUNDS,
  PREVIEW_WIDTH_BOUNDS,
  usePreviewLayout
} from './previewLayoutContext';

const WIDTH_STEP = 20;
const HEIGHT_STEP = 20;

export default function PreviewSettingsPage() {
  const { width, height, setWidth, setHeight } = usePreviewLayout();

  const handleWidthRange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setWidth(Number.parseInt(event.target.value, 10));
    },
    [setWidth]
  );

  const handleHeightRange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setHeight(Number.parseInt(event.target.value, 10));
    },
    [setHeight]
  );

  const handleWidthInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(next)) {
        return;
      }
      setWidth(next);
    },
    [setWidth]
  );

  const handleHeightInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(next)) {
        return;
      }
      setHeight(next);
    },
    [setHeight]
  );

  const resetDimensions = useCallback(() => {
    setWidth(PREVIEW_WIDTH_BOUNDS.default);
    setHeight(PREVIEW_HEIGHT_BOUNDS.default);
  }, [setWidth, setHeight]);

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-3">
        <header className="space-y-1">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Preview Dimensions</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Adjust the width and height of preview tiles. These values drive the layout in the catalog and apps gallery.
          </p>
        </header>
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/70 p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/50">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-2" htmlFor="preview-width-control">
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
                Tile width ({PREVIEW_WIDTH_BOUNDS.min}px – {PREVIEW_WIDTH_BOUNDS.max}px)
              </span>
              <input
                id="preview-width-control"
                type="range"
                min={PREVIEW_WIDTH_BOUNDS.min}
                max={PREVIEW_WIDTH_BOUNDS.max}
                step={WIDTH_STEP}
                value={width}
                onChange={handleWidthRange}
                className="h-1.5 rounded-full bg-gradient-to-r from-violet-200 via-violet-400 to-violet-600 accent-violet-600"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">Current width</span>
              <input
                type="number"
                min={PREVIEW_WIDTH_BOUNDS.min}
                max={PREVIEW_WIDTH_BOUNDS.max}
                step={WIDTH_STEP}
                value={width}
                onChange={handleWidthInput}
                className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
              />
              <span className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">{width}px</span>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-2" htmlFor="preview-height-control">
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
                Tile height ({PREVIEW_HEIGHT_BOUNDS.min}px – {PREVIEW_HEIGHT_BOUNDS.max}px)
              </span>
              <input
                id="preview-height-control"
                type="range"
                min={PREVIEW_HEIGHT_BOUNDS.min}
                max={PREVIEW_HEIGHT_BOUNDS.max}
                step={HEIGHT_STEP}
                value={height}
                onChange={handleHeightRange}
                className="h-1.5 rounded-full bg-gradient-to-r from-slate-200 via-slate-400 to-slate-600 accent-violet-600"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">Current height</span>
              <input
                type="number"
                min={PREVIEW_HEIGHT_BOUNDS.min}
                max={PREVIEW_HEIGHT_BOUNDS.max}
                step={HEIGHT_STEP}
                value={height}
                onChange={handleHeightInput}
                className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300"
              />
              <span className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">{height}px</span>
            </div>
          </div>
          <button
            type="button"
            onClick={resetDimensions}
            className="inline-flex w-max items-center rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Reset to defaults
          </button>
        </div>
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
          Preview example
        </h3>
        <div className="rounded-3xl border border-slate-200/70 bg-slate-50/80 p-4 shadow-inner dark:border-slate-700/70 dark:bg-slate-900/50">
          <div
            className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow dark:border-slate-700/60"
            style={{ width: `${width}px`, height: `${height}px` }}
          >
            <div className="absolute inset-0 flex flex-col gap-4 p-6 text-left text-slate-700 dark:text-slate-200">
              <div className="space-y-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-violet-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
                  sample preview
                </span>
                <h4 className="text-lg font-semibold">Custom dimensions demo</h4>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  This placeholder matches the dimensions you configure above.
                </p>
              </div>
              <div className="mt-auto grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  Metrics
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  Logs
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  Status
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/40 via-transparent to-transparent py-2 text-center text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500/70 dark:text-slate-200/70">
              {width}px × {height}px
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
