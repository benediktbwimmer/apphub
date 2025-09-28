import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScrollableListContainer } from '../ScrollableListContainer';

describe('ScrollableListContainer', () => {
  it('calls onLoadMore when scrolled near the bottom', () => {
    const handleLoadMore = vi.fn();
    const { getByTestId, rerender } = render(
      <ScrollableListContainer
        data-testid="scrollable"
        height={200}
        hasMore={false}
        onLoadMore={handleLoadMore}
        itemCount={10}
      >
        <div style={{ height: '1000px' }}>content</div>
      </ScrollableListContainer>
    );

    const container = getByTestId('scrollable');
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });

    rerender(
      <ScrollableListContainer
        data-testid="scrollable"
        height={200}
        hasMore
        onLoadMore={handleLoadMore}
        itemCount={10}
      >
        <div style={{ height: '1000px' }}>content</div>
      </ScrollableListContainer>
    );

    container.scrollTop = 820;
    fireEvent.scroll(container, { target: { scrollTop: 820 } });

    expect(handleLoadMore).toHaveBeenCalledTimes(1);
  });

  it('automatically loads more when content does not fill the container', async () => {
    const handleLoadMore = vi.fn();
    const { getByTestId } = render(
      <ScrollableListContainer
        data-testid="scrollable"
        height={200}
        hasMore
        onLoadMore={handleLoadMore}
        itemCount={1}
      >
        <div style={{ height: '120px' }}>content</div>
      </ScrollableListContainer>
    );

    const container = getByTestId('scrollable');
    Object.defineProperty(container, 'scrollHeight', { value: 120, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });

    await waitFor(() => {
      expect(handleLoadMore).toHaveBeenCalled();
    });
  });

  it('does not trigger onLoadMore when hasMore is false', () => {
    const handleLoadMore = vi.fn();
    const { getByTestId } = render(
      <ScrollableListContainer
        data-testid="scrollable"
        height={200}
        hasMore={false}
        onLoadMore={handleLoadMore}
        itemCount={10}
      >
        <div style={{ height: '1000px' }}>content</div>
      </ScrollableListContainer>
    );

    const container = getByTestId('scrollable');
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });

    container.scrollTop = 820;
    fireEvent.scroll(container, { target: { scrollTop: 820 } });

    expect(handleLoadMore).not.toHaveBeenCalled();
  });
});
