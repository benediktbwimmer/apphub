import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useEffect, useContext, type ReactNode } from 'react';
import { ThemeProvider, useTheme, type ThemePreference } from '../../theme';
import { generateThemeCss } from '../../theme/generateThemeCss';
import { createTheme, defaultThemeRegistry, foundation } from '@apphub/shared/designTokens';
import Navbar from '../Navbar';
import { PRIMARY_NAV_ITEMS } from '../../routes/paths';
import FormButton from '../form/FormButton';
import { Modal } from '../Modal';
import { ToastProvider } from '../toast/ToastProvider';
import { ToastContext, type ToastTone } from '../toast/ToastContext';

const themeCss = generateThemeCss({
  foundation,
  themes: defaultThemeRegistry,
  options: { defaultThemeId: 'apphub-light' }
});

beforeAll(() => {
  const style = document.createElement('style');
  style.setAttribute('data-testid', 'theme-css-test');
  style.textContent = themeCss;
  document.head.appendChild(style);
});

const highContrastTheme = createTheme({
  base: defaultThemeRegistry['apphub-dark'],
  id: 'tenant-high-contrast',
  label: 'Tenant High Contrast',
  overrides: {
    semantics: {
      surface: {
        canvas: '#050505',
        canvasMuted: '#0a0a0a',
        raised: '#090909',
        sunken: '#010101',
        accent: 'rgba(255, 255, 255, 0.12)',
        backdrop: 'rgba(0, 0, 0, 0.75)'
      },
      text: {
        primary: '#ffffff',
        secondary: '#d4d4d8',
        muted: '#a1a1aa',
        inverse: '#050505',
        accent: '#ff66ff',
        onAccent: '#050505',
        success: '#22ff88',
        warning: '#ffe066',
        danger: '#ff4d6d'
      },
      border: {
        subtle: 'rgba(255, 255, 255, 0.45)',
        default: '#d4d4d8',
        strong: '#ffffff',
        accent: '#ff66ff',
        focus: 'rgba(255, 255, 255, 0.7)',
        inverse: '#050505'
      },
      status: {
        info: '#4fc3f7',
        infoOn: '#012332',
        success: '#22ff88',
        successOn: '#002913',
        warning: '#ffe066',
        warningOn: '#332600',
        danger: '#ff4d6d',
        dangerOn: '#30010d',
        neutral: '#d4d4d8',
        neutralOn: '#050505'
      },
      overlay: {
        hover: 'rgba(255, 255, 255, 0.18)',
        pressed: 'rgba(255, 255, 255, 0.32)',
        scrim: 'rgba(0, 0, 0, 0.72)'
      },
      accent: {
        default: '#ff66ff',
        emphasis: '#ff99ff',
        muted: 'rgba(255, 102, 255, 0.24)',
        onAccent: '#050505'
      }
    }
  }
});

function renderWithTheme(children: ReactNode) {
  return render(
    <ThemeProvider themes={{ ...defaultThemeRegistry, [highContrastTheme.id]: highContrastTheme }}>
      {children}
    </ThemeProvider>
  );
}

function TriggerToast({ tone }: { tone: ToastTone }) {
  const ctx = useContext(ToastContext);
  useEffect(() => {
    ctx?.pushToast({ title: `${tone} toast`, tone, duration: 0 });
  }, [ctx, tone]);
  return null;
}

function PreferenceSetter({ themeId }: { themeId: ThemePreference }) {
  const { setPreference } = useTheme();
  useEffect(() => {
    setPreference(themeId);
  }, [setPreference, themeId]);
  return null;
}

function ThemeIdProbe() {
  const { theme } = useTheme();
  return <span data-testid="theme-id">{theme.id}</span>;
}

