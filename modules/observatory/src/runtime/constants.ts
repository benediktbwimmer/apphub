const DEFAULT_KEY_FALLBACK = 'observatory-event-driven-s3';
const envDefaultKey = (process.env.OBSERVATORY_FILESTORE_DEFAULT_KEY ?? '').trim();

export const DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY =
  envDefaultKey.length > 0 ? envDefaultKey : DEFAULT_KEY_FALLBACK;
