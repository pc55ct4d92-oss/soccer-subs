import { useState, useEffect } from 'react';
import { api } from './api';
import RosterTab from './tabs/RosterTab';
import SeasonTab from './tabs/SeasonTab';
import SetupTab from './tabs/SetupTab';
import GameTab from './tabs/GameTab';
import './App.css';

const TABS = [
  { id: 'roster', label: 'Roster' },
  { id: 'season', label: 'Season' },
  { id: 'setup', label: 'Setup' },
  { id: 'game', label: 'Game' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('roster');
  const [activeSeason, setActiveSeason] = useState(null);
  const [activeGame, setActiveGame] = useState(null);

  useEffect(() => {
    api('/api/seasons')
      .then((r) => r.json())
      .then((seasons) => {
        const active = seasons.find((s) => s.isActive) || seasons[0] || null;
        setActiveSeason(active);
      })
      .catch(console.error);
  }, []);

  const ctx = { activeSeason, setActiveSeason, activeGame, setActiveGame, setActiveTab };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Gaffer</h1>
        {activeSeason && <span className="season-label">{activeSeason.name}</span>}
      </header>

      <main className="app-main">
        <div style={{ display: activeTab === 'roster' ? 'block' : 'none' }}><RosterTab {...ctx} /></div>
        <div style={{ display: activeTab === 'season' ? 'block' : 'none' }}><SeasonTab {...ctx} /></div>
        <div style={{ display: activeTab === 'setup' ? 'block' : 'none' }}><SetupTab {...ctx} /></div>
        <div style={{ display: activeTab === 'game' ? 'block' : 'none' }}><GameTab {...ctx} /></div>
      </main>

      <nav className="tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
