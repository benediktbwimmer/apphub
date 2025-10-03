import { useEffect, useRef, type DependencyList } from 'react';
import { select, type Selection } from 'd3-selection';

export type D3RenderCallback<TElement extends Element> = (
  selection: Selection<TElement, unknown, null, undefined>
) => void | (() => void);

/**
 * Lightweight hook that bridges React lifecycle with D3 imperatively rendered charts.
 * The returned ref should be attached to an SVG or container element that D3 mutates.
 */
export function useD3<TElement extends Element>(
  render: D3RenderCallback<TElement>,
  dependencies: DependencyList
) {
  const ref = useRef<TElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return undefined;
    }
    const selection = select(ref.current) as Selection<TElement, unknown, null, undefined>;
    const cleanup = render(selection);
    return () => {
      if (typeof cleanup === 'function') {
        cleanup();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return ref;
}
