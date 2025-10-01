import classNames from 'classnames';
import { useEffect, useMemo, useState } from 'react';
import type { ThemeDefinition } from '@apphub/shared/designTokens';
import { useTheme, type ThemePreference } from '../theme';
import ThemeCustomizationPanel from './ThemeCustomizationPanel';
import {
  SETTINGS_HEADER_SUBTITLE_CLASSES,
  SETTINGS_HEADER_TITLE_CLASSES,
  SETTINGS_THEME_CARD_BASE,
  SETTINGS_THEME_CARD_SELECTED,
  SETTINGS_THEME_CARD_UNSELECTED,
  SETTINGS_THEME_OPTION_DESCRIPTION,
  SETTINGS_THEME_OPTION_LABEL,
  SETTINGS_THEME_PREVIEW_FRAME,
  SETTINGS_THEME_PREVIEW_LABEL,
  SETTINGS_THEME_PREVIEW_TILE,
  SETTINGS_THEME_PREVIEW_TILE_BORDER,
  SETTINGS_THEME_SELECTED_RING
} from './settingsTokens';

type ThemeOption = {
  readonly preference: ThemePreference;
  readonly label: string;
  readonly description: string;
  readonly theme?: ThemeDefinition;
};

const SYSTEM_OPTION: ThemeOption = {
  preference: 'system',
  label: 'Match system',
  description: 'Follow your operating system preference automatically.'
};

export default function ThemeSettingsPage() {
  const {
    availableThemes,
    preference,
    setPreference,
    theme,
    customThemes,
    saveCustomTheme,
    deleteCustomTheme
  } = useTheme();

  const [selectedThemeId, setSelectedThemeId] = useState<string>(theme.id);
  const [pendingThemeId, setPendingThemeId] = useState<string | null>(null);

  useEffect(() => {
    if (pendingThemeId) {
      const pendingExists = availableThemes.some((candidate) => candidate.id === pendingThemeId);
      if (pendingExists) {
        setSelectedThemeId(pendingThemeId);
        setPendingThemeId(null);
        return;
      }
    }

    const exists = availableThemes.some((candidate) => candidate.id === selectedThemeId);
    if (!exists && availableThemes.length > 0) {
      setSelectedThemeId(availableThemes[0].id);
    }
  }, [availableThemes, pendingThemeId, selectedThemeId]);

  const customThemeIds = useMemo(() => new Set(customThemes.map((item) => item.id)), [customThemes]);

  const options = useMemo<ThemeOption[]>(() => {
    const themedOptions = availableThemes.map((item) => ({
      preference: item.id,
      label: item.label,
      description: item.description ?? (item.scheme === 'dark' ? 'Optimised for low-light environments.' : 'Bright palette suited for daylight viewing.'),
      theme: item
    }));
    return [SYSTEM_OPTION, ...themedOptions];
  }, [availableThemes]);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className={SETTINGS_HEADER_TITLE_CLASSES}>Appearance</h2>
        <p className={classNames('max-w-3xl', SETTINGS_HEADER_SUBTITLE_CLASSES)}>
          Switch between AppHub themes or follow your operating system. Theme changes apply instantly across charts, graphs, editors, and navigation chrome.
        </p>
      </header>
      <fieldset className="flex flex-col gap-4" aria-label="Theme selector">
        <legend className="sr-only">Select theme</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {options.map((option) => (
            <ThemeOptionCard
              key={option.preference}
              option={option}
              isSelected={preference === option.preference}
              onSelect={setPreference}
              activeThemeId={theme.id}
            />
          ))}
        </div>
      </fieldset>

      <ThemeCustomizationPanel
        availableThemes={availableThemes}
        customThemeIds={customThemeIds}
        selectedThemeId={selectedThemeId}
        onSelectTheme={setSelectedThemeId}
        onThemeSaved={(id) => setPendingThemeId(id)}
        saveCustomTheme={saveCustomTheme}
        deleteCustomTheme={deleteCustomTheme}
        preference={preference}
        setPreference={setPreference}
      />
    </section>
  );
}

type ThemeOptionCardProps = {
  readonly option: ThemeOption;
  readonly isSelected: boolean;
  readonly onSelect: (preference: ThemePreference) => void;
  readonly activeThemeId: string;
};

function ThemeOptionCard({ option, isSelected, onSelect, activeThemeId }: ThemeOptionCardProps) {
  const { preference, label, description, theme } = option;
  const isActiveTheme = theme?.id === activeThemeId;

  return (
    <label
      className={classNames(
        SETTINGS_THEME_CARD_BASE,
        isSelected ? SETTINGS_THEME_CARD_SELECTED : SETTINGS_THEME_CARD_UNSELECTED,
        isSelected ? SETTINGS_THEME_SELECTED_RING : undefined
      )}
    >
      <input
        type="radio"
        name="theme-preference"
        value={preference}
        checked={isSelected}
        onChange={() => onSelect(preference)}
        className="sr-only"
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className={SETTINGS_THEME_OPTION_LABEL}>{label}</span>
          <span className={SETTINGS_THEME_OPTION_DESCRIPTION}>{description}</span>
        </div>
        {isSelected && <SelectedBadge />}
      </div>
      {theme ? <ThemeSwatch theme={theme} isActive={isActiveTheme} /> : <SystemSwatch />}
    </label>
  );
}

function ThemeSwatch({ theme, isActive }: { theme: ThemeDefinition; isActive: boolean }) {
  const surface = theme.semantics.surface;
  const text = theme.semantics.text;
  const accent = theme.semantics.accent;

  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className={SETTINGS_THEME_PREVIEW_LABEL}>Preview</span>
      <div className={SETTINGS_THEME_PREVIEW_FRAME}>
        <div
          className={classNames(
            SETTINGS_THEME_PREVIEW_TILE,
            isActive ? SETTINGS_THEME_SELECTED_RING : SETTINGS_THEME_PREVIEW_TILE_BORDER
          )}
          style={{
            background: surface.raised,
            color: text.primary
          }}
        >
          <div className={SETTINGS_THEME_OPTION_DESCRIPTION} style={{ color: text.muted }}>
            Navigation
          </div>
          <div className="mt-2 h-1.5 w-16 rounded-full" style={{ background: accent.default }} />
        </div>
        <div
          className="h-10 w-12 rounded-md border border-subtle"
          style={{ background: surface.canvas }}
        />
        <div
          className="h-10 w-12 rounded-md border border-subtle"
          style={{ background: surface.accent }}
        />
      </div>
    </div>
  );
}

function SystemSwatch() {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className={SETTINGS_THEME_PREVIEW_LABEL}>Preview</span>
      <div className={SETTINGS_THEME_PREVIEW_FRAME}>
        <div
          className={classNames(SETTINGS_THEME_PREVIEW_TILE, SETTINGS_THEME_PREVIEW_TILE_BORDER, 'bg-surface-glass')}
        >
          <span className={SETTINGS_THEME_OPTION_DESCRIPTION}>Follows system</span>
        </div>
        <div className="h-10 w-12 rounded-md border border-subtle bg-surface-glass" />
        <div className="h-10 w-12 rounded-md border border-subtle bg-surface-muted" />
      </div>
    </div>
  );
}

function SelectedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-scale-2xs font-weight-semibold text-on-accent">
      <CheckIcon /> Selected
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5 6.5 12 13 4" />
    </svg>
  );
}
