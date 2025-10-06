import {
  defineTrigger,
  createTriggerRegistry,
  event,
  fromConfig
} from '@apphub/module-toolkit';
import type { ObservatorySettings } from './settings';

interface FilestoreUploadEvent {
  payload: {
    path: string;
    node: {
      metadata: {
        minute?: string;
        instrumentId?: string;
      };
    };
  };
}

interface TriggerMetadata {
  maxFiles: number;
}

const minuteIngestTrigger = defineTrigger<FilestoreUploadEvent, TriggerMetadata, ObservatorySettings>({
  slug: 'observatory-minute.ingest-trigger',
  workflowSlug: 'observatory-minute-ingest',
  name: 'Observatory minute ingest',
  eventType: 'filestore.command.completed',
  predicates: [
    { path: '$.payload.command', operator: 'equals', value: 'uploadFile' }
  ],
  parameters: {
    minute: event<FilestoreUploadEvent>('payload.node.metadata.minute').default('unknown'),
    instrumentId: event<FilestoreUploadEvent>('payload.node.metadata.instrumentId').default('unknown'),
    commandPath: event<FilestoreUploadEvent>('payload.path'),
    inboxPrefix: fromConfig<ObservatorySettings>((settings) => settings.filestore.inboxPrefix)
  }
});

export const triggers = createTriggerRegistry({
  'observatory-minute.ingest-trigger': minuteIngestTrigger
});
