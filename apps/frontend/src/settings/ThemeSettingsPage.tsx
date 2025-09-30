import { useEffect, useMemo, useState } from 'react';
import type { ThemeDefinition } from '@apphub/shared/designTokens';
import { useTheme, type ThemePreference } from '../theme';
import ThemeCustomizationPanel from './ThemeCustomizationPanel';

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
        <h2 className="text-xl font-semibold text-[var(--color-text-primary, #0f172a)]">Appearance</h2>
        <p className="max-w-3xl text-sm text-[var(--color-text-muted, #475569)]">
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
      className={`group relative flex cursor-pointer flex-col gap-3 rounded-2xl border p-4 transition-all duration-200 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 ${
        isSelected
          ? 'border-transparent shadow-[0_12px_32px_-18px_rgba(124,58,237,0.45)] outline-violet-500'
          : 'border-[var(--color-border-subtle,#e2e8f0)] hover:border-[var(--color-border-default,#cbd5f5)]'
      }`}
      style={{
        background: 'var(--color-surface-raised, rgba(255,255,255,0.85))',
        color: 'var(--color-text-primary, #0f172a)'
      }}
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
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-xs text-[var(--color-text-muted,#64748b)]">{description}</span>
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
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94a3b8)]">
        Preview
      </span>
      <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--color-border-subtle,#cbd5f5)] bg-[var(--color-surface-sunken,#f1f5f9)] p-2">
        <div
          className="flex-1 rounded-lg p-3"
          style={{
            background: surface.raised,
            color: text.primary,
            boxShadow: isActive
              ? '0 0 0 2px rgba(124, 58, 237, 0.45)'
              : '0 0 0 1px rgba(148, 163, 184, 0.45)'
          }}
        >
          <div className="text-xs font-semibold" style={{ color: text.muted }}>
            Navigation
          </div>
          <div className="mt-2 h-1.5 w-16 rounded-full" style={{ background: accent.default }} />
        </div>
        <div
          className="h-10 w-12 rounded-md"
          style={{
            background: surface.canvas,
            boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.35)'
          }}
        />
        <div
          className="h-10 w-12 rounded-md"
          style={{
            background: surface.accent,
            boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.25)'
          }}
        />
      </div>
    </div>
  );
}

function SystemSwatch() {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94a3b8)]">
        Preview
      </span>
      <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--color-border-subtle,#cbd5f5)] bg-[var(--color-surface-sunken,#f1f5f9)] p-2">
        <div className="flex-1 rounded-lg bg-gradient-to-r from-[rgba(255,255,255,0.9)] to-[rgba(148,163,184,0.25)] p-3 text-xs font-semibold text-[var(--color-text-secondary,#475569)]">
          Follows system
        </div>
        <div className="h-10 w-12 rounded-md bg-gradient-to-br from-[rgba(15,23,42,0.85)] to-[rgba(88,28,135,0.45)]" />
        <div className="h-10 w-12 rounded-md bg-gradient-to-br from-[rgba(248,250,252,0.95)] to-[rgba(148,163,184,0.35)]" />
      </div>
    </div>
  );
}

function SelectedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-default,#7c3aed)] px-2 py-1 text-[11px] font-semibold text-[var(--color-accent-onAccent,#f5f3ff)]">
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
