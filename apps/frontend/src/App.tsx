import { Outlet } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AiBuilderSettingsProvider } from './ai/AiBuilderSettingsProvider';
import Navbar from './components/Navbar';
import { PreviewScaleProvider } from './settings/PreviewScaleProvider';
import { AppHubEventsProvider } from './events/AppHubEventsProvider';

function AppLayout() {
  return (
    <AuthProvider>
      <AiBuilderSettingsProvider>
        <PreviewScaleProvider>
          <AppHubEventsProvider>
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 lg:mx-0 lg:max-w-none lg:flex-row lg:items-start lg:gap-12 lg:px-0">
              <Navbar />
              <main className="flex flex-1 flex-col gap-8 pb-8">
                <Outlet />
              </main>
            </div>
          </AppHubEventsProvider>
        </PreviewScaleProvider>
      </AiBuilderSettingsProvider>
    </AuthProvider>
  );
}

export default AppLayout;
