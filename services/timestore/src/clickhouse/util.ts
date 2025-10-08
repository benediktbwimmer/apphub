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
  return `toDateTime64('${escapeStringLiteral(value)}', 3, 'UTC')`;
}
