import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { createServicesTableMigration } from './001_create_services_table';

type Migration = {
  id: string;
  run: (db: BetterSqlite3Database) => void;
};

const migrations: Migration[] = [createServicesTableMigration];

export function migrateIfNeeded(db: BetterSqlite3Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[];
  const applied = new Set(appliedRows.map((row) => row.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    db.transaction(() => {
      migration.run(db);
      const appliedAt = new Date().toISOString();
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(migration.id, appliedAt);
    })();
  }
}
