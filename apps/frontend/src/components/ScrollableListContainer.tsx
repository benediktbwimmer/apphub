import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type UIEvent
} from 'react';
import { Spinner } from './Spinner';

type PromiseLikeVoid = void | Promise<void>;

type ScrollableListContainerProps = {
  children: ReactNode;
  height?: number | string;
  threshold?: number;
  hasMore?: boolean;
  isLoading?: boolean;
  onLoadMore?: () => PromiseLikeVoid;
  itemCount?: number;
  loaderLabel?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'onScroll'>;

function isPromise(value: PromiseLikeVoid): value is Promise<void> {
  return Boolean(value) && typeof (value as Promise<void>).then === 'function';
}

export function ScrollableListContainer({
  children,
  className,
  style,
  height = 320,
  threshold = 64,
  hasMore = false,
  isLoading = false,
  onLoadMore,
  itemCount,
  loaderLabel = 'Loading more…',
  ...rest
}: ScrollableListContainerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef(false);
  const resolvedHeight = useMemo(() => (typeof height === 'number' ? `${height}px` : height), [height]);
  const rootStyle = useMemo(() => ({
    maxHeight: resolvedHeight,
    ...style
  }), [resolvedHeight, style]);

  useEffect(() => {
    if (!isLoading) {
      pendingRef.current = false;
    }
  }, [isLoading]);

  const handleLoadMore = useCallback(() => {
    if (!onLoadMore || pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    const result = onLoadMore();
    if (isPromise(result)) {
      void result.finally(() => {
        pendingRef.current = false;
      });
    } else {
      pendingRef.current = false;
    }
  }, [onLoadMore]);

  const maybeLoadMore = useCallback(
    (target: HTMLElement) => {
      if (!onLoadMore || !hasMore || isLoading) {
        return;
      }
      const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (distanceToBottom <= threshold) {
        handleLoadMore();
      }
    },
    [handleLoadMore, hasMore, isLoading, onLoadMore, threshold]
  );

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      maybeLoadMore(event.currentTarget);
    },
    [maybeLoadMore]
  );

  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoading) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const distanceToBottom = container.scrollHeight - container.clientHeight;
    if (distanceToBottom <= threshold) {
      handleLoadMore();
    }
  }, [handleLoadMore, hasMore, isLoading, itemCount, onLoadMore, threshold]);

  const containerClassName = useMemo(
    () =>
      ['relative', 'overflow-y-auto', 'overscroll-contain', className]
        .filter(Boolean)
        .join(' '),
    [className]
  );

  return (
    <div
      {...rest}
      ref={containerRef}
      className={containerClassName}
      style={rootStyle}
      onScroll={handleScroll}
    >
      {children}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 text-scale-xs text-muted">
          <Spinner size="xs" label={loaderLabel} />
        </div>
      )}
    </div>
  );
}
