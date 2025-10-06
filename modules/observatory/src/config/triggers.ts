import {
  defineTrigger,
  createTriggerRegistry,
  event,
  trigger as triggerPath,
  fromConfig,
  literal,
  jsonPath
} from '@apphub/module-toolkit';
import type { JsonPath } from '@apphub/module-toolkit';
import type { WorkflowProvisioningEventTriggerPredicate } from '@apphub/module-registry';
import type { ObservatorySettings } from './settings';

interface FilestoreUploadEvent {
  payload: {
    command: string;
    path: string;
    backendMountId?: number;
    node: {
      metadata: {
        minute?: string;
        minuteKey?: string;
        window?: string;
        instrumentId?: string;
        instrument_id?: string;
      };
    };
  };
}

interface AssetProducedEvent {
  payload: {
    assetId: string;
    partitionKey: string;
    parameters: {
      instrumentId?: string | null;
      rowsIngested?: number | null;
      partitionWindow?: string | null;
    };
    payload: {
      instrumentId?: string | null;
      rowsIngested?: number | null;
      partitionKeyFields: {
        instrument?: string | null;
        instrument_id?: string | null;
        window?: string | null;
      };
    };
  };
}

interface AssetExpiredEvent {
  payload: {
    assetId: string;
    reason: string;
    partitionKey?: string;
    workflowSlug?: string;
    expiresAt: string;
  };
}

interface IngestTriggerMetadata {
  maxFiles: number;
}

interface PublicationTriggerMetadata {
  rowsIngestedHint?: number;
  lookbackMinutes: number;
}

interface AggregateTriggerMetadata {
  lookbackMinutes: number;
  burstQuietMs: number;
}

