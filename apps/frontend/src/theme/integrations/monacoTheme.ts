import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { ThemeDefinition } from '@apphub/shared/designTokens';
import { withAlpha } from './color';

export interface MonacoThemeSpec {
  readonly id: string;
  readonly definition: editor.IStandaloneThemeData;
  readonly signature: string;
  readonly scheme: ThemeDefinition['scheme'];
}

function createThemeColors(theme: ThemeDefinition): Record<string, string> {
  const { semantics, scheme } = theme;
  const c = (value: string) => toMonacoColor(value);

  const background = semantics.surface.sunken;
  const gutterBackground = semantics.surface.canvasMuted;
  const raisedSurface = semantics.surface.raised;

  const mutedText = semantics.text.muted;
  const primaryText = semantics.text.primary;
  const accentDefault = semantics.accent.default;
  const accentMuted = semantics.accent.muted;
  const accentEmphasis = semantics.accent.emphasis;

  const neutralBorder = semantics.border.subtle;
  const borderDefault = semantics.border.default;

  const overlayHover = semantics.overlay.hover;
  const overlayPressed = semantics.overlay.pressed;

  const success = semantics.status.success;
  const danger = semantics.status.danger;
  const info = semantics.status.info;
  const warning = semantics.status.warning;

  // Lean on subtle overlays so monaco markers do not overpower the editor.
  const errorForeground = c(withAlpha(accentEmphasis, scheme === 'dark' ? 0.8 : 0.85));
  const errorBackground = c(withAlpha(accentMuted, scheme === 'dark' ? 0.3 : 0.24));
  const errorMarkerBackground = c(withAlpha(accentEmphasis, scheme === 'dark' ? 0.22 : 0.18));
  const errorBorder = c(withAlpha(accentEmphasis, scheme === 'dark' ? 0.9 : 0.92));
  const gutterErrorBackground = c(withAlpha(accentMuted, scheme === 'dark' ? 0.22 : 0.18));

  const lightSurfaceAlpha = scheme === 'dark' ? 0.92 : 0.98;
  const gutterAlpha = scheme === 'dark' ? 0.85 : 0.9;
  const lineHighlightAlpha = scheme === 'dark' ? 0.55 : 0.32;
  const selectionBackground = c(withAlpha(accentDefault, 0.32));
  const selectionHighlight = c(withAlpha(accentMuted, 0.28));

  return {
    'editor.background': c(background),
    'editor.foreground': c(primaryText),
    'editor.lineHighlightBackground': c(withAlpha(accentMuted, lineHighlightAlpha)),
    'editor.lineHighlightBorder': 'transparent',
    'editorLineNumber.foreground': c(withAlpha(mutedText, scheme === 'dark' ? 0.9 : 1)),
    'editorLineNumber.activeForeground': c(accentDefault),
    'editorLineNumber.dimmedForeground': c(withAlpha(mutedText, 0.6)),
    'editorCursor.foreground': c(accentDefault),
    'editor.selectionBackground': selectionBackground,
    'editor.selectionHighlightBackground': selectionHighlight,
    'editor.inactiveSelectionBackground': selectionHighlight,
    'editor.rangeHighlightBackground': c(withAlpha(accentMuted, scheme === 'dark' ? 0.28 : 0.22)),
    'editor.findMatchBackground': c(withAlpha(accentDefault, scheme === 'dark' ? 0.4 : 0.3)),
    'editor.findMatchHighlightBackground': c(withAlpha(accentDefault, scheme === 'dark' ? 0.25 : 0.18)),
    'editor.wordHighlightBackground': c(withAlpha(accentDefault, scheme === 'dark' ? 0.25 : 0.18)),
    'editor.wordHighlightStrongBackground': c(withAlpha(accentDefault, scheme === 'dark' ? 0.3 : 0.22)),
    'editorBracketMatch.background': c(withAlpha(accentMuted, 0.8)),
    'editorBracketMatch.border': c(accentEmphasis),
    'editorGutter.background': c(withAlpha(gutterBackground, gutterAlpha)),
    'editorOverviewRuler.border': c(withAlpha(neutralBorder, 0.5)),
    'editorOverviewRuler.selectionHighlightForeground': c(withAlpha(overlayPressed, 1)),
    'editorOverviewRuler.addedForeground': c(withAlpha(success, 0.4)),
    'editorOverviewRuler.deletedForeground': c(withAlpha(accentEmphasis, 0.38)),
    'editorOverviewRuler.modifiedForeground': c(withAlpha(info, 0.45)),
    'editorOverviewRuler.errorForeground': c(withAlpha(accentEmphasis, 0.38)),
    'editorOverviewRuler.warningForeground': c(withAlpha(warning, 0.6)),
    'editorMarkerNavigation.background': c(withAlpha(background, 0.95)),
    'editorHoverWidget.background': c(withAlpha(raisedSurface, lightSurfaceAlpha)),
    'editorHoverWidget.border': c(withAlpha(borderDefault, 0.7)),
    'editorSuggestWidget.background': c(withAlpha(raisedSurface, lightSurfaceAlpha)),
    'editorSuggestWidget.border': c(withAlpha(borderDefault, 0.7)),
    'editorSuggestWidget.foreground': c(primaryText),
    'editorSuggestWidget.highlightForeground': c(accentDefault),
    'editorSuggestWidget.selectedBackground': c(withAlpha(overlayPressed, 1)),
    'editorWidget.background': c(withAlpha(raisedSurface, lightSurfaceAlpha)),
    'editorWidget.border': c(withAlpha(neutralBorder, 0.8)),
    'editorWidget.foreground': c(primaryText),
    'editorCodeLens.foreground': c(withAlpha(mutedText, 0.85)),
    'editorError.foreground': errorForeground,
    'editorError.background': errorBackground,
    'editorError.border': errorBorder,
    'editorWarning.foreground': c(warning),
    'editorWarning.background': c(withAlpha(warning, scheme === 'dark' ? 0.22 : 0.16)),
    'editorInfo.foreground': c(info),
    'editorInfo.background': c(withAlpha(info, scheme === 'dark' ? 0.18 : 0.12)),
    'editorGutter.errorBackground': gutterErrorBackground,
    'editorGutter.errorForeground': errorForeground,
    'editorGutter.warningBackground': c(withAlpha(warning, scheme === 'dark' ? 0.3 : 0.2)),
    'editorGutter.warningForeground': c(semantics.text.inverse),
    'editorMarkerNavigationError.background': errorMarkerBackground,
    'editorMarkerNavigationWarning.background': c(withAlpha(warning, scheme === 'dark' ? 0.28 : 0.2)),
    'editorMarkerNavigationInfo.background': c(withAlpha(info, scheme === 'dark' ? 0.25 : 0.18)),
    'editorIndentGuide.background': c(withAlpha(neutralBorder, 0.5)),
    'editorIndentGuide.activeBackground': c(withAlpha(borderDefault, 0.7)),
    'editorRuler.foreground': c(withAlpha(neutralBorder, 0.6)),
    'scrollbarSlider.background': c(withAlpha(neutralBorder, 0.4)),
    'scrollbarSlider.hoverBackground': c(withAlpha(borderDefault, 0.5)),
    'scrollbarSlider.activeBackground': c(withAlpha(accentDefault, 0.6)),
    'list.activeSelectionBackground': c(withAlpha(overlayPressed, 1)),
    'list.hoverBackground': c(withAlpha(overlayHover, 1)),
    'list.focusBackground': c(withAlpha(overlayHover, 1)),
    'list.highlightForeground': c(accentDefault),
    'focusBorder': c(semantics.border.focus),
    'foreground': c(primaryText),
    'selection.background': c(withAlpha(overlayPressed, 1)),
    'minimap.selectionHighlight': c(withAlpha(overlayPressed, 1)),
    'minimapGutter.addedBackground': c(withAlpha(success, 0.75)),
    'minimapGutter.deletedBackground': c(withAlpha(danger, 0.75)),
    'minimapGutter.modifiedBackground': c(withAlpha(info, 0.75)),
    'minimap.background': c(withAlpha(background, scheme === 'dark' ? 0.85 : 1)),
    'diffEditor.insertedTextBackground': c(withAlpha(success, scheme === 'dark' ? 0.18 : 0.12)),
    'diffEditor.insertedTextBorder': c(withAlpha(success, scheme === 'dark' ? 0.35 : 0.24)),
    'diffEditor.removedTextBackground': c(withAlpha(danger, scheme === 'dark' ? 0.18 : 0.12)),
    'diffEditor.removedTextBorder': c(withAlpha(danger, scheme === 'dark' ? 0.35 : 0.24)),
    'diffEditor.diagonalFill': c(withAlpha(neutralBorder, 0.6))
  };
}

