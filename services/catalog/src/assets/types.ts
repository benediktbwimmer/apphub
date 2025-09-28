import type {
  AssetExpiredEventData,
  AssetProducedEventData
} from '@apphub/shared/catalogEvents';

export type AssetExpiryReason = 'ttl' | 'cadence' | 'manual';

export type AssetAutoMaterializePolicy = {
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
