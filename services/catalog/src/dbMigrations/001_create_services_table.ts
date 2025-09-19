import type { Database as BetterSqlite3Database } from 'better-sqlite3';
export const createServicesTableMigration = {
  id: '001_create_services_table',
  run(db: BetterSqlite3Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        base_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        status_message TEXT,
        capabilities TEXT,
        metadata TEXT,
        last_healthy_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_services_kind
        ON services(kind);

      CREATE INDEX IF NOT EXISTS idx_services_status
        ON services(status);
    `);

  }
};
