import { Navigate, RouterProviderProps, createBrowserRouter, type RouteObject } from 'react-router-dom';
import AppLayout from '../App';
import CatalogRoute from './CatalogRoute';
import ImportRoute from './ImportRoute';
import LegacyImportRedirect from './LegacyImportRedirect';
import { RequireOperatorToken } from './RequireOperatorToken';
import ServiceGallery from '../services/ServiceGallery';
import WorkflowsPage from '../workflows/WorkflowsPage';
import ApiAccessPage from '../settings/ApiAccessPage';
import { ROUTE_PATHS, ROUTE_SEGMENTS } from './paths';

export const appRouteConfig: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <Navigate to={ROUTE_PATHS.catalog} replace />
      },
      {
        path: ROUTE_SEGMENTS.catalog,
        element: <CatalogRoute />
      },
      {
        path: ROUTE_SEGMENTS.apps,
        element: <ServiceGallery />
      },
      {
        path: ROUTE_SEGMENTS.workflows,
        element: (
          <RequireOperatorToken>
            <WorkflowsPage />
          </RequireOperatorToken>
        )
      },
      {
        path: ROUTE_SEGMENTS.import,
        element: (
          <RequireOperatorToken>
            <ImportRoute />
          </RequireOperatorToken>
        )
      },
      {
        path: ROUTE_SEGMENTS.apiAccess,
        element: <ApiAccessPage />
      },
      {
        path: 'submit',
        element: <LegacyImportRedirect from="/submit" />
      },
      {
        path: 'import-manifest',
        element: <LegacyImportRedirect from="/import-manifest" />
      },
      {
        path: '*',
        element: <Navigate to={ROUTE_PATHS.catalog} replace />
      }
    ]
  }
];

export function createAppRouter(options?: Parameters<typeof createBrowserRouter>[1]): RouterProviderProps['router'] {
  return createBrowserRouter(appRouteConfig, options);
}
