import type { ThemeDefinition } from '@apphub/shared/designTokens';
import type { WorkflowGraphCanvasNodeKind } from '../../workflows/graph/canvasModel';
import { withAlpha } from './color';

export type WorkflowGraphCanvasNodeTheme = {
  background: string;
  border: string;
  borderHighlighted: string;
  text: string;
  mutedText: string;
  badgeBackground: string;
  badgeText: string;
  shadow: string;
};

export type WorkflowGraphCanvasTheme = {
  surface: string;
  surfaceMuted: string;
  gridColor: string;
  edgeDefault: string;
  edgeMuted: string;
  edgeHighlight: string;
  edgeDashed: string;
  labelBackground: string;
  labelText: string;
  nodes: Record<WorkflowGraphCanvasNodeKind, WorkflowGraphCanvasNodeTheme>;
};

export type WorkflowGraphCanvasThemeOverrides = Partial<Omit<WorkflowGraphCanvasTheme, 'nodes'>> & {
  nodes?: Partial<Record<WorkflowGraphCanvasNodeKind, Partial<WorkflowGraphCanvasNodeTheme>>>;
};

type NodeColorConfig = {
  primary: string;
  secondary?: string;
  badgeText?: string;
};

const NODE_COLOR_TOKENS = (theme: ThemeDefinition): Record<WorkflowGraphCanvasNodeKind, NodeColorConfig> => ({
  workflow: {
    primary: theme.semantics.accent.default,
    secondary: theme.semantics.accent.emphasis,
    badgeText: theme.semantics.accent.onAccent
  },
  'step-job': {
    primary: theme.semantics.status.info,
    secondary: theme.semantics.text.accent,
    badgeText: theme.semantics.status.infoOn
  },
  'step-service': {
    primary: theme.semantics.status.success,
    secondary: theme.semantics.accent.default,
    badgeText: theme.semantics.status.successOn
  },
  'step-fanout': {
    primary: theme.semantics.status.warning,
    secondary: theme.semantics.status.danger,
    badgeText: theme.semantics.status.warningOn
  },
  'trigger-event': {
    primary: theme.semantics.accent.emphasis,
    secondary: theme.semantics.status.warning,
    badgeText: theme.semantics.accent.onAccent
  },
  'trigger-definition': {
    primary: theme.semantics.status.neutral,
    secondary: theme.semantics.accent.muted,
    badgeText: theme.semantics.status.neutralOn
  },
  schedule: {
    primary: theme.semantics.text.secondary,
    secondary: theme.semantics.status.info,
    badgeText: theme.semantics.text.inverse
  },
  asset: {
    primary: theme.semantics.status.danger,
    secondary: theme.semantics.status.warning,
    badgeText: theme.semantics.status.dangerOn
  },
  'event-source': {
    primary: theme.semantics.status.success,
    secondary: theme.semantics.accent.emphasis,
    badgeText: theme.semantics.status.successOn
  }
});

function createNodeTheme(
  scheme: ThemeDefinition['scheme'],
  tokens: NodeColorConfig,
  textPrimary: string,
  textMuted: string
): WorkflowGraphCanvasNodeTheme {
  const primary = tokens.primary;
  const secondary = tokens.secondary ?? tokens.primary;

  const backgroundStrong = scheme === 'dark' ? 0.4 : 0.2;
  const backgroundSoft = scheme === 'dark' ? 0.25 : 0.12;
  const borderAlpha = scheme === 'dark' ? 0.6 : 0.45;
  const badgeAlpha = scheme === 'dark' ? 0.38 : 0.24;
  const shadowAlpha = scheme === 'dark' ? 0.55 : 0.4;

  return {
    background: `linear-gradient(135deg, ${withAlpha(primary, backgroundStrong)}, ${withAlpha(secondary, backgroundSoft)})`,
    border: withAlpha(primary, borderAlpha),
    borderHighlighted: tokens.primary,
    text: textPrimary,
    mutedText: textMuted,
    badgeBackground: withAlpha(primary, badgeAlpha),
    badgeText: tokens.badgeText ?? textPrimary,
    shadow: `0 18px 40px -28px ${withAlpha(primary, shadowAlpha)}`
  } satisfies WorkflowGraphCanvasNodeTheme;
}

export function createWorkflowGraphTheme(theme: ThemeDefinition): WorkflowGraphCanvasTheme {
  const { semantics, scheme } = theme;
  const textPrimary = semantics.text.primary;
  const textMuted = semantics.text.muted;

  const surface = withAlpha(semantics.surface.raised, scheme === 'dark' ? 0.82 : 0.92);
  const surfaceMuted = withAlpha(semantics.surface.canvasMuted, scheme === 'dark' ? 0.68 : 0.82);
  const gridColor = withAlpha(semantics.border.subtle, scheme === 'dark' ? 0.45 : 0.55);
  const edgeDefault = semantics.border.default;
  const edgeMuted = withAlpha(semantics.border.subtle, scheme === 'dark' ? 0.5 : 0.45);
  const edgeHighlight = semantics.accent.default;
  const edgeDashed = semantics.accent.emphasis;
  const labelBackground = withAlpha(semantics.surface.raised, scheme === 'dark' ? 0.9 : 0.96);
  const labelText = textPrimary;

  const nodeTokens = NODE_COLOR_TOKENS(theme);
  const nodes = Object.fromEntries(
    (Object.keys(nodeTokens) as WorkflowGraphCanvasNodeKind[]).map((kind) => [
      kind,
      createNodeTheme(scheme, nodeTokens[kind], textPrimary, textMuted)
    ])
  ) as Record<WorkflowGraphCanvasNodeKind, WorkflowGraphCanvasNodeTheme>;

  return {
    surface,
    surfaceMuted,
    gridColor,
    edgeDefault,
    edgeMuted,
    edgeHighlight,
    edgeDashed,
    labelBackground,
    labelText,
    nodes
  };
}
