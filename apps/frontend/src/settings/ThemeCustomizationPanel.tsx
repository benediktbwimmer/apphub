import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MAX_THEME_SCALE, MIN_THEME_SCALE } from '@apphub/shared/designTokens';
import type { ThemeDefinition } from '@apphub/shared/designTokens';
import type { ThemePreference } from '../theme';
import {
  generateThemeId,
  radiusTokens,
  semanticTokenGroups,
  shadowTokens,
  spacingTokens,
  typographySections,
  useThemeDraft,
  type ThemeDraft,
  type ThemeTokenGroupMeta,
  type ThemeTokenMeta
} from './themeEditor';

interface ThemeCustomizationPanelProps {
  readonly availableThemes: readonly ThemeDefinition[];
  readonly customThemeIds: ReadonlySet<string>;
  readonly selectedThemeId: string;
  readonly onSelectTheme: (themeId: string) => void;
  readonly onThemeSaved: (themeId: string) => void;
  readonly saveCustomTheme: (theme: ThemeDefinition) => void;
  readonly deleteCustomTheme: (themeId: string) => void;
  readonly preference: ThemePreference;
  readonly setPreference: (preference: ThemePreference) => void;
}

export default function ThemeCustomizationPanel({
  availableThemes,
  customThemeIds,
  selectedThemeId,
  onSelectTheme,
  onThemeSaved,
  saveCustomTheme,
  deleteCustomTheme,
  preference,
  setPreference
}: ThemeCustomizationPanelProps) {
  const selectedTheme = useMemo(() => {
    return (
      availableThemes.find((item) => item.id === selectedThemeId) ?? availableThemes[0]
    );
  }, [availableThemes, selectedThemeId]);

  const existingIds = useMemo(() => availableThemes.map((theme) => theme.id), [availableThemes]);
  const isCustomTheme = customThemeIds.has(selectedTheme.id);

  const {
    draft,
    validation,
    isDirty,
    setId,
    setLabel,
    setDescription,
    setScheme,
    setMetadataAuthor,
    setMetadataVersion,
    setMetadataTags,
    setScale,
    updateSemantic,
    updateTypography,
    updateSpacing,
    updateRadius,
    updateShadow,
    reset,
    toThemeDefinition
  } = useThemeDraft(selectedTheme, {
    existingIds,
    originalId: isCustomTheme ? selectedTheme.id : undefined
  });

  const errorMap = useMemo(() => {
    const entries = validation.errors.map((error) => [error.path, error.message] as const);
    return new Map(entries);
  }, [validation.errors]);

  const [tagInput, setTagInput] = useState(draft.metadata.tags.join(', '));

  useEffect(() => {
    setTagInput(draft.metadata.tags.join(', '));
  }, [draft.metadata.tags]);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [showValidationSummary, setShowValidationSummary] = useState(false);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setStatusMessage(null);
    }, 2400);

    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  const handleSave = () => {
    if (!validation.isValid) {
      setShowValidationSummary(true);
      return;
    }

    const nextTheme = toThemeDefinition();
    saveCustomTheme(nextTheme);
    onThemeSaved(nextTheme.id);
    setStatusMessage('Theme saved to this browser.');
    setShowValidationSummary(false);
  };

  const handleSaveAsVariant = () => {
    const variantLabel = `${draft.label || selectedTheme.label} Variant`;
    const candidateId = generateThemeId(variantLabel, existingIds);
    setId(candidateId);
    setLabel(variantLabel);
    setDescription(draft.description || selectedTheme.description || '');
  };

  const handleApply = () => {
    const targetId = draft.id.trim();
    if (targetId.length === 0) {
      setShowValidationSummary(true);
      return;
    }
    if (!existingIds.includes(targetId)) {
      setStatusMessage('Save the theme before applying it.');
      setShowValidationSummary(true);
      return;
    }
    setPreference(targetId as ThemePreference);
    setStatusMessage('Theme applied across the workspace.');
  };

  const handleDelete = () => {
    if (!isCustomTheme) {
      return;
    }
    const confirmDelete = window.confirm('This removes the custom theme from this browser. Continue?');
    if (!confirmDelete) {
      return;
    }
    deleteCustomTheme(selectedTheme.id);
    const fallback = availableThemes.find((item) => item.id !== selectedTheme.id);
    if (fallback) {
      onSelectTheme(fallback.id);
    }
    setStatusMessage('Theme removed.');
  };

  const hasValidationErrors = validation.errors.length > 0;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary,#0f172a)]">
              Theme designer
            </h3>
            <p className="text-sm text-[var(--color-text-muted,#475569)]">
              Modify semantic tokens, typography, spacing, and shadows for any theme. Saved themes live in local storage for this browser.
            </p>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-text-muted,#64748b)]">
              Edit theme
              <select
                className="rounded-lg border border-[var(--color-border-subtle,#e2e8f0)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary,#0f172a)] shadow-sm focus:border-[var(--color-accent-default,#7c3aed)] focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.25)]"
                value={selectedTheme.id}
                onChange={(event) => onSelectTheme(event.target.value)}
              >
                {availableThemes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                    {customThemeIds.has(item.id) ? ' (custom)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rounded-lg border border-[var(--color-border-subtle,#e2e8f0)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary,#0f172a)] shadow-sm transition hover:border-[var(--color-accent-default,#7c3aed)] hover:text-[var(--color-accent-default,#7c3aed)]"
              onClick={handleSaveAsVariant}
            >
              Prep duplicate
            </button>
          </div>
        </div>
        {statusMessage && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle,#cbd5f5)] bg-[var(--color-surface-raised,#ffffff)] px-3 py-2 text-xs text-[var(--color-text-muted,#475569)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-accent-default,#7c3aed)]" aria-hidden="true" />
            {statusMessage}
          </div>
        )}
        {showValidationSummary && hasValidationErrors && (
          <p className="rounded-lg border border-[var(--color-status-danger,#fca5a5)] bg-[rgba(254,226,226,0.65)] px-3 py-2 text-xs text-[var(--color-status-danger,#b91c1c)]">
            Please fix the highlighted fields before saving.
          </p>
        )}
      </header>

      <GeneralSection
        draft={draft}
        errorMap={errorMap}
        tagInput={tagInput}
        onIdChange={setId}
        onLabelChange={setLabel}
        onDescriptionChange={setDescription}
        onSchemeChange={setScheme}
        onScaleChange={setScale}
        onAuthorChange={setMetadataAuthor}
        onVersionChange={setMetadataVersion}
        onTagsChange={(value) => {
          setTagInput(value);
          setMetadataTags(value);
        }}
      />

      <TokenSections
        draft={draft}
        errorMap={errorMap}
        onSemanticChange={updateSemantic}
        onTypographyChange={updateTypography}
        onSpacingChange={updateSpacing}
        onRadiusChange={updateRadius}
        onShadowChange={updateShadow}
      />

      <ActionRow
        canDelete={isCustomTheme}
        canSave={validation.isValid && isDirty}
        isDirty={isDirty}
        onSave={handleSave}
        onDelete={handleDelete}
        onApply={handleApply}
        onReset={() => reset(selectedTheme)}
        preference={preference}
        draft={draft}
      />
    </section>
  );
}

