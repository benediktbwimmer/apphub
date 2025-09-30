export type ColorRampStop = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export type ColorRamp = Readonly<Record<ColorRampStop, string>>;

export type PaletteName =
  | 'slate'
  | 'violet'
  | 'indigo'
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'emerald'
  | 'amber'
  | 'rose';

export type Palette = Readonly<Record<PaletteName, ColorRamp>>;

export type SpacingToken = 'none' | 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

export type SpacingScale = Readonly<Record<SpacingToken, string>>;

export type RadiusToken = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'pill' | 'full';

export type RadiusScale = Readonly<Record<RadiusToken, string>>;

export type ShadowToken = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'focus';

export type ShadowScale = Readonly<Record<ShadowToken, string>>;

export interface TypographyTokens {
  readonly fontFamily: {
    readonly sans: string;
    readonly mono: string;
  };
  readonly fontSize: Readonly<Record<'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'display' | 'hero', string>>;
  readonly fontWeight: Readonly<Record<'regular' | 'medium' | 'semibold' | 'bold', number>>;
  readonly lineHeight: Readonly<Record<'tight' | 'snug' | 'normal' | 'relaxed', string>>;
  readonly letterSpacing: Readonly<Record<'tight' | 'normal' | 'wide' | 'wider', string>>;
}

export interface DesignTokenFoundation {
  readonly palette: Palette;
  readonly typography: TypographyTokens;
  readonly spacing: SpacingScale;
  readonly radius: RadiusScale;
  readonly shadow: ShadowScale;
}

export type ThemeScheme = 'light' | 'dark';

export interface SemanticSurfaceTokens {
  readonly canvas: string;
  readonly canvasMuted: string;
  readonly raised: string;
  readonly sunken: string;
  readonly accent: string;
  readonly backdrop: string;
}

export interface SemanticTextTokens {
  readonly primary: string;
  readonly secondary: string;
  readonly muted: string;
  readonly inverse: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
}

export interface SemanticBorderTokens {
  readonly subtle: string;
  readonly default: string;
  readonly strong: string;
  readonly accent: string;
  readonly focus: string;
  readonly inverse: string;
}

export interface SemanticStatusTokens {
  readonly info: string;
  readonly infoOn: string;
  readonly success: string;
  readonly successOn: string;
  readonly warning: string;
  readonly warningOn: string;
  readonly danger: string;
  readonly dangerOn: string;
  readonly neutral: string;
  readonly neutralOn: string;
}

export interface SemanticOverlayTokens {
  readonly hover: string;
  readonly pressed: string;
  readonly scrim: string;
}

export interface SemanticAccentTokens {
  readonly default: string;
  readonly emphasis: string;
  readonly muted: string;
  readonly onAccent: string;
}

export interface SemanticColorTokens {
  readonly surface: SemanticSurfaceTokens;
  readonly text: SemanticTextTokens;
  readonly border: SemanticBorderTokens;
  readonly status: SemanticStatusTokens;
  readonly overlay: SemanticOverlayTokens;
  readonly accent: SemanticAccentTokens;
}

export interface ThemeMetadata {
  readonly version?: string;
  readonly author?: string;
  readonly source?: 'system' | 'tenant' | 'user';
  readonly tags?: readonly string[];
}

export interface ThemeDefinition {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly scheme: ThemeScheme;
  readonly semantics: SemanticColorTokens;
  readonly typography: TypographyTokens;
  readonly spacing: SpacingScale;
  readonly radius: RadiusScale;
  readonly shadow: ShadowScale;
  readonly metadata?: ThemeMetadata;
}

export type ThemeOverride = DeepPartial<Omit<ThemeDefinition, 'id'>> & { readonly id?: never };

export interface CreateThemeOptions {
  readonly base: ThemeDefinition;
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly scheme?: ThemeScheme;
  readonly overrides?: ThemeOverride;
}

export type ThemeRegistry = Readonly<Record<string, ThemeDefinition>>;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: any) => any
    ? T[K]
    : T[K] extends ReadonlyArray<infer U>
      ? ReadonlyArray<DeepPartial<U>>
      : T[K] extends object
        ? DeepPartial<T[K]>
        : T[K];
};
