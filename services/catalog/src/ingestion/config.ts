export const CLONE_DEPTH = process.env.INGEST_CLONE_DEPTH ?? '1';
export const MAX_INLINE_PREVIEW_BYTES = Number(
  process.env.INGEST_MAX_INLINE_PREVIEW_BYTES ?? 1_500_000
);
