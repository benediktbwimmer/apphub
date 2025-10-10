import { Outlet } from 'react-router-dom';
import { useMemo, type CSSProperties } from 'react';
import { AuthProvider } from './auth/AuthProvider';
import { AiBuilderSettingsProvider } from './ai/AiBuilderSettingsProvider';
import Navbar from './components/Navbar';
import { PreviewScaleProvider } from './settings/PreviewScaleProvider';
import { AppHubEventsProvider } from './events/AppHubEventsProvider';
import { ModuleScopeProvider } from './modules/ModuleScopeProvider';
import { clampThemeScale } from '@apphub/shared/designTokens';
import { useTheme } from './theme';

function AppLayout() {
  const { scale } = useTheme();
  const resolvedScale = useMemo(() => clampThemeScale(scale), [scale]);

  const scaledStyle = useMemo<CSSProperties | undefined>(() => {
    if (resolvedScale === 1) {
      return undefined;
    }
    return {
      transform: `scale(${resolvedScale})`,
      transformOrigin: 'top left'
    };
  }, [resolvedScale]);

  return (
    <AuthProvider>
      <AiBuilderSettingsProvider>
        <PreviewScaleProvider>
          <AppHubEventsProvider>
            <ModuleScopeProvider>
              <div className="mx-auto w-full max-w-6xl px-6 py-10 lg:mx-0 lg:max-w-none lg:px-0">
                <div className="flex flex-col lg:flex-row lg:items-start">
                  <Navbar />
                  <div className="mt-8 flex-1 min-w-0 lg:ml-12 lg:mt-0">
                    <div className="flex-1 min-w-0" style={scaledStyle}>
                      <main className="flex flex-1 flex-col gap-8 pb-8">
                        <Outlet />
                      </main>
                    </div>
                  </div>
                </div>
              </div>
            </ModuleScopeProvider>
          </AppHubEventsProvider>
        </PreviewScaleProvider>
      </AiBuilderSettingsProvider>
    </AuthProvider>
  );
}

export default AppLayout;
