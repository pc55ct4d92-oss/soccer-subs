import { useState, useEffect } from 'react';
import { api } from '../api';

export default function SeasonTab({ activeSeason, activeGame, setActiveGame }) {
  const [games, setGames] = useState([]);
  const [stats, setStats] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!activeSeason) return;
    setLoading(true);

    Promise.all([
      api(`/api/seasons/${activeSeason.id}/games`).then((r) => r.json()),
      api(`/api/seasons/${activeSeason.id}/stats`).then((r) => r.json()),
    ])
      .then(([games, stats]) => {
        setGames(games);
        setStats(stats);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [activeSeason]);

  if (!activeSeason) return <div className="loading">No active season</div>;
  if (loading) return <div className="loading">Loading season…</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div>
      <h2 className="section-title">Season</h2>

      {stats && (
        <div className="card">
          <h3 className="subsection">Minutes table</h3>
          <table className="stats-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>G</th>
                <th>▲</th>
                <th>▽</th>
                <th>Debt</th>
              </tr>
            </thead>
            <tbody>
              {stats.players.map((s) => (
                <tr key={s.playerId}>
                  <td>{s.name}{s.isGKEligible ? ' 🥅' : ''}</td>
                  <td>{s.gamesAttended}</td>
                  <td>{s.totalBlocksOnField}</td>
                  <td>{s.totalBlocksSat}</td>
                  <td className={s.debt > 0 ? 'debt-pos' : s.debt < 0 ? 'debt-neg' : ''}>
                    {s.debt > 0 ? '+' : ''}{s.debt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="subsection" style={{ marginBottom: '0.5rem' }}>Games</h3>
      {games.length === 0 && <p className="muted">No games yet</p>}
      {games.map((game) => (
        <div className="card game-card" key={game.id}>
          <button
            className="game-header"
            onClick={() => setExpanded(expanded === game.id ? null : game.id)}
          >
            <span className="game-num">Game {game.gameNumber}</span>
            {game.date && (
              <span className="game-date">{new Date(game.date).toLocaleDateString()}</span>
            )}
            <span className="expand-icon">{expanded === game.id ? '▲' : '▼'}</span>
          </button>
          {expanded === game.id && (
            <GameDetail game={game} />
          )}
        </div>
      ))}

      <style>{`
        .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; }
        .subsection { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.5rem; }
        .stats-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .stats-table th, .stats-table td { padding: 0.4rem 0.5rem; text-align: right; border-bottom: 1px solid var(--border); }
        .stats-table th:first-child, .stats-table td:first-child { text-align: left; }
        .debt-pos { color: #856404; font-weight: 600; }
        .debt-neg { color: #155724; font-weight: 600; }
        .game-card { padding: 0; overflow: hidden; }
        .game-header { display: flex; align-items: center; gap: 0.75rem; width: 100%; background: none; text-align: left; padding: 0.875rem; min-height: 48px; border-radius: 0; }
        .game-num { font-weight: 600; }
        .game-date { color: var(--text-muted); font-size: 0.85rem; flex: 1; }
        .expand-icon { font-size: 0.7rem; color: var(--text-muted); }
        .muted { color: var(--text-muted); font-size: 0.85rem; }
      `}</style>
    </div>
  );
}

function GameDetail({ game }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/api/games/${game.id}/plan`)
      .then((r) => r.json())
      .then((blocks) => {
        setPlan(blocks);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [game.id]);

  if (loading) return <div className="loading" style={{ padding: '0.75rem' }}>Loading…</div>;
  if (!plan || plan.length === 0) return <div style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No plan generated yet</div>;

  return (
    <div style={{ padding: '0 0.875rem 0.875rem' }}>
      <div className="rotation-grid">
        {[1, 2].map((half) => (
          <div key={half} className="half-grid">
            <div className="half-label">H{half}</div>
            {[1, 2, 3].map((bn) => {
              const block = plan.find((b) => b.half === half && b.blockNumber === bn);
              if (!block) return <div key={bn} className="block-col empty" />;
              return (
                <div key={bn} className="block-col">
                  <div className="block-label">B{bn}</div>
                  {block.blockPlayers.map((bp) => (
                    <div
                      key={bp.id}
                      className={`bp-chip ${bp.isOnField ? 'on' : 'off'}`}
                    >
                      {bp.player.name.split(' ')[0]}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <style>{`
        .rotation-grid { display: flex; flex-direction: column; gap: 0.5rem; }
        .half-grid { display: flex; gap: 0.5rem; }
        .half-label { width: 24px; font-size: 0.75rem; font-weight: 700; color: var(--text-muted); padding-top: 20px; }
        .block-col { flex: 1; }
        .block-label { font-size: 0.7rem; color: var(--text-muted); text-align: center; margin-bottom: 2px; }
        .bp-chip { font-size: 0.7rem; padding: 2px 4px; border-radius: 4px; margin-bottom: 2px; text-align: center; }
        .bp-chip.on { background: #d4edda; color: #155724; }
        .bp-chip.off { background: #f8d7da; color: #721c24; }
      `}</style>
    </div>
  );
}
