import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import CatalogPage from '../catalog/CatalogPage';

export default function CatalogRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const seed = searchParams.get('seed') ?? undefined;
  const saved = searchParams.get('saved') ?? undefined;

  const handleSeedApplied = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('seed');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleSavedApplied = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('saved');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return (
    <CatalogPage
      searchSeed={seed ?? undefined}
      onSeedApplied={handleSeedApplied}
      savedSearchSlug={saved ?? undefined}
      onSavedSearchApplied={handleSavedApplied}
    />
  );
}
