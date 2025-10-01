export function canonicalAssetId(assetId: string | null | undefined): string {
  if (typeof assetId !== 'string') {
    return '';
  }
  return assetId.trim();
}

export function normalizeAssetId(assetId: string | null | undefined): string {
  const canonical = canonicalAssetId(assetId);
  if (!canonical) {
    return '';
  }
  return canonical.toLowerCase();
}
