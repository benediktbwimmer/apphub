import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import ThemeSettingsPage from '../ThemeSettingsPage';
import { ThemeProvider } from '../../theme';

describe('ThemeSettingsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    const root = document.documentElement;
    root.className = '';
    root.removeAttribute('data-theme');
  });

  function renderPage() {
    return render(
      <ThemeProvider>
        <ThemeSettingsPage />
      </ThemeProvider>
    );
  }

  it('selects Match system by default', async () => {
    renderPage();

    const systemOption = screen.getByLabelText(/Match system/i) as HTMLInputElement;
    expect(systemOption.checked).toBe(true);

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('apphub-light');
    });
  });

  it('updates the active theme when selecting AppHub Dark', async () => {
    renderPage();

    const darkOption = screen.getByLabelText(/AppHub Dark/i);
    await userEvent.click(darkOption);

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('apphub-dark');
    });
    expect(window.localStorage.getItem('apphub.theme-preference')).toBe('apphub-dark');

    const systemOption = screen.getByLabelText(/Match system/i);
    await userEvent.click(systemOption);

    await waitFor(() => {
      expect(window.localStorage.getItem('apphub.theme-preference')).toBe('system');
    });
  });
});