export const triggers = createTriggerRegistry({
  'observatory-minute.ingest': defineTrigger<FilestoreUploadEvent, IngestTriggerMetadata, ObservatorySettings>({
    slug: 'observatory-minute.ingest',
    workflowSlug: 'observatory-minute-ingest',
    name: 'Observatory minute ingest',
    eventType: 'filestore.command.completed',
    eventSource: 'filestore.service',
    predicates: (context) => {
      const base: WorkflowProvisioningEventTriggerPredicate[] = [
        { path: '$.payload.command', operator: 'equals', value: 'uploadFile' },
        { path: '$.payload.node.metadata.minute', operator: 'exists' }
      ];
      if (typeof context.settings.filestore.backendId === 'number') {
        base.splice(1, 0, {
          path: '$.payload.backendMountId',
          operator: 'equals',
          value: context.settings.filestore.backendId
        });
      }
      return base;
    },
    parameters: (() => {
      const path = jsonPath<FilestoreUploadEvent>();
      const fromEvent = <P extends JsonPath<FilestoreUploadEvent>>(value: P) =>
        event<FilestoreUploadEvent, P>(value);
      const fromTriggerMetadata = <P extends JsonPath<{ metadata: IngestTriggerMetadata }>>(value: P) =>
        triggerPath<{ metadata: IngestTriggerMetadata }, P>(value);
      return {
        minute: fromEvent(path.payload.node.metadata.minute.$path)
          .fallback(fromEvent(path.payload.node.metadata.minuteKey.$path))
          .fallback(fromEvent(path.payload.node.metadata.window.$path)),
        instrumentId: fromEvent(path.payload.node.metadata.instrumentId.$path)
          .fallback(fromEvent(path.payload.node.metadata.instrument_id.$path))
          .fallback(literal('unknown')),
        maxFiles: fromTriggerMetadata('metadata.maxFiles'),
        commandPath: fromEvent(path.payload.path.$path),
        inboxPrefix: fromConfig((settings: ObservatorySettings) => settings.filestore.inboxPrefix),
        filestoreBaseUrl: fromConfig((settings) => settings.filestore.baseUrl),
        filestoreBackendId: fromConfig((settings) => settings.filestore.backendId),
        filestoreBackendKey: fromConfig((settings) => settings.filestore.backendKey),
        filestoreToken: literal(null)
      };
    })(),
    metadata: (context) => ({
      maxFiles: context.settings.ingest.maxFiles,
      filestore: {
        baseUrl: context.settings.filestore.baseUrl,
        backendMountId: context.settings.filestore.backendId,
        backendMountKey: context.settings.filestore.backendKey,
        token: null,
        rawPrefix: context.settings.filestore.inboxPrefix,
        principal: context.settings.principals.minutePreprocessor,
        calibrationsPrefix: context.settings.filestore.calibrationsPrefix,
        plansPrefix: context.settings.filestore.plansPrefix
      },
      timestore: {
        baseUrl: context.settings.timestore.baseUrl,
        datasetSlug: context.settings.timestore.datasetSlug,
        datasetName: context.settings.timestore.datasetName,
        tableName: context.settings.timestore.tableName,
        storageTargetId: context.settings.timestore.storageTargetId,
        authToken: null
      },
      metastore: {
        baseUrl: context.settings.metastore.baseUrl,
        namespace: context.settings.metastore.namespace,
        authToken: null
      }
    }),
    runKey: literal(
      "observatory-ingest-{{ parameters.instrumentId | default: 'unknown' | replace: ':', '-' }}-{{ parameters.minute | replace: ':', '-' }}"
    ),
    idempotencyKey: literal(
      "{{ event.payload.node.metadata.minute }}-{{ event.payload.path | replace: '/', '_' | replace: ':', '-' }}"
    )
  }),
  'observatory-minute.asset-ready': defineTrigger<AssetProducedEvent, PublicationTriggerMetadata, ObservatorySettings>({
    slug: 'observatory-minute.asset-ready',
    workflowSlug: 'observatory-minute-publication',
    name: 'Observatory minute asset ready',
    eventType: 'asset.produced',
    predicates: [
      {
        path: '$.payload.assetId',
        operator: 'equals',
        value: 'observatory.timeseries.timestore'
      }
    ],
    parameters: (() => {
      const path = jsonPath<AssetProducedEvent>();
      const fromEvent = <P extends JsonPath<AssetProducedEvent>>(value: P) =>
        event<AssetProducedEvent, P>(value);
      const fromTriggerMetadata = <P extends JsonPath<{ metadata: PublicationTriggerMetadata }>>(value: P) =>
        triggerPath<{ metadata: PublicationTriggerMetadata }, P>(value);
      return {
        partitionKey: fromEvent(path.payload.partitionKey.$path),
        instrumentId: fromEvent(path.payload.parameters.instrumentId.$path)
          .fallback(fromEvent(path.payload.payload.instrumentId.$path))
          .fallback(fromEvent(path.payload.payload.partitionKeyFields.instrument.$path))
          .fallback(fromEvent(path.payload.payload.partitionKeyFields.instrument_id.$path)),
        rowsIngested: fromEvent(path.payload.payload.rowsIngested.$path)
          .fallback(fromEvent(path.payload.parameters.rowsIngested.$path))
          .fallback(fromTriggerMetadata('metadata.rowsIngestedHint')),
        partitionWindow: fromEvent(path.payload.parameters.partitionWindow.$path)
          .fallback(fromEvent(path.payload.payload.partitionKeyFields.window.$path))
          .fallback(fromEvent(path.payload.partitionKey.$path)),
        timestoreBaseUrl: fromConfig((settings) => settings.timestore.baseUrl),
        timestoreDatasetSlug: fromConfig((settings) => settings.timestore.datasetSlug),
        timestoreAuthToken: literal(null),
        filestoreBaseUrl: fromConfig((settings) => settings.filestore.baseUrl),
        filestoreBackendId: fromConfig((settings) => settings.filestore.backendId),
        filestoreToken: literal(null),
        filestorePrincipal: literal('observatory-visualization-runner'),
        visualizationsPrefix: fromConfig((settings) => settings.filestore.visualizationsPrefix),
        reportsPrefix: fromConfig((settings) => settings.filestore.reportsPrefix),
        lookbackMinutes: fromTriggerMetadata('metadata.lookbackMinutes')
      };
    })(),
    metadata: (context) => ({
      filestore: {
        baseUrl: context.settings.filestore.baseUrl,
        backendMountId: context.settings.filestore.backendId,
        token: null,
        principal: context.settings.principals.visualizationRunner,
        visualizationsPrefix: context.settings.filestore.visualizationsPrefix,
        reportsPrefix: context.settings.filestore.reportsPrefix
      },
      timestore: {
        baseUrl: context.settings.timestore.baseUrl,
        datasetSlug: context.settings.timestore.datasetSlug,
        authToken: null
      },
      metastore: {
        baseUrl: context.settings.metastore.baseUrl,
        namespace: context.settings.metastore.namespace,
        authToken: null
      },
      lookbackMinutes: context.settings.dashboard.lookbackMinutes,
      rowsIngestedHint: context.settings.generator.rowsPerInstrument * context.settings.generator.instrumentCount
    }),
    runKey: literal('{{ trigger.payload.partitionKey }}')
  }),
  'observatory-burst.window-expired': defineTrigger<AssetExpiredEvent, AggregateTriggerMetadata, ObservatorySettings>({
    slug: 'observatory-burst.window-expired',
    workflowSlug: 'observatory-dashboard-aggregate',
    name: 'Observatory burst window expired',
    eventType: 'asset.expired',
    predicates: [
      {
        path: '$.payload.assetId',
        operator: 'equals',
        value: 'observatory.burst.window'
      },
      {
        path: '$.payload.reason',
        operator: 'equals',
        value: 'ttl'
      }
    ],
    parameters: (() => {
      const path = jsonPath<AssetExpiredEvent>();
      const fromEvent = <P extends JsonPath<AssetExpiredEvent>>(value: P) =>
        event<AssetExpiredEvent, P>(value);
      const fromTriggerMetadata = <P extends JsonPath<{ metadata: AggregateTriggerMetadata }>>(value: P) =>
        triggerPath<{ metadata: AggregateTriggerMetadata }, P>(value);
      return {
        partitionKey: fromEvent(path.payload.partitionKey.$path).fallback(
          fromEvent(path.payload.workflowSlug.$path)
        ),
        burstReason: fromEvent(path.payload.reason.$path),
        burstFinishedAt: fromEvent(path.payload.expiresAt.$path),
        lookbackMinutes: fromTriggerMetadata('metadata.lookbackMinutes')
      };
    })(),
    metadata: (context) => ({
      timestore: {
        baseUrl: context.settings.timestore.baseUrl,
        datasetSlug: context.settings.timestore.datasetSlug,
        authToken: null
      },
      filestore: {
        baseUrl: context.settings.filestore.baseUrl,
        backendMountId: context.settings.filestore.backendId,
        token: null,
        principal: context.settings.principals.dashboardAggregator,
        reportsPrefix: context.settings.filestore.reportsPrefix,
        overviewPrefix: context.settings.filestore.overviewPrefix
      },
      lookbackMinutes: context.settings.dashboard.lookbackMinutes,
      burstQuietMs: context.settings.dashboard.burstQuietMs
    }),
    runKey: literal(
      'dashboard-aggregate-{{ event.payload.partitionKey | default: event.payload.workflowSlug }}-{{ event.payload.expiresAt }}'
    ),
    idempotencyKey: literal(
      'dashboard-aggregate-{{ event.payload.partitionKey | default: event.payload.workflowSlug }}-{{ event.payload.expiresAt }}'
    )
  })
});
