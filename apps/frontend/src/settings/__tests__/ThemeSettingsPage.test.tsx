import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import ThemeSettingsPage from '../ThemeSettingsPage';
import { ThemeProvider } from '../../theme';

describe('ThemeSettingsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    const root = document.documentElement;
    root.className = '';
    root.removeAttribute('data-theme');
  });

  function renderPage(options?: { storageKey?: string }) {
    const providerProps = options?.storageKey ? { storageKey: options.storageKey } : {};
    return render(
      <ThemeProvider {...providerProps}>
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

  it('allows duplicating and saving a custom theme to local storage', async () => {
    renderPage({ storageKey: 'test-theme' });

    const duplicateButton = screen.getByRole('button', { name: /Prep duplicate/i });
    await userEvent.click(duplicateButton);

    const idInput = screen.getByLabelText(/Theme id/i) as HTMLInputElement;
    await waitFor(() => {
      expect(idInput.value).toBe('apphub-light-variant');
    });

    const saveButton = screen.getByRole('button', { name: /Save theme/i });
    expect(saveButton).toBeEnabled();

    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(window.localStorage.getItem('test-theme::custom-themes')).toContain('apphub-light-variant');
    });

    const themeSelect = screen.getByLabelText(/Edit theme/i) as HTMLSelectElement;
    await waitFor(() => {
      expect(themeSelect.value).toBe('apphub-light-variant');
    });

    const customOption = screen.getByRole('option', { name: /AppHub Light Variant \(custom\)/i });
    expect(customOption).toBeDefined();
  });

  it('removes a saved custom theme when deleted', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage({ storageKey: 'delete-theme' });

    const duplicateButton = screen.getByRole('button', { name: /Prep duplicate/i });
    await userEvent.click(duplicateButton);

    const saveButton = screen.getByRole('button', { name: /Save theme/i });
    await userEvent.click(saveButton);

    const themeSelect = screen.getByLabelText(/Edit theme/i) as HTMLSelectElement;
    await waitFor(() => {
      expect(themeSelect.value).toBe('apphub-light-variant');
    });

    const deleteButton = screen.getByRole('button', { name: /Delete theme/i });
    expect(deleteButton).toBeEnabled();

    await userEvent.click(deleteButton);

    await waitFor(() => {
      expect(window.localStorage.getItem('delete-theme::custom-themes')).toBeNull();
    });

    confirmSpy.mockRestore();
  });
});
