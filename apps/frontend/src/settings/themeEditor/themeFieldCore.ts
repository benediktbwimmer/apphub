export interface ThemeTokenMeta {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly kind?: 'color' | 'text' | 'number';
}

export interface ThemeTokenGroupMeta {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly kind?: 'color' | 'text' | 'number';
  readonly tokens: readonly ThemeTokenMeta[];
}

export const semanticTokenGroups: readonly ThemeTokenGroupMeta[] = [
  {
    key: 'surface',
    label: 'Surface',
    description: 'Background layers, panels, and elevated regions.',
    kind: 'color',
    tokens: [
      { key: 'canvas', label: 'Canvas' },
      { key: 'canvasMuted', label: 'Canvas muted' },
      { key: 'raised', label: 'Raised surface' },
      { key: 'sunken', label: 'Sunken surface' },
      { key: 'accent', label: 'Accent surface' },
      { key: 'backdrop', label: 'Backdrop overlay' }
    ]
  },
  {
    key: 'text',
    label: 'Text',
    description: 'Primary and contextual typography colors.',
    kind: 'color',
    tokens: [
      { key: 'primary', label: 'Primary' },
      { key: 'secondary', label: 'Secondary' },
      { key: 'muted', label: 'Muted' },
      { key: 'inverse', label: 'Inverse' },
      { key: 'accent', label: 'Accent' },
      { key: 'onAccent', label: 'On accent' },
      { key: 'success', label: 'Success' },
      { key: 'warning', label: 'Warning' },
      { key: 'danger', label: 'Danger' }
    ]
  },
  {
    key: 'border',
    label: 'Border',
    description: 'Divider, outline, and focus treatments.',
    kind: 'color',
    tokens: [
      { key: 'subtle', label: 'Subtle' },
      { key: 'default', label: 'Default' },
      { key: 'strong', label: 'Strong' },
      { key: 'accent', label: 'Accent' },
      { key: 'focus', label: 'Focus' },
      { key: 'inverse', label: 'Inverse' }
    ]
  },
  {
    key: 'status',
    label: 'Status',
    description: 'Feedback states for toasts, banners, and badges.',
    kind: 'color',
    tokens: [
      { key: 'info', label: 'Info' },
      { key: 'infoOn', label: 'On info' },
      { key: 'success', label: 'Success' },
      { key: 'successOn', label: 'On success' },
      { key: 'warning', label: 'Warning' },
      { key: 'warningOn', label: 'On warning' },
      { key: 'danger', label: 'Danger' },
      { key: 'dangerOn', label: 'On danger' },
      { key: 'neutral', label: 'Neutral' },
      { key: 'neutralOn', label: 'On neutral' }
    ]
  },
  {
    key: 'overlay',
    label: 'Overlay',
    description: 'Hover, pressed, and screen overlays.',
    tokens: [
      { key: 'hover', label: 'Hover', kind: 'text' },
      { key: 'pressed', label: 'Pressed', kind: 'text' },
      { key: 'scrim', label: 'Scrim', kind: 'text' }
    ]
  },
  {
    key: 'accent',
    label: 'Accent',
    description: 'Primary accent colors used for CTAs and highlights.',
    kind: 'color',
    tokens: [
      { key: 'default', label: 'Default' },
      { key: 'emphasis', label: 'Emphasis' },
      { key: 'muted', label: 'Muted' },
      { key: 'onAccent', label: 'On accent' }
    ]
  }
] as const;

export const typographySections = [
  {
    key: 'fontFamily',
    label: 'Font family',
    description: 'Primary font stacks for UI and code.',
    tokens: [
      { key: 'sans', label: 'Sans serif stack' },
      { key: 'mono', label: 'Monospace stack' }
    ]
  },
  {
    key: 'fontSize',
    label: 'Font size',
    description: 'Font sizing scale expressed as CSS lengths.',
    tokens: [
      { key: 'xs', label: 'XS' },
      { key: 'sm', label: 'SM' },
      { key: 'md', label: 'MD' },
      { key: 'lg', label: 'LG' },
      { key: 'xl', label: 'XL' },
      { key: '2xl', label: '2XL' },
      { key: 'display', label: 'Display' },
      { key: 'hero', label: 'Hero' }
    ]
  },
  {
    key: 'fontWeight',
    label: 'Font weight',
    description: 'Numerical font weights for the type scale.',
    tokens: [
      { key: 'regular', label: 'Regular', kind: 'number' },
      { key: 'medium', label: 'Medium', kind: 'number' },
      { key: 'semibold', label: 'Semibold', kind: 'number' },
      { key: 'bold', label: 'Bold', kind: 'number' }
    ]
  },
  {
    key: 'lineHeight',
    label: 'Line height',
    description: 'Line heights matched to the typography scale.',
    tokens: [
      { key: 'tight', label: 'Tight' },
      { key: 'snug', label: 'Snug' },
      { key: 'normal', label: 'Normal' },
      { key: 'relaxed', label: 'Relaxed' }
    ]
  },
  {
    key: 'letterSpacing',
    label: 'Letter spacing',
    description: 'Tracking adjustments for headings and overlines.',
    tokens: [
      { key: 'tight', label: 'Tight' },
      { key: 'normal', label: 'Normal' },
      { key: 'wide', label: 'Wide' },
      { key: 'wider', label: 'Wider' }
    ]
  }
] as const satisfies readonly ThemeTokenGroupMeta[];

export const spacingTokens: readonly ThemeTokenMeta[] = [
  { key: 'none', label: 'None' },
  { key: 'xxs', label: 'XXS' },
  { key: 'xs', label: 'XS' },
  { key: 'sm', label: 'SM' },
  { key: 'md', label: 'MD' },
  { key: 'lg', label: 'LG' },
  { key: 'xl', label: 'XL' },
  { key: '2xl', label: '2XL' },
  { key: '3xl', label: '3XL' }
] as const;

export const radiusTokens: readonly ThemeTokenMeta[] = [
  { key: 'none', label: 'None' },
  { key: 'xs', label: 'XS' },
  { key: 'sm', label: 'SM' },
  { key: 'md', label: 'MD' },
  { key: 'lg', label: 'LG' },
  { key: 'xl', label: 'XL' },
  { key: 'pill', label: 'Pill' },
  { key: 'full', label: 'Full' }
] as const;

export const shadowTokens: readonly ThemeTokenMeta[] = [
  { key: 'none', label: 'None' },
  { key: 'xs', label: 'XS' },
  { key: 'sm', label: 'SM' },
  { key: 'md', label: 'MD' },
  { key: 'lg', label: 'LG' },
  { key: 'xl', label: 'XL' },
  { key: 'focus', label: 'Focus ring' }
] as const;
