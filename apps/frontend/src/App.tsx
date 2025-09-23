import { Outlet } from 'react-router-dom';
import { ApiTokenProvider } from './auth/ApiTokenContext';
import { AiBuilderSettingsProvider } from './ai/AiBuilderSettingsProvider';
import Navbar from './components/Navbar';
import { PreviewScaleProvider } from './settings/PreviewScaleProvider';

function AppLayout() {
  return (
    <ApiTokenProvider>
      <AiBuilderSettingsProvider>
        <PreviewScaleProvider>
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 lg:px-0">
            <Navbar />
            <main className="flex flex-col gap-8 pb-8">
              <Outlet />
            </main>
          </div>
        </PreviewScaleProvider>
      </AiBuilderSettingsProvider>
    </ApiTokenProvider>
  );
}

export default AppLayout;
