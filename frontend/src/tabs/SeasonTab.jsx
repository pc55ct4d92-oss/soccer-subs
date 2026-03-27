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

  // Sort by debt descending — most positive (most owed) first
  const sortedPlayers = stats ? [...stats.players].sort((a, b) => b.debt - a.debt) : [];

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
                <th>MIN</th>
                <th>OFF</th>
                <th>DEF</th>
                <th>DEBT</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.map((s) => (
                <tr key={s.playerId}>
                  <td>
                    {s.name}
                    {s.isGKEligible && <span className="gk-badge">GK</span>}
                  </td>
                  <td>{Math.round(s.totalMinutes)}</td>
                  <td>{Math.round(s.offenseMinutes)}</td>
                  <td>{Math.round(s.defenseMinutes)}</td>
                  <td className={s.debt > 0 ? 'debt-pos' : s.debt < 0 ? 'debt-neg' : ''}>
                    {s.debt > 0 ? '+' : ''}{s.debt.toFixed(1)}
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
              <span className="game-date">{game.date.slice(0, 10)}</span>
            )}
            <span className="expand-icon">{expanded === game.id ? '▲' : '▼'}</span>
          </button>
          {expanded === game.id && <GameDetail game={game} />}
        </div>
      ))}

      <style>{`
        .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; }
        .subsection { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.5rem; }
        .stats-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .stats-table th, .stats-table td { padding: 0.4rem 0.5rem; text-align: right; border-bottom: 1px solid var(--border); }
        .stats-table th:first-child, .stats-table td:first-child { text-align: left; }
        .gk-badge { display: inline-block; font-size: 0.65rem; font-weight: 700; background: #cfe2ff; color: #084298; border-radius: 3px; padding: 0 3px; margin-left: 4px; vertical-align: middle; }
        .debt-pos { color: #dc3545; font-weight: 600; }
        .debt-neg { color: #198754; font-weight: 600; }
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
  const [setup, setSetup] = useState(null);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api(`/api/games/${game.id}/setup`).then((r) => r.json()),
      api(`/api/games/${game.id}/plan`).then((r) => r.json()),
    ])
      .then(([setupData, planData]) => {
        setSetup(setupData);
        setPlan(planData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [game.id]);

  if (loading) return <div className="loading" style={{ padding: '0.75rem' }}>Loading…</div>;
  if (!setup) return null;

  const attending = setup.gamePlayers
    .filter((gp) => gp.attending)
    .sort((a, b) => a.player.name.localeCompare(b.player.name));

  const h1Goalie = attending.find((gp) => gp.goalieHalf === 1);
  const h2Goalie = attending.find((gp) => gp.goalieHalf === 2);
  const gkLine = [
    h1Goalie ? `${h1Goalie.player.name} (H1)` : null,
    h2Goalie ? `${h2Goalie.player.name} (H2)` : null,
  ].filter(Boolean).join(' ');

  return (
    <div style={{ padding: '0 0.875rem 0.875rem' }}>
      <div className="game-meta">
        {attending.length} players{gkLine ? ` · GK: ${gkLine}` : ''}
      </div>

      {/* Playing time table */}
      <table className="stats-table" style={{ marginBottom: '1rem' }}>
        <thead>
          <tr>
            <th>Player</th>
            <th>TOTAL</th>
            <th>OFF</th>
            <th>DEF</th>
            <th>GK</th>
          </tr>
        </thead>
        <tbody>
          {attending.map((gp) => (
            <tr key={gp.playerId}>
              <td>{gp.player.name}</td>
              <td>{Math.round(gp.totalMinutes)}</td>
              <td>{Math.round(gp.offenseMinutes)}</td>
              <td>{Math.round(gp.defenseMinutes)}</td>
              <td>{Math.round(gp.gkMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Block rotation grid — rows=players, cols=H1B1…H2B3 */}
      {plan && plan.length > 0 && (
        <div className="rotation-grid">
          <div className="grid-row">
            <div className="grid-name-col" />
            {[1, 2].map((half) =>
              [1, 2, 3].map((bn) => (
                <div key={`h${half}b${bn}`} className="grid-block-header">
                  H{half}B{bn}
                </div>
              ))
            )}
          </div>
          {attending.map((gp) => (
            <div key={gp.playerId} className="grid-row">
              <div className="grid-name-col">{gp.player.name.split(' ')[0]}</div>
              {[1, 2].map((half) =>
                [1, 2, 3].map((bn) => {
                  const block = plan.find((b) => b.half === half && b.blockNumber === bn);
                  const bp = block?.blockPlayers.find((b) => b.playerId === gp.playerId);
                  const cls = !bp ? 'grid-cell empty'
                    : bp.role === 'goalkeeper' ? 'grid-cell gk'
                    : bp.isOnField ? 'grid-cell on'
                    : 'grid-cell off';
                  return <div key={`h${half}b${bn}`} className={cls} />;
                })
              )}
            </div>
          ))}
        </div>
      )}

      <style>{`
        .game-meta { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem; }
        .rotation-grid { font-size: 0.75rem; }
        .grid-row { display: flex; align-items: center; gap: 2px; margin-bottom: 2px; }
        .grid-name-col { width: 52px; font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; }
        .grid-block-header { flex: 1; text-align: center; font-size: 0.65rem; color: var(--text-muted); font-weight: 600; }
        .grid-cell { flex: 1; height: 18px; border-radius: 3px; }
        .grid-cell.on { background: #d4edda; }
        .grid-cell.off { background: #f8d7da; }
        .grid-cell.gk { background: #cfe2ff; }
        .grid-cell.empty { background: var(--border); }
      `}</style>
    </div>
  );
}
