function sanitizeIdentifier(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  return normalized.length > 0 ? normalized.toLowerCase() : 'value';
}

export function quoteIdentifier(value: string): string {
  return `\`${value.replace(/`/g, '``')}\``;
}

export function deriveTableName(datasetSlug: string, tableName: string): string {
  const datasetPart = sanitizeIdentifier(datasetSlug);
  const tablePart = sanitizeIdentifier(tableName);
  return `ts_${datasetPart}_${tablePart}`;
}

export function escapeStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function toDateTime64Literal(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    const iso = new Date(parsed).toISOString();
    const formatted = iso.replace('T', ' ').replace('Z', '');
    return `toDateTime64('${escapeStringLiteral(formatted)}', 3, 'UTC')`;
  }
  const fallback = value.replace('T', ' ').replace(/Z$/i, '');
  return `toDateTime64('${escapeStringLiteral(fallback)}', 3, 'UTC')`;
}
