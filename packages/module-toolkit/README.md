# @apphub/module-toolkit

Typed helpers for authoring AppHub modules without relying on hand-written mustache templates.

## Installation

This package ships inside the AppHub repository and is available to every workspace via the `@apphub/module-toolkit` import path.

## Trigger definitions

```ts
import {
  defineTrigger,
  event,
  fromConfig,
  literal
} from '@apphub/module-toolkit';

type FilestoreUploadEvent = {
  payload: {
    node: {
      metadata: {
        minute?: string;
        instrumentId?: string;
      };
    };
  };
};

type TriggerMetadata = { maxFiles: number };

type ObservatorySettings = {
  filestore: {
    inboxPrefix: string;
  };
};

export const minuteIngestTrigger = defineTrigger<
  FilestoreUploadEvent,
  TriggerMetadata,
  ObservatorySettings
>({
  workflowSlug: 'observatory-minute-ingest',
  slug: 'observatory-minute.ingest-trigger',
  name: 'Observatory minute ingest trigger',
  eventType: 'filestore.command.completed',
  predicates: [
    { path: '$.payload.command', operator: 'equals', value: 'uploadFile' }
  ],
  parameters: {
    minute: event<FilestoreUploadEvent>('payload.node.metadata.minute').default('unknown'),
    instrumentId: event<FilestoreUploadEvent>('payload.node.metadata.instrumentId').default('unknown'),
    inboxPrefix: fromConfig<ObservatorySettings>((settings) => settings.filestore.inboxPrefix)
  },
  runKey: literal('observatory-ingest')
});

// Serialise to the provisioning format (e.g. during module build)
const { parameterTemplate } = minuteIngestTrigger.build({
  settings: { filestore: { inboxPrefix: 'datasets/observatory/raw' } }
});
```

The result matches the current provisioning JSON – dynamic values are rendered as mustache expressions while config-driven values stay literal.

## Job parameters

```ts
import { defineJobParameters, event, fromConfig } from '@apphub/module-toolkit';

type ObservatorySettings = { filestore: { inboxPrefix: string } };

export const timestoreLoaderParameters = defineJobParameters<ObservatorySettings>({
  filestoreBaseUrl: fromConfig((settings) => settings.filestore.inboxPrefix),
  instrumentId: event('payload.node.metadata.instrumentId').default('unknown')
});
```

## Settings loader

```ts
import { createSettingsLoader } from '@apphub/module-toolkit';
import { z } from 'zod';

const settingsSchema = z.object({
  datasetSlug: z.string(),
  maxFiles: z.coerce.number()
});

const secretsSchema = z.object({
  apiToken: z.string().optional()
});

export const loadObservatorySettings = createSettingsLoader({
  settingsSchema,
  secretsSchema,
  readSettings: (env) => ({
    datasetSlug: env.OBSERVATORY_TIMESTORE_DATASET_SLUG,
    maxFiles: env.OBSERVATORY_MAX_FILES
  }),
  readSecrets: (env) => ({
    apiToken: env.OBSERVATORY_TIMESTORE_TOKEN
  })
});
```

The loader returns typed settings/secrets objects that can be passed directly into trigger/job builders or module runtime helpers.

## Principals & secrets

Declare principals and secrets once and reuse them across triggers, jobs, and runtime wiring:

```ts
import { defineModuleSecurity } from '@apphub/module-toolkit';

type ObservatorySecrets = {
  timestoreToken?: string;
};

export const security = defineModuleSecurity<ObservatorySecrets>({
  principals: {
    dashboardAggregator: { subject: 'observatory-dashboard-aggregator' },
    timestoreLoader: { subject: 'observatory-timestore-loader' }
  },
  secrets: {
    timestoreToken: {
      select: (secrets) => secrets.timestoreToken,
      required: false
    }
  }
});

// Use principals as literal parameters
const principalTemplate = security.principal('dashboardAggregator')
  .asValueBuilder()
  .build({ settings: undefined });

// Access secrets through typed helpers
const bundle = security.secretsBundle({ timestoreToken: process.env.OBSERVATORY_TIMESTORE_TOKEN });
if (bundle.timestoreToken.exists()) {
  const token = bundle.timestoreToken.value();
  // use token ...
}
```

## Testing helpers

The package is covered by unit tests under `tests/` which act as examples for using fallbacks and configuration constants.

## Registry helpers

Turn your trigger/job definitions into typed lookup tables:

```ts
import {
  createTriggerRegistry,
  defineTrigger,
  createJobRegistry,
  defineJobParameters,
  event,
  fromConfig
} from '@apphub/module-toolkit';

export const triggers = createTriggerRegistry({
  'observatory-minute.ingest': defineTrigger({
    slug: 'observatory-minute.ingest',
    workflowSlug: 'observatory-minute-ingest',
    name: 'Observatory minute ingest trigger',
    eventType: 'filestore.command.completed',
    predicates: [],
    parameters: {
      minute: event('payload.node.metadata.minute').default('unknown')
    }
  })
});

export const jobs = createJobRegistry({
  'observatory.timestore-loader': defineJobParameters({
    slug: 'observatory.timestore-loader',
    parameters: {
      baseUrl: fromConfig((settings) => settings.timestore.baseUrl)
    }
  })
});

// Later in code
const ingestTrigger = triggers.get('observatory-minute.ingest');
```

## JSON path helpers

Generate strongly typed selectors from your event schema:

```ts
import { jsonPath, collectPaths } from '@apphub/module-toolkit';

type FilestoreUploadEvent = {
  payload: {
    node: {
      metadata: {
        minute?: string;
        instrumentId?: string;
      };
    };
  };
};

const select = jsonPath<FilestoreUploadEvent>();
const minutePath = select.payload.node.metadata.minute.$path; // "payload.node.metadata.minute"

// Or build a reusable map
export const uploadPathMap = collectPaths<FilestoreUploadEvent>((p) => ({
  minute: p.payload.node.metadata.minute.$path,
  instrumentId: p.payload.node.metadata.instrumentId.$path
}));

// minutePath === uploadPathMap.minute
```

## Module scaffold

Use the `templates/observatory-module` workspace as a reference implementation. It wires settings, security, triggers, and jobs with the toolkit and includes basic build/test scripts.
