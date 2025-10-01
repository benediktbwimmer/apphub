export function formatSummary(summary: string): string {
  return summary.trim() || 'No core metadata summary available.';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'unknown size';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTokenCount(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined) {
    return 'tokens unavailable';
  }
  return `${tokens} token${tokens === 1 ? '' : 's'}`;
}
