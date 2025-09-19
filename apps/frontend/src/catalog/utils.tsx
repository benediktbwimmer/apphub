import { Fragment } from 'react';
import type { AutocompleteContext, SearchParseResult, TagSuggestion } from './types';

export function parseSearchInput(input: string): SearchParseResult {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const tags: string[] = [];
  const textTokens: string[] = [];

  for (const token of tokens) {
    if (token.includes(':')) {
      tags.push(token);
    } else {
      textTokens.push(token);
    }
  }

  return {
    tags,
    text: textTokens.join(' ')
  };
}

export function computeAutocompleteContext(input: string): AutocompleteContext {
  if (!input) {
    return { base: '', activeToken: '' };
  }

  const match = input.match(/^(.*?)([^\s]*)$/);
  if (!match) {
    return { base: input, activeToken: '' };
  }
  const [, basePart, token] = match;
  return { base: basePart, activeToken: token };
}

export function applySuggestionToInput(current: string, suggestion: TagSuggestion): string {
  const { base } = computeAutocompleteContext(current);
  const completion = suggestion.type === 'pair' ? `${suggestion.label} ` : suggestion.label;
  const needsSpace = base.length > 0 && !base.endsWith(' ');
  return `${needsSpace ? `${base} ` : base}${completion}`;
}

export function formatDuration(durationMs: number | null) {
  if (durationMs === null || Number.isNaN(durationMs)) {
    return null;
  }
  if (durationMs < 1000) {
    return `${Math.max(durationMs, 0)} ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  const secondsPart = remainingSeconds > 0 ? `${remainingSeconds}s` : '';
  return `${minutes}m${secondsPart ? ` ${secondsPart}` : ''}`;
}

export function formatBytes(size: number) {
  if (!size || Number.isNaN(size)) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function escapeRegexToken(token: string) {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightSegments(
  text: string,
  tokens: string[],
  enabled: boolean
): Array<string | JSX.Element | null> | string {
  if (!enabled || tokens.length === 0) {
    return text;
  }
  const escaped = tokens.map(escapeRegexToken).filter(Boolean);
  if (escaped.length === 0) {
    return text;
  }
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const segments = text.split(regex);
  const tokenSet = new Set(tokens.map((token) => token.toLowerCase()));
  return segments.map((segment, index) => {
    if (!segment) {
      return null;
    }
    const lower = segment.toLowerCase();
    if (tokenSet.has(lower)) {
      return (
        <mark key={`match-${index}`}>{segment}</mark>
      );
    }
    return (
      <Fragment key={`text-${index}`}>{segment}</Fragment>
    );
  });
}

export function formatScore(value: number) {
  return value.toFixed(2);
}

export function formatNormalizedScore(value: number) {
  return value.toFixed(3);
}

export function formatWeight(value: number) {
  return value.toFixed(1);
}

export function formatFetchError(err: unknown, fallback: string, apiBaseUrl: string) {
  if (err instanceof Error) {
    const message = err.message ?? '';
    const lower = message.toLowerCase();
    const looksLikeNetworkIssue =
      err.name === 'TypeError' ||
      lower.includes('failed to fetch') ||
      lower.includes('networkerror') ||
      lower.includes('fetch failed') ||
      lower.includes('load failed');

    if (looksLikeNetworkIssue) {
      const base = apiBaseUrl.replace(/\/$/, '');
      return `${fallback}. Unable to reach the catalog API at ${base}. Start the API server (npm run dev:api) or set VITE_API_BASE_URL.`;
    }

    return message || fallback;
  }

  return fallback;
}
