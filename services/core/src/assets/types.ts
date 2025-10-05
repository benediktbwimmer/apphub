import type {
  AssetExpiredEventData,
  AssetProducedEventData
} from '@apphub/shared/coreEvents';

export type AssetExpiryReason = 'ttl' | 'cadence' | 'manual';

export type AssetAutoMaterializePolicy = {
  enabled?: boolean | null;
  onUpstreamUpdate?: boolean;
  priority?: number | null;
};

export type AutoMaterializeTriggerReason = 'upstream-update' | 'expiry';

export type { AssetProducedEventData, AssetExpiredEventData };

export type AssetExpiryJobData = {
  assetKey: string;
  reason: AssetExpiryReason;
  requestedAt: string;
  expiresAt: string;
  asset: AssetProducedEventData;
};