describe('Semantic theming primitives', () => {
  it('applies semantic classes to the active nav item across themes', async () => {
    const eventsNavItem = PRIMARY_NAV_ITEMS.find((item) => item.key === 'events');
    const initialPath = eventsNavItem?.path ?? PRIMARY_NAV_ITEMS[0]?.path ?? '/';
    const navLabel = eventsNavItem?.label ?? PRIMARY_NAV_ITEMS[0]?.label ?? 'Events';

    const { unmount } = renderWithTheme(
      <MemoryRouter initialEntries={[initialPath]}>
        <Navbar />
      </MemoryRouter>
    );
    const activeLinkLight = await screen.findByRole('link', { name: navLabel });
    expect(activeLinkLight.className).toContain('bg-accent');
    expect(activeLinkLight.className).toContain('text-on-accent');
    unmount();

    renderWithTheme(
      <MemoryRouter initialEntries={[initialPath]}>
        <Navbar />
      </MemoryRouter>
    );

    const activeLinkContrast = await screen.findByRole('link', { name: navLabel });
    expect(activeLinkContrast.className).toContain('bg-accent');
    expect(activeLinkContrast.className).toContain('text-on-accent');
  });

  it('renders FormButton variants with semantic token classes', () => {
    const { rerender } = renderWithTheme(
      <>
        <FormButton data-testid="primary" variant="primary">
          Create
        </FormButton>
        <FormButton data-testid="secondary" variant="secondary">
          Cancel
        </FormButton>
        <FormButton data-testid="tertiary" variant="tertiary">
          More
        </FormButton>
      </>
    );

    expect(screen.getByTestId('primary').className).toContain('bg-accent');
    expect(screen.getByTestId('primary').className).toContain('text-on-accent');
    expect(screen.getByTestId('primary').className).toContain('text-scale-sm');
    expect(screen.getByTestId('secondary').className).toContain('border-subtle');
    expect(screen.getByTestId('tertiary').className).toContain('bg-surface-glass-soft');

    rerender(
      <ThemeProvider themes={{ ...defaultThemeRegistry, [highContrastTheme.id]: highContrastTheme }}>
        <>
          <FormButton data-testid="primary" variant="primary">
            Create
          </FormButton>
          <FormButton data-testid="secondary" variant="secondary">
            Cancel
          </FormButton>
          <FormButton data-testid="tertiary" variant="tertiary">
            More
          </FormButton>
        </>
      </ThemeProvider>
    );

    expect(screen.getByTestId('primary').className).toContain('bg-accent');
  });

  it('switches to new dark themes and updates root attributes', async () => {
    renderWithTheme(
      <>
        <PreferenceSetter themeId="apphub-nebula" />
        <ThemeIdProbe />
        <FormButton data-testid="accent-button" variant="primary">
          Launch
        </FormButton>
      </>
    );

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('apphub-nebula');
    });
    expect(screen.getByTestId('theme-id').textContent).toBe('apphub-nebula');
    expect(document.documentElement.classList.contains('theme-apphub-nebula')).toBe(true);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    const computed = getComputedStyle(document.documentElement);
    expect(computed.getPropertyValue('--color-accent-default').trim()).toBe(
      defaultThemeRegistry['apphub-nebula']!.semantics.accent.default
    );
    expect(computed.getPropertyValue('--color-surface-canvas').trim()).toBe(
      defaultThemeRegistry['apphub-nebula']!.semantics.surface.canvas
    );
    expect(screen.getByTestId('accent-button').className).toContain('bg-accent');
  });

  it('uses semantic tokens for modal surfaces', () => {
    renderWithTheme(
      <Modal open labelledBy="modal-title">
        <div className="p-4 text-primary">
          <h2 id="modal-title" className="text-scale-lg font-weight-semibold">
            Token driven modal
          </h2>
        </div>
      </Modal>
    );

    const overlay = document.querySelector('.bg-overlay-scrim');
    expect(overlay).not.toBeNull();
    const content = document.querySelector('.bg-surface-raised');
    expect(content).not.toBeNull();
  });

  it('renders toast variants with status token utilities', async () => {
    renderWithTheme(
      <ToastProvider>
        <TriggerToast tone="success" />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/success toast/i)).toBeInTheDocument();
    });

    const toast = screen.getByText(/success toast/i).closest('div');
    expect(toast?.className).toContain('border-[color:var(--color-status-success)]');
    expect(toast?.className).toContain('bg-[color:color-mix');
  });
});
