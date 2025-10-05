import { z } from 'zod';
import {
  createJobHandler,
  inheritModuleSecrets,
  inheritModuleSettings,
  selectEventBus,
  type JobContext
} from '@apphub/module-sdk';

import { createObservatoryEventPublisher, publishAssetMaterialized } from '../runtime/events';
import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const parametersSchema = z
  .object({
    partitionKey: z.string().min(1, 'partitionKey is required'),
    producedAt: z.string().optional(),
    expiresAt: z.string().optional(),
    reason: z.string().optional()
  })
  .strip();

export type BurstFinalizerParameters = z.infer<typeof parametersSchema>;

export type BurstFinalizerResult = {
  partitionKey: string;
  burst: {
    partitionKey: string;
    finishedAt: string;
    producedAt: string | null;
    expiresAt: string | null;
    reason: string | null;
  };
  assets: Array<{
    assetId: string;
    partitionKey: string;
    producedAt: string;
    payload: BurstFinalizerResult['burst'];
  }>;
};

type BurstFinalizerContext = JobContext<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  BurstFinalizerParameters
>;

export const burstFinalizerJob = createJobHandler<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  BurstFinalizerResult,
  BurstFinalizerParameters,
  ['events.default']
>({
  name: 'observatory-burst-finalizer',
  settings: inheritModuleSettings(),
  secrets: inheritModuleSecrets(),
  requires: ['events.default'] as const,
  parameters: {
    resolve: (raw) => parametersSchema.parse(raw ?? {})
  },
  handler: async (context: BurstFinalizerContext): Promise<BurstFinalizerResult> => {
    const partitionKey = context.parameters.partitionKey.trim();
    if (!partitionKey) {
      throw new Error('partitionKey parameter is required');
    }

    const eventsCapability = selectEventBus(context.capabilities, 'default');
    if (!eventsCapability) {
      throw new Error('Event bus capability is required for burst finalization');
    }

    const finishedAt = new Date().toISOString();
    const burst = {
      partitionKey,
      finishedAt,
      producedAt: context.parameters.producedAt ?? null,
      expiresAt: context.parameters.expiresAt ?? null,
      reason: context.parameters.reason ?? null
    } satisfies BurstFinalizerResult['burst'];

    const publisher = createObservatoryEventPublisher({
      capability: eventsCapability,
      source: context.settings.events.source || 'observatory.burst-finalizer'
    });

    try {
      await publishAssetMaterialized(publisher, {
        assetId: 'observatory.burst.ready',
        partitionKey,
        producedAt: finishedAt,
        metadata: {
          producedAt: burst.producedAt,
          expiresAt: burst.expiresAt,
          reason: burst.reason
        }
      });

      await publisher.publish({
        type: 'observatory.burst.finished',
        occurredAt: finishedAt,
        payload: burst
      });
    } finally {
      await publisher.close().catch(() => undefined);
    }

    context.logger.info('Burst finalized after quiet window', {
      partitionKey,
      producedAt: burst.producedAt,
      expiresAt: burst.expiresAt,
      finishedAt
    });

    return {
      partitionKey,
      burst,
      assets: [
        {
          assetId: 'observatory.burst.ready',
          partitionKey,
          producedAt: finishedAt,
          payload: burst
        }
      ]
    } satisfies BurstFinalizerResult;
  }
});
