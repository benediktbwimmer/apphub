import { describe, expect, test } from 'vitest';
import {
  defineTrigger,
  event,
  eventField,
  triggerMetadataField,
  fromConfig,
  literal,
  defineJobParameters,
  predicateEquals,
  predicateExists,
  predicateIn,
  predicateEqualsConfig,
  resolvePredicates
} from '../src/index';

interface UploadEvent {
  payload: {
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

interface ObservatorySettings {
  filestore: {
    inboxPrefix: string;
  };
}

describe('trigger builder', () => {
  test('compiles parameter templates with fallbacks and config literals', () => {
    const ingestTrigger = defineTrigger<UploadEvent, TriggerMetadata, ObservatorySettings>({
      workflowSlug: 'observatory-minute-ingest',
      slug: 'observatory-minute.ingest-trigger',
      name: 'Observatory minute ingest trigger',
      eventType: 'filestore.command.completed',
      predicates: (context) =>
        resolvePredicates(context, predicateEquals('$.payload.command', 'uploadFile'), predicateExists('$.payload.node.metadata.minute'), predicateIn('$.payload.type', ['csv', 'tsv']), predicateEqualsConfig<ObservatorySettings>('$.payload.backendMountId', (settings) => settings.filestore.backendId ?? -1)),
      parameters: {
        minute: eventField<UploadEvent>((event) => event.payload.node.metadata.minute).default('unknown'),
        instrumentId: event<UploadEvent>('payload.node.metadata.instrumentId').default('unknown'),
        inboxPrefix: fromConfig<ObservatorySettings>((settings) => settings.filestore.inboxPrefix),
        maxFiles: triggerMetadataField<TriggerMetadata>((metadata) => metadata.maxFiles)
      },
      runKey: literal('observatory-run')
    });

    const result = ingestTrigger.build({
      settings: {
        filestore: {
          inboxPrefix: 'datasets/observatory/raw'
        }
      }
    });

    expect(result.parameterTemplate?.minute).toBe(
      "{{ event.payload.node.metadata.minute | default: 'unknown' }}"
    );
    expect(result.parameterTemplate?.instrumentId).toBe(
      "{{ event.payload.node.metadata.instrumentId | default: 'unknown' }}"
    );
    expect(result.parameterTemplate?.inboxPrefix).toBe('datasets/observatory/raw');
    expect(result.parameterTemplate?.maxFiles).toBe('{{ trigger.metadata.maxFiles }}');
    expect(result.runKeyTemplate).toBe('observatory-run');
    expect(result.predicates).toEqual([
      { path: '$.payload.command', operator: 'equals', value: 'uploadFile' },
      { path: '$.payload.node.metadata.minute', operator: 'exists' },
      { path: '$.payload.type', operator: 'in', values: ['csv', 'tsv'] },
      { path: '$.payload.backendMountId', operator: 'equals', value: -1 }
    ]);
  });
});

describe('job parameter builder', () => {
  test('returns literal and template values', () => {
    const params = defineJobParameters<ObservatorySettings>({
      baseUrl: fromConfig<ObservatorySettings>((settings) => settings.filestore.inboxPrefix),
      instrumentId: eventField<UploadEvent>((event) => event.payload.node.metadata.instrumentId).default('unknown')
    });

    const compiled = params.build({
      settings: {
        filestore: {
          inboxPrefix: 'datasets/observatory/raw'
        }
      }
    });

    expect(compiled.baseUrl).toBe('datasets/observatory/raw');
    expect(compiled.instrumentId).toBe(
      "{{ event.payload.node.metadata.instrumentId | default: 'unknown' }}"
    );
  });
});
