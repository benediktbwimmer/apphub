import { createPortal } from 'react-dom';
import { useEffect, useRef, type ReactElement } from 'react';
import Navbar from '../../components/Navbar';
import type { PreviewTile } from '../types';

type LivePreviewState = { type: 'live'; url: string; title: string };
type TilePreviewState = { type: 'tile'; tile: PreviewTile; title: string };

export type FullscreenPreviewState = LivePreviewState | TilePreviewState;

type FullscreenOverlayProps = {
  preview: FullscreenPreviewState;
  onClose: () => void;
};

export function FullscreenOverlay({ preview, onClose }: FullscreenOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' ||
        event.key === 'Esc' ||
        event.code === 'Escape' ||
        event.keyCode === 27
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('keydown', handleKeydown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    containerRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
      document.removeEventListener('keydown', handleKeydown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (typeof document === 'undefined') {
    return null;
  }

  let content: ReactElement | null = null;

  if (preview.type === 'live') {
    content = (
      <iframe
        key={preview.url}
        src={preview.url}
        title={preview.title}
        className="h-full w-full border-0 bg-surface-raised"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; geolocation; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  } else {
    const tile = preview.tile;
    if (tile.kind === 'embed' || tile.kind === 'storybook') {
      if (tile.embedUrl) {
        content = (
          <iframe
            key={tile.embedUrl}
            src={tile.embedUrl}
            title={tile.title ?? preview.title}
            className="h-full w-full border-0 bg-surface-raised"
            loading="lazy"
            allow="autoplay; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-popups"
            allowFullScreen
          />
        );
      } else {
        content = null;
      }
    } else {
      content = tile.src ? (
        <img
          key={tile.src}
          src={tile.src}
          alt={tile.title ?? preview.title}
          className="h-full w-full object-contain"
        />
      ) : null;
    }
  }

  return createPortal(
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col catalog-fullscreen-backdrop text-inverse backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="flex h-full w-full flex-col gap-6 px-6 pb-6 pt-6" onClick={(event) => event.stopPropagation()}>
        <Navbar variant="overlay" onExitFullscreen={onClose} />
        <div className="relative flex-1 overflow-hidden rounded-3xl border catalog-fullscreen-frame">
          {content ?? (
            <div className="flex h-full w-full items-center justify-center px-6 text-center text-scale-sm catalog-fullscreen-message">
              Preview unavailable. Try opening the app preview in a new tab from the card instead.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function FullscreenIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="h-3.5 w-3.5"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.5 3H3v3.5M13.5 3H17v3.5M3 13.5V17h3.5M17 13.5V17h-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
