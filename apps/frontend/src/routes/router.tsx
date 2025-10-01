import { Navigate, type RouterProviderProps, createBrowserRouter, type RouteObject } from 'react-router-dom';
import AppLayout from '../App';
import CoreRoute from './CoreRoute';
import OverviewRoute from './OverviewRoute';
import ImportRoute from './ImportRoute';
import LegacyImportRedirect from './LegacyImportRedirect';
import { RequireOperatorToken } from './RequireOperatorToken';
import ServiceGallery from '../services/ServiceGallery';
import ServicesLayout from '../services/ServicesLayout';
import TimestoreDatasetsPage from '../timestore/TimestoreDatasetsPage';
import TimestoreLayout from '../timestore/TimestoreLayout';
import TimestoreSqlEditorPage from '../timestore/sql/TimestoreSqlEditorPage';
import MetastoreExplorerPage from '../metastore/MetastoreExplorerPage';
import FilestoreLayout from '../filestore/FilestoreLayout';
import ServicesRouteError from '../services/ServicesRouteError';
import JobsPage from '../jobs/JobsPage';
import WorkflowsPage from '../workflows/WorkflowsPage';
import SchedulesPage from '../schedules/SchedulesPage';
import RunsPage from '../runs/RunsPage';
import EventsExplorerPage from '../events/EventsExplorerPage';
import ApiAccessPage from '../settings/ApiAccessPage';
import AiBuilderSettingsPage from '../settings/AiBuilderSettingsPage';
import RuntimeScalingSettingsPage from '../settings/RuntimeScalingSettingsPage';
import SettingsLayout from '../settings/SettingsLayout';
import PreviewSettingsPage from '../settings/PreviewSettingsPage';
import AdminToolsPage from '../settings/AdminToolsPage';
import ThemeSettingsPage from '../settings/ThemeSettingsPage';
import TopologyRoute from './TopologyRoute';
import { ROUTE_PATHS, ROUTE_SEGMENTS } from './paths';
import AssetsPage from '../dataAssets/AssetsPage';
import ObservatoryOpsPage from '../observatory/ObservatoryOpsPage';

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
        path: ROUTE_SEGMENTS.core,
        element: <CoreRoute />
      },
      {
        path: ROUTE_SEGMENTS.events,
        element: <EventsExplorerPage />
      },
      {
        path: ROUTE_SEGMENTS.assets,
        element: <AssetsPage />
      },
      {
        path: ROUTE_SEGMENTS.services,
        element: <ServicesLayout />,
        errorElement: <ServicesRouteError />,
        children: [
          {
            index: true,
            element: <Navigate to={ROUTE_PATHS.servicesOverview} replace />
          },
          {
            path: ROUTE_SEGMENTS.servicesOverview,
            element: <ServiceGallery />
          },
          {
            path: ROUTE_SEGMENTS.servicesTimestore,
            element: <TimestoreLayout />,
            children: [
              {
                index: true,
                element: <Navigate to={ROUTE_PATHS.servicesTimestoreDatasets} replace />
              },
              {
                path: ROUTE_SEGMENTS.servicesTimestoreDatasets,
                element: <TimestoreDatasetsPage />
              },
              {
                path: ROUTE_SEGMENTS.servicesTimestoreSql,
                element: <TimestoreSqlEditorPage />
              }
            ]
          },
          {
            path: ROUTE_SEGMENTS.servicesFilestore,
            element: <FilestoreLayout />
          },
          {
            path: ROUTE_SEGMENTS.servicesMetastore,
            element: <MetastoreExplorerPage />
          }
        ]
      },
      {
        path: ROUTE_SEGMENTS.observatory,
        element: (
          <RequireOperatorToken>
            <ObservatoryOpsPage />
          </RequireOperatorToken>
        )
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
        path: ROUTE_SEGMENTS.topology,
        element: (
          <RequireOperatorToken>
            <TopologyRoute />
          </RequireOperatorToken>
        )
      },
      {
        path: ROUTE_SEGMENTS.schedules,
        element: (
          <RequireOperatorToken>
            <SchedulesPage />
          </RequireOperatorToken>
        )
      },
      {
        path: ROUTE_SEGMENTS.settings,
        element: <SettingsLayout />,
        children: [
          {
            index: true,
            element: <Navigate to={ROUTE_PATHS.settingsAppearance} replace />
          },
          {
            path: ROUTE_SEGMENTS.settingsAppearance,
            element: <ThemeSettingsPage />
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
            path: ROUTE_SEGMENTS.settingsRuntimeScaling,
            element: (
              <RequireOperatorToken>
                <RuntimeScalingSettingsPage />
              </RequireOperatorToken>
            )
          },
          {
            path: ROUTE_SEGMENTS.settingsImport,
            element: (
              <RequireOperatorToken>
                <ImportRoute />
              </RequireOperatorToken>
            )
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