interface GeneralSectionProps {
  readonly draft: ThemeDraft;
  readonly errorMap: Map<string, string>;
  readonly tagInput: string;
  readonly onIdChange: (id: string) => void;
  readonly onLabelChange: (label: string) => void;
  readonly onDescriptionChange: (description: string) => void;
  readonly onSchemeChange: (scheme: ThemeDraft['scheme']) => void;
  readonly onScaleChange: (scale: number) => void;
  readonly onAuthorChange: (author: string) => void;
  readonly onVersionChange: (version: string) => void;
  readonly onTagsChange: (tags: string) => void;
}

function GeneralSection({
  draft,
  errorMap,
  tagInput,
  onIdChange,
  onLabelChange,
  onDescriptionChange,
  onSchemeChange,
  onScaleChange,
  onAuthorChange,
  onVersionChange,
  onTagsChange
}: GeneralSectionProps) {
  const idError = errorMap.get('id');
  const labelError = errorMap.get('label');
  const scaleError = errorMap.get('scale');

  return (
    <section className="rounded-2xl border border-[var(--color-border-subtle,#e2e8f0)] bg-[var(--color-surface-raised,#ffffff)] p-5 shadow-sm">
      <h4 className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted,#64748b)]">
        General
      </h4>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <LabeledField label="Theme id" error={idError}>
          <input
            className="w-full rounded-lg border border-[var(--color-border-subtle,#cbd5f5)] px-3 py-2 text-sm text-[var(--color-text-primary,#0f172a)] shadow-inner focus:border-[var(--color-accent-default,#7c3aed)] focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.18)]"
            value={draft.id}
            onChange={(event) => onIdChange(event.target.value)}
            placeholder="tenant-dark"
          />
        </LabeledField>
        <LabeledField label="Display name" error={labelError}>
          <input
            className="w-full rounded-lg border border-[var(--color-border-subtle,#cbd5f5)] px-3 py-2 text-sm text-[var(--color-text-primary,#0f172a)] shadow-inner focus:border-[var(--color-accent-default,#7c3aed)] focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.18)]"
            value={draft.label}
            onChange={(event) => onLabelChange(event.target.value)}
            placeholder="Tenant brand dark"
          />
        </LabeledField>
        <LabeledField label="Scheme">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary,#0f172a)]">
              <input
                type="radio"
                name="theme-scheme"
                value="light"
                checked={draft.scheme === 'light'}
                onChange={() => onSchemeChange('light')}
              />
              Light
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary,#0f172a)]">
              <input
                type="radio"
                name="theme-scheme"
                value="dark"
                checked={draft.scheme === 'dark'}
                onChange={() => onSchemeChange('dark')}
              />
              Dark
            </label>
          </div>
        </LabeledField>
        <LabeledField label="Scale" error={scaleError ?? undefined}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={MIN_THEME_SCALE}
              max={MAX_THEME_SCALE}
              step={0.05}
              value={draft.scale}
              onChange={(event) => onScaleChange(event.target.valueAsNumber)}
              className="h-2 w-full cursor-pointer rounded-full bg-[var(--color-border-subtle,#e2e8f0)] accent-[var(--color-accent-default,#7c3aed)]"
            />
            <span className="w-14 text-right text-sm font-medium text-[var(--color-text-primary,#0f172a)]">
              {(draft.scale * 100).toFixed(0)}%
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted,#64748b)]">
            Shrink the workspace to fit more on screen (navbar excluded).
          </p>
        </LabeledField>
        <LabeledField label="Description">
          <textarea
            className="min-h-[72px] w-full rounded-lg border border-[var(--color-border-subtle,#cbd5f5)] px-3 py-2 text-sm text-[var(--color-text-primary,#0f172a)] shadow-inner focus:border-[var(--color-accent-default,#7c3aed)] focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.18)]"
            value={draft.description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="Visible in settings menus and share dialogs."
          />
        </LabeledField>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <LabeledField label="Author">
          <input
            className="w-full rounded-lg border border-[var(--color-border-subtle,#cbd5f5)] px-3 py-2 text-sm text-[var(--color-text-primary,#0f172a)] shadow-inner focus:border-[var(--color-accent-default,#7c3aed)] focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.18)]"
            value={draft.metadata.author}
            onChange={(event) => onAuthorChange(event.target.value)}
            placeholder="Your name or team"
          />
        </LabeledField>
        <LabeledField label="Version">
          <input
            className="w-full rounded-lg border border-[var(--color-border-subtle,#cbd5f5)] px-3 py-2 text-sm text-[var(--color-text-primary,#0f172a)] shadow-inner focus:border-[var(--color-accent-default,#7c3aed)] focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.18)]"
            value={draft.metadata.version}
            onChange={(event) => onVersionChange(event.target.value)}
            placeholder="1.0.0"
          />
        </LabeledField>
        <LabeledField label="Tags">
          <input
            className="w-full rounded-lg border border-[var(--color-border-subtle,#cbd5f5)] px-3 py-2 text-sm text-[var(--color-text-primary,#0f172a)] shadow-inner focus:border-[var(--color-accent-default,#7c3aed)] focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.18)]"
            value={tagInput}
            onChange={(event) => onTagsChange(event.target.value)}
            placeholder="dark, accessibility, marketing"
          />
        </LabeledField>
      </div>
    </section>
  );
}

interface TokenSectionsProps {
  readonly draft: ThemeDraft;
  readonly errorMap: Map<string, string>;
  readonly onSemanticChange: (section: keyof ThemeDraft['semantics'], token: string, value: string) => void;
  readonly onTypographyChange: (section: keyof ThemeDraft['typography'], token: string, value: string) => void;
  readonly onSpacingChange: (token: string, value: string) => void;
  readonly onRadiusChange: (token: string, value: string) => void;
  readonly onShadowChange: (token: string, value: string) => void;
}

function TokenSections({
  draft,
  errorMap,
  onSemanticChange,
  onTypographyChange,
  onSpacingChange,
  onRadiusChange,
  onShadowChange
}: TokenSectionsProps) {
  return (
    <div className="flex flex-col gap-4">
      <TokenAccordion title="Semantic colors">
        {semanticTokenGroups.map((group) => (
          <TokenGroup
            key={group.key}
            group={group}
            values={draft.semantics[group.key as keyof ThemeDraft['semantics']] as Record<string, string>}
            errorMap={errorMap}
            onChange={(token, value) => onSemanticChange(group.key as keyof ThemeDraft['semantics'], token, value)}
          />
        ))}
      </TokenAccordion>
      <TokenAccordion title="Typography">
        {typographySections.map((group) => (
          <TokenGroup
            key={group.key}
            group={group}
            values={draft.typography[group.key as keyof ThemeDraft['typography']] as Record<string, unknown>}
            errorMap={errorMap}
            onChange={(token, value) => onTypographyChange(group.key as keyof ThemeDraft['typography'], token, value)}
          />
        ))}
      </TokenAccordion>
      <TokenAccordion title="Spacing">
        <TokenList
          tokens={spacingTokens}
          values={draft.spacing as Record<string, string>}
          errorMap={errorMap}
          onChange={onSpacingChange}
        />
      </TokenAccordion>
      <TokenAccordion title="Radius">
        <TokenList
          tokens={radiusTokens}
          values={draft.radius as Record<string, string>}
          errorMap={errorMap}
          onChange={onRadiusChange}
        />
      </TokenAccordion>
      <TokenAccordion title="Shadow">
        <TokenList
          tokens={shadowTokens}
          values={draft.shadow as Record<string, string>}
          errorMap={errorMap}
          onChange={onShadowChange}
        />
      </TokenAccordion>
    </div>
  );
}

interface TokenGroupProps {
  readonly group: ThemeTokenGroupMeta;
  readonly values: Record<string, unknown>;
  readonly errorMap: Map<string, string>;
  readonly onChange: (token: string, value: string) => void;
}

function TokenGroup({ group, values, errorMap, onChange }: TokenGroupProps) {
  return (
    <section className="rounded-xl border border-[var(--color-border-subtle,#e2e8f0)] bg-[var(--color-surface-sunken,#f8fafc)] p-4">
      <div className="flex flex-col gap-1">
        <h5 className="text-sm font-semibold text-[var(--color-text-primary,#0f172a)]">{group.label}</h5>
        {group.description && (
          <p className="text-xs text-[var(--color-text-muted,#64748b)]">{group.description}</p>
        )}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {group.tokens.map((token) => (
          <TokenInput
            key={token.key}
            token={token}
            value={String(values[token.key] ?? '')}
            error={errorMap.get(`semantics.${group.key}.${token.key}`) ?? errorMap.get(`typography.${group.key}.${token.key}`)}
            onChange={(next) => onChange(token.key, next)}
          />
        ))}
      </div>
    </section>
  );
}

interface TokenListProps {
  readonly tokens: readonly ThemeTokenMeta[];
  readonly values: Record<string, string>;
  readonly errorMap: Map<string, string>;
  readonly onChange: (token: string, value: string) => void;
}

function TokenList({ tokens, values, errorMap, onChange }: TokenListProps) {
  return (
    <section className="rounded-xl border border-[var(--color-border-subtle,#e2e8f0)] bg-[var(--color-surface-sunken,#f8fafc)] p-4">
      <div className="grid gap-3 lg:grid-cols-2">
        {tokens.map((token) => (
          <TokenInput
            key={token.key}
            token={token}
            value={String(values[token.key] ?? '')}
            error={errorMap.get(`spacing.${token.key}`) ?? errorMap.get(`radius.${token.key}`) ?? errorMap.get(`shadow.${token.key}`)}
            onChange={(next) => onChange(token.key, next)}
          />
        ))}
      </div>
    </section>
  );
}

interface TokenInputProps {
  readonly token: ThemeTokenMeta;
  readonly value: string;
  readonly error?: string;
  readonly onChange: (value: string) => void;
}

function TokenInput({ token, value, error, onChange }: TokenInputProps) {
  const supportsColorPicker = token.kind !== 'number' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
  const isNumberField = token.kind === 'number';

  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted,#64748b)]">
        {token.label}
      </span>
      <div className="flex items-center gap-3">
        {supportsColorPicker ? (
          <input
            type="color"
            aria-label={`${token.label} color`}
            className="h-9 w-9 cursor-pointer overflow-hidden rounded-lg border border-[var(--color-border-subtle,#cbd5f5)] bg-white"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <span
            className="h-9 w-9 rounded-lg border border-[var(--color-border-subtle,#cbd5f5)]"
            style={{ background: value || '#ffffff' }}
            aria-hidden="true"
          />
        )}
        {isNumberField ? (
          <input
            type="number"
            className={`w-full rounded-lg border border-[var(--color-border-subtle,#cbd5f5)] px-3 py-2 text-sm text-[var(--color-text-primary,#0f172a)] shadow-inner focus:border-[var(--color-accent-default,#7c3aed)] focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.18)] ${error ? 'border-[var(--color-status-danger,#f87171)]' : ''}`}
            value={value && !Number.isNaN(Number(value)) ? Number(value) : ''}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            className={`w-full rounded-lg border border-[var(--color-border-subtle,#cbd5f5)] px-3 py-2 text-sm text-[var(--color-text-primary,#0f172a)] shadow-inner focus:border-[var(--color-accent-default,#7c3aed)] focus:outline-none focus:ring-2 focus:ring-[rgba(124,58,237,0.18)] ${error ? 'border-[var(--color-status-danger,#f87171)]' : ''}`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </div>
      {error && <span className="text-xs text-[var(--color-status-danger,#b91c1c)]">{error}</span>}
    </label>
  );
}

interface ActionRowProps {
  readonly canDelete: boolean;
  readonly canSave: boolean;
  readonly isDirty: boolean;
  readonly onSave: () => void;
  readonly onDelete: () => void;
  readonly onApply: () => void;
  readonly onReset: () => void;
  readonly preference: ThemePreference;
  readonly draft: ThemeDraft;
}

function ActionRow({
  canDelete,
  canSave,
  isDirty,
  onSave,
  onDelete,
  onApply,
  onReset,
  preference,
  draft
}: ActionRowProps) {
  const isApplied = preference === draft.id;

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
            canSave
              ? 'bg-[var(--color-accent-default,#7c3aed)] hover:bg-[var(--color-accent-emphasis,#5b21b6)]'
              : 'cursor-not-allowed bg-[var(--color-border-subtle,#cbd5f5)] text-[var(--color-text-muted,#64748b)]'
          }`}
        >
          Save theme
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={!isDirty}
          className={`inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition ${
            isDirty
              ? 'border-[var(--color-border-default,#cbd5f5)] text-[var(--color-text-primary,#0f172a)] hover:border-[var(--color-accent-default,#7c3aed)] hover:text-[var(--color-accent-default,#7c3aed)]'
              : 'cursor-not-allowed border-[var(--color-border-subtle,#e2e8f0)] text-[var(--color-text-muted,#94a3b8)]'
          }`}
        >
          Reset changes
        </button>
        <button
          type="button"
          onClick={onApply}
          className={`inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition ${
            isApplied
              ? 'border-[var(--color-accent-default,#7c3aed)] text-[var(--color-accent-default,#7c3aed)]'
              : 'border-[var(--color-border-default,#cbd5f5)] text-[var(--color-text-primary,#0f172a)] hover:border-[var(--color-accent-default,#7c3aed)] hover:text-[var(--color-accent-default,#7c3aed)]'
          }`}
          disabled={draft.id.trim().length === 0}
        >
          {isApplied ? 'Active theme' : 'Apply theme'}
        </button>
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete}
        className={`inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition ${
          canDelete
            ? 'border-[rgba(248,113,113,0.4)] text-[var(--color-status-danger,#b91c1c)] hover:border-[var(--color-status-danger,#ef4444)] hover:text-[var(--color-status-danger,#ef4444)]'
            : 'cursor-not-allowed border-[var(--color-border-subtle,#e2e8f0)] text-[var(--color-text-muted,#94a3b8)]'
        }`}
      >
        Delete theme
      </button>
    </div>
  );
}

interface TokenAccordionProps {
  readonly title: string;
  readonly children: ReactNode;
}

function TokenAccordion({ title, children }: TokenAccordionProps) {
  return (
    <details className="overflow-hidden rounded-2xl border border-[var(--color-border-subtle,#e2e8f0)] bg-[var(--color-surface-raised,#ffffff)]" open>
      <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-[var(--color-text-primary,#0f172a)] outline-none">
        {title}
      </summary>
      <div className="border-t border-[var(--color-border-subtle,#e2e8f0)] px-5 py-4">{children}</div>
    </details>
  );
}

interface LabeledFieldProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly error?: string;
}

function LabeledField({ label, children, error }: LabeledFieldProps) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted,#64748b)]">
        {label}
      </span>
      {children}
      {error && <span className="text-xs text-[var(--color-status-danger,#b91c1c)]">{error}</span>}
    </label>
  );
}
