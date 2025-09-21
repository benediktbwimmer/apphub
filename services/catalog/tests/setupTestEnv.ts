process.env.APPHUB_EVENTS_MODE = 'inline';
process.env.REDIS_URL = 'inline';
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}
