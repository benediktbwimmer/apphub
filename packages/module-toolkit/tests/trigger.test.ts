import { describe, expect, test } from 'vitest';
import { defineTrigger, event, fromConfig, literal, defineJobParameters } from '../src/index';

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
      predicates: [],
      parameters: {
        minute: event<UploadEvent>('payload.node.metadata.minute').default('unknown'),
        instrumentId: event<UploadEvent>('payload.node.metadata.instrumentId').default('unknown'),
        inboxPrefix: fromConfig<ObservatorySettings>((settings) => settings.filestore.inboxPrefix)
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
    expect(result.runKeyTemplate).toBe('observatory-run');
  });
});

describe('job parameter builder', () => {
  test('returns literal and template values', () => {
    const params = defineJobParameters<ObservatorySettings>({
      baseUrl: fromConfig<ObservatorySettings>((settings) => settings.filestore.inboxPrefix),
      instrumentId: event<UploadEvent>('payload.node.metadata.instrumentId').default('unknown')
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
