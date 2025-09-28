import type { WorkflowEventCursor } from './db/types';

const CURSOR_VERSION = 'v1';

type EncodedCursor = {
  v: typeof CURSOR_VERSION;
  occurredAt: string;
  id: string;
};

function normalizeCursor(cursor: WorkflowEventCursor): EncodedCursor {
  return {
    v: CURSOR_VERSION,
    occurredAt: cursor.occurredAt,
    id: cursor.id
  };
}

export function encodeWorkflowEventCursor(cursor: WorkflowEventCursor): string {
  const payload = normalizeCursor(cursor);
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeWorkflowEventCursor(value: string): WorkflowEventCursor | null {
  if (!value) {
    return null;
  }
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<EncodedCursor> & Record<string, unknown>;
    const occurredAt = typeof parsed.occurredAt === 'string' ? parsed.occurredAt : null;
    const id = typeof parsed.id === 'string' ? parsed.id : null;
    const version = typeof parsed.v === 'string' ? parsed.v : CURSOR_VERSION;
    if (version !== CURSOR_VERSION) {
      return null;
    }
    if (!occurredAt || !id) {
      return null;
    }
    return { occurredAt, id } satisfies WorkflowEventCursor;
  } catch {
    return null;
  }
}
