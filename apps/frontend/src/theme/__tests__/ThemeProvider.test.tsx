import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import { ThemeProvider, useTheme } from '../ThemeProvider';

function ThemeConsumer() {
  const { themeId, preference, setPreference } = useTheme();
  return (
    <div className="flex flex-col gap-2">
      <span data-testid="theme-id">{themeId}</span>
      <span data-testid="theme-preference">{preference}</span>
      <button type="button" onClick={() => setPreference('apphub-dark')}>
        Activate dark
      </button>
      <button type="button" onClick={() => setPreference('system')}>
        Follow system
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    const root = document.documentElement;
    root.className = '';
    root.removeAttribute('data-theme');
  });

  it('applies the default theme on mount', async () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('apphub-light');
    });
    expect(document.documentElement.classList.contains('theme-apphub-light')).toBe(true);
    expect(screen.getByTestId('theme-id')).toHaveTextContent('apphub-light');
    expect(screen.getByTestId('theme-preference')).toHaveTextContent('system');
  });

  it('persists explicit theme selections', async () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    );

    await userEvent.click(screen.getByText('Activate dark'));

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('apphub-dark');
    });

    expect(window.localStorage.getItem('apphub.theme-preference')).toBe('apphub-dark');
    expect(screen.getByTestId('theme-id')).toHaveTextContent('apphub-dark');

    await userEvent.click(screen.getByText('Follow system'));

    await waitFor(() => {
      expect(screen.getByTestId('theme-preference')).toHaveTextContent('system');
    });
    expect(window.localStorage.getItem('apphub.theme-preference')).toBe('system');
  });
});
