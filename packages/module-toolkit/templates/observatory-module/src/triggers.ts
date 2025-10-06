import {
  defineTrigger,
  createTriggerRegistry,
  eventField,
  fromConfig,
  predicateEquals,
  resolvePredicates
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
  predicates: (context) => resolvePredicates(context, predicateEquals('$.payload.command', 'uploadFile')),
  parameters: {
    minute: eventField<FilestoreUploadEvent>((event) => event.payload.node.metadata.minute).default('unknown'),
    instrumentId: eventField<FilestoreUploadEvent>((event) => event.payload.node.metadata.instrumentId).default('unknown'),
    commandPath: eventField<FilestoreUploadEvent>((event) => event.payload.path),
    inboxPrefix: fromConfig<ObservatorySettings>((settings) => settings.filestore.inboxPrefix)
  }
});

export const triggers = createTriggerRegistry({
  'observatory-minute.ingest-trigger': minuteIngestTrigger
});
