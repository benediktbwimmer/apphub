function clampAlpha(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function parseHexChannel(segment: string): number {
  return parseInt(segment, 16);
}

function expandShortHex(hex: string): string {
  return hex
    .split('')
    .map((char) => `${char}${char}`)
    .join('');
}

function parseHexColor(hex: string): [number, number, number, number] | null {
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;

  if (normalized.length === 3) {
    const expanded = expandShortHex(normalized);
    const r = parseHexChannel(expanded.slice(0, 2));
    const g = parseHexChannel(expanded.slice(2, 4));
    const b = parseHexChannel(expanded.slice(4, 6));
    return [r, g, b, 1];
  }

  if (normalized.length === 4) {
    const expanded = expandShortHex(normalized);
    const r = parseHexChannel(expanded.slice(0, 2));
    const g = parseHexChannel(expanded.slice(2, 4));
    const b = parseHexChannel(expanded.slice(4, 6));
    const a = parseHexChannel(expanded.slice(6, 8)) / 255;
    return [r, g, b, a];
  }

  if (normalized.length === 6) {
    const r = parseHexChannel(normalized.slice(0, 2));
    const g = parseHexChannel(normalized.slice(2, 4));
    const b = parseHexChannel(normalized.slice(4, 6));
    return [r, g, b, 1];
  }

  if (normalized.length === 8) {
    const r = parseHexChannel(normalized.slice(0, 2));
    const g = parseHexChannel(normalized.slice(2, 4));
    const b = parseHexChannel(normalized.slice(4, 6));
    const a = parseHexChannel(normalized.slice(6, 8)) / 255;
    return [r, g, b, a];
  }

  return null;
}

function parseRgbColor(value: string): [number, number, number, number] | null {
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) {
    return null;
  }
  const parts = match[1].split(',').map((segment) => segment.trim());
  if (parts.length < 3) {
    return null;
  }

  const r = Number.parseFloat(parts[0]);
  const g = Number.parseFloat(parts[1]);
  const b = Number.parseFloat(parts[2]);

  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return null;
  }

  const alphaPart = parts[3];
  const a = alphaPart === undefined ? 1 : Number.parseFloat(alphaPart);
  if (Number.isNaN(a)) {
    return null;
  }

  return [r, g, b, clampAlpha(a)];
}

function formatRgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

export function withAlpha(color: string, alpha: number): string {
  const normalizedAlpha = clampAlpha(alpha);
  const trimmed = color.trim();

  if (trimmed === '') {
    return trimmed;
  }

  if (trimmed.toLowerCase() === 'transparent') {
    return formatRgba(0, 0, 0, normalizedAlpha);
  }

  const hex = parseHexColor(trimmed);
  if (hex) {
    const [r, g, b, existingAlpha] = hex;
    const compositeAlpha = clampAlpha(existingAlpha * normalizedAlpha);
    return formatRgba(r, g, b, compositeAlpha);
  }

  const rgb = parseRgbColor(trimmed);
  if (rgb) {
    const [r, g, b, existingAlpha] = rgb;
    const compositeAlpha = clampAlpha(existingAlpha * normalizedAlpha);
    return formatRgba(r, g, b, compositeAlpha);
  }

  if (trimmed.startsWith('var(')) {
    return `color-mix(in srgb, ${trimmed} ${normalizedAlpha * 100}%, transparent)`;
  }

  return trimmed;
}
