import { useState } from 'react';
import './App.css';
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
    <div className="app-shell">
      <header className="hero">
        <div className="hero-heading">
          <div>
            <h1>Osiris AppHub</h1>
            <p>Discover and launch containerized web apps with tag-driven search.</p>
          </div>
          <nav className="hero-tabs">
            <button
              type="button"
              className={activeTab === 'catalog' ? 'active' : ''}
              onClick={() => setActiveTab('catalog')}
            >
              Catalog
            </button>
            <button
              type="button"
              className={activeTab === 'submit' ? 'active' : ''}
              onClick={() => setActiveTab('submit')}
            >
              Submit App
            </button>
          </nav>
        </div>
      </header>
      <main>
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
