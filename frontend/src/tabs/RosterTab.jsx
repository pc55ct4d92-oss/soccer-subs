import { useState, useEffect } from 'react';
import { api } from '../api';

export default function RosterTab({ activeSeason }) {
  const [players, setPlayers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!activeSeason) return;
    setLoading(true);

    Promise.all([
      api(`/api/seasons/${activeSeason.id}/players`).then((r) => r.json()),
      api(`/api/seasons/${activeSeason.id}/stats`).then((r) => r.json()),
    ])
      .then(([players, stats]) => {
        setPlayers(players);
        setStats(stats);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [activeSeason]);

  if (!activeSeason) return <div className="loading">No active season</div>;
  if (loading) return <div className="loading">Loading roster…</div>;
  if (error) return <div className="error">{error}</div>;

  const statsByPlayer = {};
  if (stats) {
    for (const s of stats.players) {
      statsByPlayer[s.playerId] = s;
    }
  }

  return (
    <div>
      <h2 className="section-title">Roster</h2>
      <p className="section-sub">{activeSeason.name} · {players.length} players</p>

      {players.map((player) => {
        const s = statsByPlayer[player.id];
        return (
          <div className="card player-card" key={player.id}>
            <div className="player-name-row">
              <span className="player-name">{player.name}</span>
              {player.isGKEligible && <span className="badge gk">GK</span>}
            </div>
            {s && s.gamesAttended > 0 ? (
              <div className="player-stats">
                <span>{s.gamesAttended}G</span>
                <span>{s.totalBlocksOnField}▲ / {s.totalBlocksSat}▽</span>
                <span className={`debt ${s.debt > 0 ? 'debt-pos' : s.debt < 0 ? 'debt-neg' : ''}`}>
                  Debt: {s.debt > 0 ? '+' : ''}{s.debt}
                </span>
                <span>{s.offenseBlocks}O / {s.defenseBlocks}D / {s.goalkeeperBlocks}GK</span>
              </div>
            ) : (
              <div className="player-stats muted">No games yet</div>
            )}
          </div>
        );
      })}

      <style>{`
        .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem; }
        .section-sub { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1rem; }
        .player-card { padding: 0.875rem; }
        .player-name-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
        .player-name { font-weight: 600; font-size: 1rem; }
        .player-stats { display: flex; gap: 0.75rem; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-muted); }
        .debt { font-weight: 600; }
        .debt-pos { color: #856404; }
        .debt-neg { color: #155724; }
        .muted { color: var(--text-muted); font-size: 0.8rem; }
      `}</style>
    </div>
  );
}
