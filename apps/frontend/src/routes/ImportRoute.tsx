import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ImportWorkspace from '../import/ImportWorkspace';
import { ROUTE_PATHS } from './paths';

export default function ImportRoute() {
  const navigate = useNavigate();

  const handleViewCatalog = useCallback(() => {
    navigate(ROUTE_PATHS.catalog);
  }, [navigate]);

  const handleAppRegistered = useCallback(
    (id: string) => {
      const params = new URLSearchParams();
      params.set('seed', id);
      navigate(`${ROUTE_PATHS.catalog}?${params.toString()}`);
    },
    [navigate]
  );

  const handleManifestImported = useCallback(() => {
    navigate(ROUTE_PATHS.catalog);
  }, [navigate]);

  return (
    <ImportWorkspace
      onAppRegistered={handleAppRegistered}
      onManifestImported={handleManifestImported}
      onViewCatalog={handleViewCatalog}
    />
  );
}
