import { EventEmitter } from 'node:events';
import type { NodeRecord } from '../db/nodes';
import { publishFilestoreEvent } from './publisher';

export type CommandCompletedEvent = {
  command: string;
  journalId: number;
  backendMountId: number;
  nodeId: number | null;
  path: string;
  idempotencyKey?: string | null;
  principal?: string | null;
  node?: NodeRecord | null;
  result: Record<string, unknown>;
};

type FilestoreEventMap = {
  'command.completed': CommandCompletedEvent;
};

class TypedEventEmitter {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  on<T extends keyof FilestoreEventMap>(event: T, listener: (payload: FilestoreEventMap[T]) => void): void {
    this.emitter.on(event, listener as (arg: unknown) => void);
  }

  once<T extends keyof FilestoreEventMap>(event: T, listener: (payload: FilestoreEventMap[T]) => void): void {
    this.emitter.once(event, listener as (arg: unknown) => void);
  }

  off<T extends keyof FilestoreEventMap>(event: T, listener: (payload: FilestoreEventMap[T]) => void): void {
    this.emitter.off(event, listener as (arg: unknown) => void);
  }

  emit<T extends keyof FilestoreEventMap>(event: T, payload: FilestoreEventMap[T]): void {
    this.emitter.emit(event, payload);
  }
}

export const filestoreEvents = new TypedEventEmitter();

export function emitCommandCompleted(payload: CommandCompletedEvent): void {
  filestoreEvents.emit('command.completed', payload);
  void publishFilestoreEvent('filestore.command.completed', payload).catch((err) => {
    console.error('[filestore] failed to publish command.completed event', err);
  });
}
