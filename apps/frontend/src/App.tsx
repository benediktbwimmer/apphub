import { useState } from 'react';
import CatalogPage from './catalog/CatalogPage';
import Navbar from './components/Navbar';
import { NavigationContext, type ActiveTab } from './components/NavigationContext';
import ImportServiceManifest from './import/ImportServiceManifest';
import SubmitApp from './submit/SubmitApp';
import ServiceGallery from './services/ServiceGallery';
import WorkflowsPage from './workflows/WorkflowsPage';

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('catalog');
  const [searchSeed, setSearchSeed] = useState<string | undefined>(undefined);

  const handleAppRegistered = (id: string) => {
    setSearchSeed(id);
    setActiveTab('catalog');
  };

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
  };

  const handleManifestImported = () => {
    setActiveTab('catalog');
  };

  return (
    <NavigationContext.Provider value={{ activeTab, setActiveTab: handleTabChange }}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 lg:px-0">
        <Navbar />
        <main className="flex flex-col gap-8 pb-8">
          {activeTab === 'catalog' && (
            <CatalogPage searchSeed={searchSeed} onSeedApplied={() => setSearchSeed(undefined)} />
          )}
          {activeTab === 'apps' && <ServiceGallery />}
          {activeTab === 'workflows' && <WorkflowsPage />}
          {activeTab === 'submit' && <SubmitApp onAppRegistered={handleAppRegistered} />}
          {activeTab === 'import-manifest' && <ImportServiceManifest onImported={handleManifestImported} />}
        </main>
      </div>
    </NavigationContext.Provider>
  );
}

export default App;
