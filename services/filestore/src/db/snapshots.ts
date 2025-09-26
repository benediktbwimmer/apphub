import type { PoolClient } from 'pg';
import type { NodeRecord } from './nodes';

export async function recordSnapshot(client: PoolClient, node: NodeRecord): Promise<void> {
  await client.query(
    `INSERT INTO snapshots (
       node_id,
       version,
       captured_at,
       state,
       size_bytes,
       checksum,
       content_hash,
       path,
       metadata
     ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (node_id, version) DO NOTHING`,
    [
      node.id,
      node.version,
      node.state,
      node.sizeBytes,
      node.checksum,
      node.contentHash,
      node.path,
      JSON.stringify(node.metadata ?? {})
    ]
  );
}
