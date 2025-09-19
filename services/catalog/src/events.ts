import { EventEmitter } from 'node:events';
import type { BuildRecord, IngestionEvent, LaunchRecord, RepositoryRecord } from './db';

export type ApphubEvent =
  | { type: 'repository.updated'; data: { repository: RepositoryRecord } }
  | { type: 'repository.ingestion-event'; data: { event: IngestionEvent } }
  | { type: 'build.updated'; data: { build: BuildRecord } }
  | { type: 'launch.updated'; data: { launch: LaunchRecord } };

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitApphubEvent(event: ApphubEvent) {
  bus.emit('apphub:event', event);
}

export function subscribeToApphubEvents(listener: (event: ApphubEvent) => void) {
  bus.on('apphub:event', listener);
  return () => bus.off('apphub:event', listener);
}

export function onceApphubEvent(listener: (event: ApphubEvent) => void) {
  bus.once('apphub:event', listener);
}
