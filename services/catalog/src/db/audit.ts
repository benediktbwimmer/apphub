import { getPool } from './client';
import type { AuditLogCreateInput } from './types';

export async function recordAuditLog(entry: AuditLogCreateInput): Promise<void> {
  const pool = getPool();
  const scopesJson = JSON.stringify(entry.scopes ?? []);
  const metadataJson = entry.metadata === undefined || entry.metadata === null ? null : JSON.stringify(entry.metadata);
  await pool.query(
    `INSERT INTO audit_logs (
       actor,
       actor_type,
       token_hash,
       scopes,
       action,
       resource,
       status,
       ip,
       user_agent,
       metadata
     ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb)`
      ,
    [
      entry.actor ?? null,
      entry.actorType ?? null,
      entry.tokenHash ?? null,
      scopesJson,
      entry.action,
      entry.resource,
      entry.status,
      entry.ip ?? null,
      entry.userAgent ?? null,
      metadataJson
    ]
  );
}
