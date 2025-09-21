import { useEffect, useState } from 'react';
import CatalogPage from './catalog/CatalogPage';
import { ApiTokenProvider } from './auth/ApiTokenContext';
import Navbar from './components/Navbar';
import { NavigationContext, type ActiveTab } from './components/NavigationContext';
import ImportWorkspace from './import/ImportWorkspace';
import ServiceGallery from './services/ServiceGallery';
import WorkflowsPage from './workflows/WorkflowsPage';
import ApiAccessPage from './settings/ApiAccessPage';

const ACTIVE_TAB_STORAGE_KEY = 'apphub-active-tab';

function isActiveTab(value: unknown): value is ActiveTab {
  return value === 'catalog' || value === 'apps' || value === 'workflows' || value === 'import' || value === 'api-access';
}

function normalizeStoredTab(value: string | null): ActiveTab {
  if (value === 'submit' || value === 'import-manifest') {
    return 'import';
  }
  if (isActiveTab(value)) {
    return value;
  }
  return 'catalog';
}

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    if (typeof window === 'undefined') {
      return 'catalog';
    }

    const storedValue = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return normalizeStoredTab(storedValue);
  });
  const [searchSeed, setSearchSeed] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  const handleAppRegistered = (id: string) => {
    setSearchSeed(id);
  };

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
  };

  const handleManifestImported = () => {
    setActiveTab('catalog');
  };

  return (
    <ApiTokenProvider>
      <NavigationContext.Provider value={{ activeTab, setActiveTab: handleTabChange }}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 lg:px-0">
          <Navbar />
          <main className="flex flex-col gap-8 pb-8">
            {activeTab === 'catalog' && (
              <CatalogPage searchSeed={searchSeed} onSeedApplied={() => setSearchSeed(undefined)} />
            )}
            {activeTab === 'apps' && <ServiceGallery />}
            {activeTab === 'workflows' && <WorkflowsPage />}
            {activeTab === 'import' && (
              <ImportWorkspace
                onAppRegistered={handleAppRegistered}
                onManifestImported={handleManifestImported}
              />
            )}
            {activeTab === 'api-access' && <ApiAccessPage />}
          </main>
        </div>
      </NavigationContext.Provider>
    </ApiTokenProvider>
  );
}

export default App;
