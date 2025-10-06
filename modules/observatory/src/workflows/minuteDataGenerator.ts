import {
  createWorkflow,
  createWorkflowSchedule,
  moduleSetting,
  type WorkflowDefinition
} from '@apphub/module-sdk';

import type { ObservatorySecrets, ObservatorySettings } from '../config/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-minute-data-generator',
  name: 'Observatory Minute Data Generator',
  version: 3,
  description: 'Upload synthetic observatory CSV drops to keep the ingest pipeline exercised.',
  parametersSchema: {
    type: 'object',
    properties: {
      minute: { type: 'string' }
    },
    required: []
  },
  steps: [
    {
      id: 'generate-drop',
      name: 'Generate synthetic drop',
      type: 'job',
      jobSlug: 'observatory-data-generator'
    }
  ]
};

const schedules = [
  createWorkflowSchedule({
    name: 'Observatory synthetic drops',
    description: 'Emit synthetic instrument data every minute to drive sample ingest runs.',
    cron: '*/1 * * * *',
    timezone: 'UTC',
    parameterTemplate: {
      minute: '{{ run.trigger.schedule.occurrence | slice: 0, 16 }}'
    }
  })
];

export const minuteDataGeneratorWorkflow = createWorkflow<
  ObservatorySettings,
  ObservatorySecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  schedules
});
