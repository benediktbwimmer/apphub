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

  const lightSurfaceAlpha = scheme === 'dark' ? 0.92 : 0.98;
  const gutterAlpha = scheme === 'dark' ? 0.85 : 0.9;
  const lineHighlightAlpha = scheme === 'dark' ? 0.55 : 0.32;

  return {
    'editor.background': background,
    'editor.foreground': primaryText,
    'editor.lineHighlightBackground': withAlpha(accentMuted, lineHighlightAlpha),
    'editor.lineHighlightBorder': 'transparent',
    'editorLineNumber.foreground': withAlpha(mutedText, scheme === 'dark' ? 0.9 : 1),
    'editorLineNumber.activeForeground': accentDefault,
    'editorLineNumber.dimmedForeground': withAlpha(mutedText, 0.6),
    'editorCursor.foreground': accentDefault,
    'editor.selectionBackground': withAlpha(overlayPressed, 1),
    'editor.selectionHighlightBackground': withAlpha(overlayHover, 1),
    'editor.inactiveSelectionBackground': withAlpha(overlayHover, 1),
    'editor.findMatchBackground': withAlpha(accentDefault, scheme === 'dark' ? 0.4 : 0.3),
    'editor.findMatchHighlightBackground': withAlpha(accentDefault, scheme === 'dark' ? 0.25 : 0.18),
    'editor.wordHighlightBackground': withAlpha(accentDefault, scheme === 'dark' ? 0.25 : 0.18),
    'editor.wordHighlightStrongBackground': withAlpha(accentDefault, scheme === 'dark' ? 0.3 : 0.22),
    'editorBracketMatch.background': withAlpha(accentMuted, 0.8),
    'editorBracketMatch.border': accentEmphasis,
    'editorGutter.background': withAlpha(gutterBackground, gutterAlpha),
    'editorOverviewRuler.border': withAlpha(neutralBorder, 0.5),
    'editorOverviewRuler.selectionHighlightForeground': withAlpha(overlayPressed, 1),
    'editorOverviewRuler.addedForeground': withAlpha(success, 0.4),
    'editorOverviewRuler.deletedForeground': withAlpha(danger, 0.4),
    'editorOverviewRuler.modifiedForeground': withAlpha(info, 0.45),
    'editorOverviewRuler.errorForeground': withAlpha(danger, 0.6),
    'editorOverviewRuler.warningForeground': withAlpha(warning, 0.6),
    'editorMarkerNavigation.background': withAlpha(background, 0.95),
    'editorHoverWidget.background': withAlpha(raisedSurface, lightSurfaceAlpha),
    'editorHoverWidget.border': withAlpha(borderDefault, 0.7),
    'editorSuggestWidget.background': withAlpha(raisedSurface, lightSurfaceAlpha),
    'editorSuggestWidget.border': withAlpha(borderDefault, 0.7),
    'editorSuggestWidget.foreground': primaryText,
    'editorSuggestWidget.highlightForeground': accentDefault,
    'editorSuggestWidget.selectedBackground': withAlpha(overlayPressed, 1),
    'editorWidget.background': withAlpha(raisedSurface, lightSurfaceAlpha),
    'editorWidget.border': withAlpha(neutralBorder, 0.8),
    'editorWidget.foreground': primaryText,
    'editorCodeLens.foreground': withAlpha(mutedText, 0.85),
    'editorError.foreground': danger,
    'editorError.background': withAlpha(danger, scheme === 'dark' ? 0.25 : 0.18),
    'editorWarning.foreground': warning,
    'editorWarning.background': withAlpha(warning, scheme === 'dark' ? 0.22 : 0.16),
    'editorInfo.foreground': info,
    'editorInfo.background': withAlpha(info, scheme === 'dark' ? 0.18 : 0.12),
    'editorGutter.errorBackground': withAlpha(danger, scheme === 'dark' ? 0.35 : 0.25),
    'editorGutter.errorForeground': semantics.text.inverse,
    'editorGutter.warningBackground': withAlpha(warning, scheme === 'dark' ? 0.3 : 0.2),
    'editorGutter.warningForeground': semantics.text.inverse,
    'editorMarkerNavigationError.background': withAlpha(danger, scheme === 'dark' ? 0.3 : 0.22),
    'editorMarkerNavigationWarning.background': withAlpha(warning, scheme === 'dark' ? 0.28 : 0.2),
    'editorMarkerNavigationInfo.background': withAlpha(info, scheme === 'dark' ? 0.25 : 0.18),
    'editorIndentGuide.background': withAlpha(neutralBorder, 0.5),
    'editorIndentGuide.activeBackground': withAlpha(borderDefault, 0.7),
    'editorRuler.foreground': withAlpha(neutralBorder, 0.6),
    'scrollbarSlider.background': withAlpha(neutralBorder, 0.4),
    'scrollbarSlider.hoverBackground': withAlpha(borderDefault, 0.5),
    'scrollbarSlider.activeBackground': withAlpha(accentDefault, 0.6),
    'list.activeSelectionBackground': withAlpha(overlayPressed, 1),
    'list.hoverBackground': withAlpha(overlayHover, 1),
    'list.focusBackground': withAlpha(overlayHover, 1),
    'list.highlightForeground': accentDefault,
    'focusBorder': semantics.border.focus,
    'foreground': primaryText,
    'selection.background': withAlpha(overlayPressed, 1),
    'minimap.selectionHighlight': withAlpha(overlayPressed, 1),
    'minimapGutter.addedBackground': withAlpha(success, 0.75),
    'minimapGutter.deletedBackground': withAlpha(danger, 0.75),
    'minimapGutter.modifiedBackground': withAlpha(info, 0.75),
    'minimap.background': withAlpha(background, scheme === 'dark' ? 0.85 : 1),
    'diffEditor.insertedTextBackground': withAlpha(success, scheme === 'dark' ? 0.3 : 0.18),
    'diffEditor.insertedTextBorder': withAlpha(success, scheme === 'dark' ? 0.65 : 0.45),
    'diffEditor.removedTextBackground': withAlpha(danger, scheme === 'dark' ? 0.3 : 0.18),
    'diffEditor.removedTextBorder': withAlpha(danger, scheme === 'dark' ? 0.65 : 0.45),
    'diffEditor.diagonalFill': withAlpha(neutralBorder, 0.6)
  };
}

export function createMonacoTheme(theme: ThemeDefinition): MonacoThemeSpec {
  const base = theme.scheme === 'dark' ? 'vs-dark' : 'vs';
  const colors = createThemeColors(theme);

  const definition: editor.IStandaloneThemeData = {
    base,
    inherit: true,
    rules: [],
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

export function registerMonacoTheme(monaco: Monaco, spec: MonacoThemeSpec): void {
  const existing = registeredThemeSignatures.get(spec.id);
  if (existing === spec.signature) {
    return;
  }
  monaco.editor.defineTheme(spec.id, spec.definition);
  registeredThemeSignatures.set(spec.id, spec.signature);
}