export function createMonacoTheme(theme: ThemeDefinition): MonacoThemeSpec {
  const base = theme.scheme === 'dark' ? 'vs-dark' : 'vs';
  const colors = createThemeColors(theme);
  const rules: editor.ITokenThemeRule[] = [];

  const keywordColor = toMonacoHex(theme.semantics.accent.emphasis);
  if (keywordColor) {
    rules.push({ token: 'keyword', foreground: keywordColor });
  }

  const definition: editor.IStandaloneThemeData = {
    base,
    inherit: true,
    rules,
    colors
  };

  const signature = JSON.stringify({ base, colors });

  return {
    id: theme.id,
    definition,
    signature,
    scheme: theme.scheme
  };
}

const registeredThemeSignatures = new Map<string, string>();

function toMonacoHex(color: string): string | undefined {
  const hex = color.trim();
  const match = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) {
    return undefined;
  }
  let value = match[1];
  if (value.length === 3) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('');
  }
  return value.toLowerCase();
}

function toMonacoColor(color: string): string {
  const trimmed = color.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'transparent') {
    return '#00000000';
  }

  const hexMatch = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    let value = hexMatch[1];
    if (value.length === 3) {
      value = value
        .split('')
        .map((char) => `${char}${char}`)
        .join('');
    }
    if (value.length === 6) {
      value = `${value}ff`;
    }
    return `#${value.toLowerCase()}`;
  }

  const rgbaMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((segment) => segment.trim());
    const [r, g, b] = parts.slice(0, 3).map((part) => Math.min(255, Math.max(0, Number.parseFloat(part))));
    const a = Math.min(1, Math.max(0, parts[3] === undefined ? 1 : Number.parseFloat(parts[3])));
    const toHex = (value: number) => value.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(Math.round(a * 255))}`;
  }

  return trimmed;
}

export function registerMonacoTheme(monaco: Monaco, spec: MonacoThemeSpec): void {
  const existing = registeredThemeSignatures.get(spec.id);
  if (existing === spec.signature) {
    return;
  }
  monaco.editor.defineTheme(spec.id, spec.definition);
  registeredThemeSignatures.set(spec.id, spec.signature);
}
