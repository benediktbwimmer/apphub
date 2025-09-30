import classNames from 'classnames';
import { useCallback, type ChangeEvent } from 'react';
import {
  PREVIEW_HEIGHT_BOUNDS,
  PREVIEW_WIDTH_BOUNDS,
  usePreviewLayout
} from './previewLayoutContext';
import {
  SETTINGS_CARD_CONTAINER_CLASSES,
  SETTINGS_HEADER_SUBTITLE_CLASSES,
  SETTINGS_HEADER_TITLE_CLASSES,
  SETTINGS_INPUT_NUMBER_CLASSES,
  SETTINGS_INPUT_RANGE_CLASSES,
  SETTINGS_PREVIEW_CONTAINER_CLASSES,
  SETTINGS_PREVIEW_TILE_CLASSES,
  SETTINGS_RESET_BUTTON_CLASSES,
  SETTINGS_SECTION_HELPER_CLASSES,
  SETTINGS_SECTION_LABEL_CLASSES,
  SETTINGS_SECTION_ROW_CLASSES,
  SETTINGS_TILE_CARD_CLASSES,
  SETTINGS_TILE_META_OVERLAY_CLASSES,
  SETTINGS_TILE_TAG_CLASSES
} from './settingsTokens';

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
          <h2 className={SETTINGS_HEADER_TITLE_CLASSES}>Preview Dimensions</h2>
          <p className={SETTINGS_HEADER_SUBTITLE_CLASSES}>
            Adjust the width and height of preview tiles. These values drive the layout in the catalog and apps gallery.
          </p>
        </header>
        <div className={SETTINGS_CARD_CONTAINER_CLASSES}>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-2" htmlFor="preview-width-control">
              <span className={SETTINGS_SECTION_LABEL_CLASSES}>
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
                className={SETTINGS_INPUT_RANGE_CLASSES}
              />
            </label>
            <div className={SETTINGS_SECTION_ROW_CLASSES}>
              <span className={SETTINGS_SECTION_LABEL_CLASSES}>Current width</span>
              <input
                type="number"
                min={PREVIEW_WIDTH_BOUNDS.min}
                max={PREVIEW_WIDTH_BOUNDS.max}
                step={WIDTH_STEP}
                value={width}
                onChange={handleWidthInput}
                className={SETTINGS_INPUT_NUMBER_CLASSES}
              />
              <span className={classNames('text-[11px]', SETTINGS_SECTION_HELPER_CLASSES)}>{width}px</span>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-2" htmlFor="preview-height-control">
              <span className={SETTINGS_SECTION_LABEL_CLASSES}>
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
                className={SETTINGS_INPUT_RANGE_CLASSES}
              />
            </label>
            <div className={SETTINGS_SECTION_ROW_CLASSES}>
              <span className={SETTINGS_SECTION_LABEL_CLASSES}>Current height</span>
              <input
                type="number"
                min={PREVIEW_HEIGHT_BOUNDS.min}
                max={PREVIEW_HEIGHT_BOUNDS.max}
                step={HEIGHT_STEP}
                value={height}
                onChange={handleHeightInput}
                className={SETTINGS_INPUT_NUMBER_CLASSES}
              />
              <span className={classNames('text-[11px]', SETTINGS_SECTION_HELPER_CLASSES)}>{height}px</span>
            </div>
          </div>
          <button
            type="button"
            onClick={resetDimensions}
            className={SETTINGS_RESET_BUTTON_CLASSES}
          >
            Reset to defaults
          </button>
        </div>
      </div>
      <div className="space-y-3">
        <h3 className={SETTINGS_SECTION_LABEL_CLASSES}>
          Preview example
        </h3>
        <div className={SETTINGS_PREVIEW_CONTAINER_CLASSES}>
          <div
            className={SETTINGS_PREVIEW_TILE_CLASSES}
            style={{ width: `${width}px`, height: `${height}px` }}
          >
            <div className="absolute inset-0 flex flex-col gap-4 p-6 text-left text-primary">
              <div className="space-y-2">
                <span className={SETTINGS_TILE_TAG_CLASSES}>
                  sample preview
                </span>
                <h4 className="text-scale-lg font-weight-semibold text-primary">Custom dimensions demo</h4>
                <p className={SETTINGS_SECTION_HELPER_CLASSES}>
                  This placeholder matches the dimensions you configure above.
                </p>
              </div>
              <div className="mt-auto grid grid-cols-3 gap-3 text-scale-xs">
                <div className={SETTINGS_TILE_CARD_CLASSES}>
                  Metrics
                </div>
                <div className={SETTINGS_TILE_CARD_CLASSES}>
                  Logs
                </div>
                <div className={SETTINGS_TILE_CARD_CLASSES}>
                  Status
                </div>
              </div>
            </div>
            <div className={SETTINGS_TILE_META_OVERLAY_CLASSES}>
              {width}px × {height}px
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
