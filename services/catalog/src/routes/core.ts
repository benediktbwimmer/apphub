import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import WebSocket, { type RawData } from 'ws';
import { computeRunMetrics } from '../observability/metrics';
import { subscribeToApphubEvents, type ApphubEvent } from '../events';
import {
  serializeBuild,
  serializeLaunch,
  serializeRepository,
  serializeService,
  serializeWorkflowDefinition,
  serializeWorkflowRun,
  type SerializedBuild,
  type SerializedLaunch,
  type SerializedRepository,
  type SerializedService,
  type SerializedWorkflowDefinition,
  type SerializedWorkflowRun
} from './shared/serializers';
import type { IngestionEvent } from '../db/index';

type WorkflowRunEventType =
  | 'workflow.run.updated'
  | 'workflow.run.pending'
  | 'workflow.run.running'
  | 'workflow.run.succeeded'
  | 'workflow.run.failed'
  | 'workflow.run.canceled';

type OutboundEvent =
  | { type: 'repository.updated'; data: { repository: SerializedRepository } }
  | { type: 'repository.ingestion-event'; data: { event: IngestionEvent } }
  | { type: 'build.updated'; data: { build: SerializedBuild } }
  | { type: 'launch.updated'; data: { repositoryId: string; launch: SerializedLaunch } }
  | { type: 'service.updated'; data: { service: SerializedService } }
  | { type: 'workflow.definition.updated'; data: { workflow: SerializedWorkflowDefinition } }
  | { type: WorkflowRunEventType; data: { run: SerializedWorkflowRun } };

function toOutboundEvent(event: ApphubEvent): OutboundEvent | null {
  switch (event.type) {
    case 'repository.updated':
      return {
        type: 'repository.updated',
        data: { repository: serializeRepository(event.data.repository) }
      };
    case 'repository.ingestion-event':
      return {
        type: 'repository.ingestion-event',
        data: { event: event.data.event }
      };
    case 'build.updated':
      return {
        type: 'build.updated',
        data: { build: serializeBuild(event.data.build) }
      };
    case 'launch.updated':
      return {
        type: 'launch.updated',
        data: {
          repositoryId: event.data.launch.repositoryId,
          launch: serializeLaunch(event.data.launch)
        }
      };
    case 'service.updated':
      return {
        type: 'service.updated',
        data: { service: serializeService(event.data.service) }
      };
    case 'workflow.definition.updated':
      return {
        type: 'workflow.definition.updated',
        data: { workflow: serializeWorkflowDefinition(event.data.workflow) }
      };
    case 'workflow.run.updated':
    case 'workflow.run.pending':
    case 'workflow.run.running':
    case 'workflow.run.succeeded':
    case 'workflow.run.failed':
    case 'workflow.run.canceled':
      return {
        type: event.type,
        data: { run: serializeWorkflowRun(event.data.run) }
      };
    default:
      return null;
  }
}

export async function registerCoreRoutes(app: FastifyInstance): Promise<void> {
  const sockets = new Set<WebSocket>();
  const broadcast = (payload: OutboundEvent) => {
    const message = JSON.stringify({ ...payload, emittedAt: new Date().toISOString() });
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
        continue;
      }
      sockets.delete(socket);
    }
  };

  const unsubscribe = subscribeToApphubEvents((event) => {
    const outbound = toOutboundEvent(event);
    if (!outbound) {
      return;
    }
    broadcast(outbound);
  });

  app.addHook('onClose', async () => {
    unsubscribe();
    for (const socket of sockets) {
      try {
        socket.close();
      } catch {
        // ignore socket close errors
      }
    }
    sockets.clear();
  });

  app.get('/ws', { websocket: true }, (connection: SocketStream) => {
    const { socket } = connection;
    sockets.add(socket);

    socket.send(
      JSON.stringify({ type: 'connection.ack', data: { now: new Date().toISOString() } })
    );

    const cleanup = () => {
      sockets.delete(socket);
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
    socket.on('message', (data: RawData) => {
      let text: string | null = null;
      if (typeof data === 'string') {
        text = data;
      } else if (data instanceof Buffer) {
        text = data.toString('utf8');
      } else if (Array.isArray(data)) {
        text = Buffer.concat(data).toString('utf8');
      } else if (data instanceof ArrayBuffer) {
        text = Buffer.from(data).toString('utf8');
      }

      if (!text) {
        return;
      }

      if (text === 'ping') {
        socket.send(
          JSON.stringify({ type: 'pong', data: { now: new Date().toISOString() } })
        );
      }
    });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/metrics', async (request, reply) => {
    try {
      const metrics = await computeRunMetrics();
      reply.status(200);
      return { data: metrics };
    } catch (err) {
      request.log.error({ err }, 'Failed to compute run metrics');
      reply.status(500);
      return { error: 'Failed to compute metrics' };
    }
  });
}
