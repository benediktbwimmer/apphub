import { Navigate, type RouterProviderProps, createBrowserRouter, type RouteObject } from 'react-router-dom';
import AppLayout from '../App';
import CatalogRoute from './CatalogRoute';
import OverviewRoute from './OverviewRoute';
import ImportRoute from './ImportRoute';
import LegacyImportRedirect from './LegacyImportRedirect';
import { RequireOperatorToken } from './RequireOperatorToken';
import ServiceGallery from '../services/ServiceGallery';
import JobsPage from '../jobs/JobsPage';
import WorkflowsPage from '../workflows/WorkflowsPage';
import RunsPage from '../runs/RunsPage';
import ApiAccessPage from '../settings/ApiAccessPage';
import AiBuilderSettingsPage from '../settings/AiBuilderSettingsPage';
import SettingsLayout from '../settings/SettingsLayout';
import PreviewSettingsPage from '../settings/PreviewSettingsPage';
import AdminToolsPage from '../settings/AdminToolsPage';
import { ROUTE_PATHS, ROUTE_SEGMENTS } from './paths';
import AssetsPage from '../dataAssets/AssetsPage';

export const appRouteConfig: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <Navigate to={ROUTE_PATHS.overview} replace />
      },
      {
        path: ROUTE_SEGMENTS.overview,
        element: <OverviewRoute />
      },
      {
        path: ROUTE_SEGMENTS.catalog,
        element: <CatalogRoute />
      },
      {
        path: ROUTE_SEGMENTS.assets,
        element: <AssetsPage />
      },
      {
        path: ROUTE_SEGMENTS.apps,
        element: <ServiceGallery />
      },
      {
        path: ROUTE_SEGMENTS.runs,
        element: (
          <RequireOperatorToken>
            <RunsPage />
          </RequireOperatorToken>
        )
      },
      {
        path: ROUTE_SEGMENTS.jobs,
        element: (
          <RequireOperatorToken>
            <JobsPage />
          </RequireOperatorToken>
        )
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
        path: ROUTE_SEGMENTS.settings,
        element: <SettingsLayout />,
        children: [
          {
            index: true,
            element: <Navigate to={ROUTE_PATHS.settingsPreview} replace />
          },
          {
            path: ROUTE_SEGMENTS.settingsPreview,
            element: <PreviewSettingsPage />
          },
          {
            path: ROUTE_SEGMENTS.settingsApiAccess,
            element: <ApiAccessPage />
          },
          {
            path: ROUTE_SEGMENTS.settingsAiBuilder,
            element: <AiBuilderSettingsPage />
          },
          {
            path: ROUTE_SEGMENTS.settingsAdmin,
            element: (
              <RequireOperatorToken>
                <AdminToolsPage />
              </RequireOperatorToken>
            )
          }
        ]
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
        element: <Navigate to={ROUTE_PATHS.overview} replace />
      }
    ]
  }
];

export function createAppRouter(options?: Parameters<typeof createBrowserRouter>[1]): RouterProviderProps['router'] {
  return createBrowserRouter(appRouteConfig, options);
}
