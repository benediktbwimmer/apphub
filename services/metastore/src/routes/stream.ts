import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { ensureScope } from './helpers';
import { hasScope } from '../auth/identity';
import {
  formatRecordStreamComment,
  formatRecordStreamEventFrame,
  getRecordStreamSubscriberCount,
  subscribeToRecordStream,
  type RecordStreamEvent
} from '../events/recordStream';

const HEARTBEAT_INTERVAL_MS = 15000;
const SSE_RETRY_MS = 5000;
const SSE_RATE_LIMIT_CAPACITY = 200;
const SSE_RATE_LIMIT_INTERVAL_MS = 1000;
const SSE_MAX_QUEUE_SIZE = 1000;

type SseDispatcher = {
  sendEvent: (event: RecordStreamEvent) => void;
  sendComment: (comment: string) => void;
  close: () => void;
};

type WritableLike = NodeJS.WritableStream & {
  once: NodeJS.WritableStream['once'];
};

function createSseDispatcher(stream: WritableLike): SseDispatcher {
  let tokens = SSE_RATE_LIMIT_CAPACITY;
  const queue: string[] = [];
  let draining = false;
  let trimmed = 0;
  let dropNoticePending = false;

  const onDrain = () => {
    draining = false;
    flush();
  };

  const refillTimer = setInterval(() => {
    tokens = SSE_RATE_LIMIT_CAPACITY;
    flush();
  }, SSE_RATE_LIMIT_INTERVAL_MS);
  if (typeof refillTimer.unref === 'function') {
    refillTimer.unref();
  }

  const flush = () => {
    if (draining) {
      return;
    }

    if (dropNoticePending && tokens > 0) {
      const frame = formatRecordStreamComment(`rate_limited ${trimmed} events trimmed`);
      trimmed = 0;
      dropNoticePending = false;
      tokens -= 1;
      const ok = stream.write(frame);
      if (!ok) {
        draining = true;
        stream.once('drain', onDrain);
        return;
      }
    }

    while (queue.length > 0 && tokens > 0 && !draining) {
      const frame = queue.shift()!;
      tokens -= 1;
      const ok = stream.write(frame);
      if (!ok) {
        draining = true;
        stream.once('drain', onDrain);
      }
    }
  };

  const enqueue = (frame: string) => {
    if (!draining && tokens > 0 && queue.length === 0 && !dropNoticePending) {
      tokens -= 1;
      const ok = stream.write(frame);
      if (!ok) {
        draining = true;
        stream.once('drain', onDrain);
      }
      return;
    }

    queue.push(frame);
    if (queue.length > SSE_MAX_QUEUE_SIZE) {
      const overflow = queue.length - SSE_MAX_QUEUE_SIZE;
      queue.splice(0, overflow);
      trimmed += overflow;
      dropNoticePending = true;
    }
    flush();
  };

  return {
    sendEvent: (event) => {
      enqueue(formatRecordStreamEventFrame(event));
    },
    sendComment: (comment) => {
      enqueue(formatRecordStreamComment(comment));
    },
    close: () => {
      clearInterval(refillTimer);
      if (typeof (stream as unknown as NodeJS.EventEmitter).removeListener === 'function') {
        (stream as unknown as NodeJS.EventEmitter).removeListener('drain', onDrain);
      }
      queue.length = 0;
    }
  };
}

function withMetrics(app: FastifyInstance, updater: () => void): void {
  if (!app.metrics.enabled) {
    return;
  }
  updater();
}

function updateStreamMetrics(app: FastifyInstance, transport: 'sse' | 'websocket' | 'total', value: number): void {
  withMetrics(app, () => {
    app.metrics.recordStreamSubscribers.labels(transport).set(value);
  });
}

function refreshSubscriberMetrics(app: FastifyInstance, sseConnections: number, wsConnections: number): void {
  const total = getRecordStreamSubscriberCount();
  updateStreamMetrics(app, 'sse', sseConnections);
  updateStreamMetrics(app, 'websocket', wsConnections);
  updateStreamMetrics(app, 'total', total);
}

export async function registerStreamRoutes(app: FastifyInstance): Promise<void> {
  let sseConnections = 0;
  let websocketConnections = 0;

  const httpHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!ensureScope(request, reply, 'metastore:read')) {
      return;
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    if (typeof reply.raw.flushHeaders === 'function') {
      reply.raw.flushHeaders();
    }

    reply.hijack();
    reply.raw.write(`retry: ${SSE_RETRY_MS}\n\n`);
    reply.raw.write(formatRecordStreamComment('connected'));

    sseConnections += 1;
    refreshSubscriberMetrics(app, sseConnections, websocketConnections);

    const dispatcher = createSseDispatcher(reply.raw);
    const unsubscribe = subscribeToRecordStream((event) => {
      try {
        dispatcher.sendEvent(event);
      } catch (err) {
        request.log.warn({ err }, 'Failed to dispatch metastore record SSE payload');
      }
    });

    const heartbeat = setInterval(() => {
      try {
        dispatcher.sendComment('ping');
      } catch (err) {
        request.log.warn({ err }, 'Failed to emit record stream heartbeat');
      }
    }, HEARTBEAT_INTERVAL_MS);

    if (typeof heartbeat.unref === 'function') {
      heartbeat.unref();
    }

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      clearInterval(heartbeat);
      dispatcher.close();
      unsubscribe();
      if (sseConnections > 0) {
        sseConnections -= 1;
      }
      refreshSubscriberMetrics(app, sseConnections, websocketConnections);
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  };

  const websocketHandler = (socket: WebSocket, request: FastifyRequest) => {
    if (!hasScope(request.identity, 'metastore:read')) {
      socket.close(4403, 'Missing metastore:read scope');
      return;
    }

    websocketConnections += 1;
    refreshSubscriberMetrics(app, sseConnections, websocketConnections);

    const listener = (event: RecordStreamEvent) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const payload = {
        type: `metastore.record.${event.action}`,
        id: event.id,
        data: {
          namespace: event.namespace,
          key: event.key,
          version: event.version,
          occurredAt: event.occurredAt,
          updatedAt: event.updatedAt,
          deletedAt: event.deletedAt,
          actor: event.actor,
          mode: event.mode
        }
      };
      try {
        socket.send(JSON.stringify(payload));
      } catch (err) {
        request.log.warn({ err }, 'Failed to send metastore record websocket payload');
      }
    };

    const unsubscribe = subscribeToRecordStream(listener);

    socket.send(
      JSON.stringify({
        type: 'connection.ack',
        data: {
          occurredAt: new Date().toISOString()
        }
      })
    );

    const cleanup = () => {
      unsubscribe();
      if (websocketConnections > 0) {
        websocketConnections -= 1;
      }
      refreshSubscriberMetrics(app, sseConnections, websocketConnections);
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  };

  app.route({
    method: 'GET',
    url: '/stream/records',
    handler: httpHandler,
    wsHandler: websocketHandler
  });
}
