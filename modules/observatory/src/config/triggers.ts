import {
  defineTrigger,
  createTriggerRegistry,
  eventField,
  triggerMetadataField,
  fromConfig,
  literal,
  predicateEquals,
  predicateExists,
  resolvePredicates
} from '@apphub/module-toolkit';
import { security } from './security';
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
    predicates: (context) =>
      resolvePredicates(
        context,
        predicateEquals('$.payload.command', 'uploadFile'),
        predicateExists('$.payload.node.metadata.minute'),
        (ctx) => {
          const id = ctx.settings.filestore.backendId;
          return typeof id === 'number'
            ? predicateEquals('$.payload.backendMountId', id)
            : null;
        }
      ),
    parameters: {
      minute: eventField<FilestoreUploadEvent, string | undefined>((event) => event.payload.node.metadata.minute)
        .fallback(eventField<FilestoreUploadEvent, string | undefined>((event) => event.payload.node.metadata.minuteKey))
        .fallback(eventField<FilestoreUploadEvent, string | undefined>((event) => event.payload.node.metadata.window)),
      instrumentId: eventField<FilestoreUploadEvent, string | undefined>((event) => event.payload.node.metadata.instrumentId)
        .fallback(eventField<FilestoreUploadEvent, string | undefined>((event) => event.payload.node.metadata.instrument_id))
        .fallback(literal('unknown')),
      maxFiles: triggerMetadataField<IngestTriggerMetadata, number>((metadata) => metadata.maxFiles),
      commandPath: eventField<FilestoreUploadEvent, string>((event) => event.payload.path),
      inboxPrefix: fromConfig((settings: ObservatorySettings) => settings.filestore.inboxPrefix),
      filestoreBaseUrl: fromConfig((settings) => settings.filestore.baseUrl),
      filestoreBackendId: fromConfig((settings) => settings.filestore.backendId),
      filestoreBackendKey: fromConfig((settings) => settings.filestore.backendKey),
      filestoreToken: literal(null)
    },
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
    predicates: [predicateEquals('$.payload.assetId', 'observatory.timeseries.timestore')],
    parameters: {
      partitionKey: eventField<AssetProducedEvent, string>((event) => event.payload.partitionKey),
      instrumentId: eventField<AssetProducedEvent, string | null | undefined>((event) => event.payload.parameters.instrumentId)
        .fallback(eventField<AssetProducedEvent, string | null | undefined>((event) => event.payload.payload.instrumentId))
        .fallback(eventField<AssetProducedEvent, string | null | undefined>((event) => event.payload.payload.partitionKeyFields.instrument))
        .fallback(eventField<AssetProducedEvent, string | null | undefined>((event) => event.payload.payload.partitionKeyFields.instrument_id)),
      rowsIngested: eventField<AssetProducedEvent, number | null | undefined>((event) => event.payload.payload.rowsIngested)
        .fallback(eventField<AssetProducedEvent, number | null | undefined>((event) => event.payload.parameters.rowsIngested))
        .fallback(triggerMetadataField<PublicationTriggerMetadata, number | undefined>((metadata) => metadata.rowsIngestedHint)),
      partitionWindow: eventField<AssetProducedEvent, string | null | undefined>((event) => event.payload.parameters.partitionWindow)
        .fallback(eventField<AssetProducedEvent, string | null | undefined>((event) => event.payload.payload.partitionKeyFields.window))
        .fallback(eventField<AssetProducedEvent, string | null | undefined>((event) => event.payload.partitionKey)),
      timestoreBaseUrl: fromConfig((settings) => settings.timestore.baseUrl),
      timestoreDatasetSlug: fromConfig((settings) => settings.timestore.datasetSlug),
      timestoreAuthToken: literal(null),
      filestoreBaseUrl: fromConfig((settings) => settings.filestore.baseUrl),
      filestoreBackendId: fromConfig((settings) => settings.filestore.backendId),
      filestoreToken: literal(null),
      filestorePrincipal: fromConfig(security.principalSelector('visualizationRunner')),
      visualizationsPrefix: fromConfig((settings) => settings.filestore.visualizationsPrefix),
      reportsPrefix: fromConfig((settings) => settings.filestore.reportsPrefix),
      lookbackMinutes: triggerMetadataField<PublicationTriggerMetadata, number>((metadata) => metadata.lookbackMinutes)
    },
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
      predicateEquals('$.payload.assetId', 'observatory.burst.window'),
      predicateEquals('$.payload.reason', 'ttl')
    ],
    parameters: {
      partitionKey: eventField<AssetExpiredEvent, string | undefined>((event) => event.payload.partitionKey)
        .fallback(eventField<AssetExpiredEvent, string | undefined>((event) => event.payload.workflowSlug)),
      burstReason: eventField<AssetExpiredEvent, string>((event) => event.payload.reason),
      burstFinishedAt: eventField<AssetExpiredEvent, string>((event) => event.payload.expiresAt),
      lookbackMinutes: triggerMetadataField<AggregateTriggerMetadata, number>((metadata) => metadata.lookbackMinutes)
    },
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
