export interface ClickHouseMockStoreKey {
  datasetSlug: string;
  tableName: string;
}

type MockRow = Record<string, unknown>;

const mockTables = new Map<string, MockRow[]>();

function buildTableKey(key: ClickHouseMockStoreKey): string {
  return `${key.datasetSlug}::${key.tableName}`;
}

function cloneRow(row: MockRow): MockRow {
  return JSON.parse(JSON.stringify(row));
}

export function isClickHouseMockEnabled(settings?: { host: string }): boolean {
  if (process.env.TIMESTORE_CLICKHOUSE_MOCK === 'true') {
    return true;
  }
  if (settings?.host && settings.host.trim().toLowerCase() === 'inline') {
    return true;
  }
  return false;
}

export function resetClickHouseMockStore(): void {
  mockTables.clear();
}

export function recordMockInsert(
  key: ClickHouseMockStoreKey,
  rows: MockRow[]
): void {
  const tableKey = buildTableKey(key);
  const existing = mockTables.get(tableKey) ?? [];
  for (const row of rows) {
    existing.push(cloneRow(row));
  }
  mockTables.set(tableKey, existing);
}

export function getMockTableRows(
  key: ClickHouseMockStoreKey
): MockRow[] {
  const tableKey = buildTableKey(key);
  const rows = mockTables.get(tableKey);
  if (!rows || rows.length === 0) {
    return [];
  }
  return rows.map((row) => cloneRow(row));
}
