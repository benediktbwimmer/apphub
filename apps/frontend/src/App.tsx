import { useState } from 'react';
import CatalogPage from './catalog/CatalogPage';
import Navbar from './components/Navbar';
import { NavigationContext, type ActiveTab } from './components/NavigationContext';
import SubmitApp from './submit/SubmitApp';

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

  return (
    <NavigationContext.Provider value={{ activeTab, setActiveTab: handleTabChange }}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 lg:px-0">
        <Navbar />
        <header className="rounded-3xl border border-slate-200/70 bg-white/80 p-8 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.7)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 transition-colors dark:text-slate-100">
              Osiris AppHub
            </h1>
            <p className="max-w-xl text-base text-slate-600 transition-colors dark:text-slate-300">
              Discover and launch containerized web apps with tag-driven search.
            </p>
          </div>
        </header>
        <main className="flex flex-col gap-8 pb-8">
          {activeTab === 'catalog' ? (
            <CatalogPage searchSeed={searchSeed} onSeedApplied={() => setSearchSeed(undefined)} />
          ) : (
            <SubmitApp onAppRegistered={handleAppRegistered} />
          )}
        </main>
      </div>
    </NavigationContext.Provider>
  );
}

export default App;
