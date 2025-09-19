import { useState } from 'react';
import CatalogPage from './catalog/CatalogPage';
import SubmitApp from './submit/SubmitApp';

function App() {
  const [activeTab, setActiveTab] = useState<'catalog' | 'submit'>('catalog');
  const [searchSeed, setSearchSeed] = useState<string | undefined>(undefined);

  const handleAppRegistered = (id: string) => {
    setSearchSeed(id);
    setActiveTab('catalog');
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 lg:px-0">
      <header className="rounded-3xl border border-slate-200/70 bg-white/80 p-8 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.7)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70">
        <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 transition-colors dark:text-slate-100">
              Osiris AppHub
            </h1>
            <p className="max-w-xl text-base text-slate-600 transition-colors dark:text-slate-300">
              Discover and launch containerized web apps with tag-driven search.
            </p>
          </div>
          <nav className="inline-flex items-center justify-start gap-1 rounded-full border border-slate-200/70 bg-slate-100/80 p-1 backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-800/70">
            <button
              type="button"
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors transition-shadow duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                activeTab === 'catalog'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 dark:bg-slate-200/20 dark:text-slate-50 dark:shadow-[0_20px_50px_-30px_rgba(15,23,42,0.9)]'
                  : 'text-slate-600 hover:bg-blue-600/10 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100'
              }`}
              onClick={() => setActiveTab('catalog')}
            >
              Catalog
            </button>
            <button
              type="button"
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors transition-shadow duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                activeTab === 'submit'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 dark:bg-slate-200/20 dark:text-slate-50 dark:shadow-[0_20px_50px_-30px_rgba(15,23,42,0.9)]'
                  : 'text-slate-600 hover:bg-blue-600/10 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100'
              }`}
              onClick={() => setActiveTab('submit')}
            >
              Submit App
            </button>
          </nav>
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
  );
}

export default App;
