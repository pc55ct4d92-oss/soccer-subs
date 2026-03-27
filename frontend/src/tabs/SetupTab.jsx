import { useState, useEffect } from 'react';
import { api } from '../api';

export default function SetupTab({ activeSeason, activeGame, setActiveGame }) {
  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [setup, setSetup] = useState(null); // { gamePlayers: [...] }
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!activeSeason) return;
    Promise.all([
      api(`/api/seasons/${activeSeason.id}/games`).then((r) => r.json()),
      api(`/api/seasons/${activeSeason.id}/players`).then((r) => r.json()),
    ]).then(([g, p]) => {
      setGames(g);
      setPlayers(p);
      if (activeGame) setSelectedGame(activeGame);
      else if (g.length > 0) setSelectedGame(g[g.length - 1]);
    });
  }, [activeSeason]);

  useEffect(() => {
    if (!selectedGame) return;
    setLoading(true);
    api(`/api/games/${selectedGame.id}/setup`)
      .then((r) => r.json())
      .then((data) => {
        // Fill in any missing players
        const existingIds = new Set(data.gamePlayers.map((gp) => gp.playerId));
        const merged = [...data.gamePlayers];
        for (const p of players) {
          if (!existingIds.has(p.id)) {
            merged.push({ playerId: p.id, attending: true, goalieHalf: null, player: p });
          }
        }
        setSetup({ ...data, gamePlayers: merged });
        setLoading(false);
      })
      .catch((e) => {
        // Game has no setup yet — create default
        const defaultSetup = players.map((p) => ({
          playerId: p.id,
          attending: true,
          goalieHalf: null,
          player: p,
        }));
        setSetup({ gamePlayers: defaultSetup });
        setLoading(false);
      });

    api(`/api/games/${selectedGame.id}/plan`)
      .then((r) => r.json())
      .then((blocks) => setPlan(blocks.length > 0 ? blocks : null))
      .catch(() => setPlan(null));
  }, [selectedGame, players]);

  const updateAttending = (playerId, val) => {
    setSetup((s) => ({
      ...s,
      gamePlayers: s.gamePlayers.map((gp) =>
        gp.playerId === playerId ? { ...gp, attending: val, goalieHalf: val ? gp.goalieHalf : null } : gp
      ),
    }));
  };

  const updateGoalie = (playerId, half) => {
    setSetup((s) => ({
      ...s,
      gamePlayers: s.gamePlayers.map((gp) => {
        if (gp.playerId === playerId) {
          return { ...gp, goalieHalf: gp.goalieHalf === half ? null : half };
        }
        // Clear same-half goalie from others
        if (gp.goalieHalf === half && gp.playerId !== playerId) {
          return { ...gp, goalieHalf: null };
        }
        return gp;
      }),
    }));
  };

  const saveSetup = async () => {
    if (!selectedGame || !setup) return;
    setSaving(true);
    try {
      await api(`/api/games/${selectedGame.id}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: setup.gamePlayers }),
      });
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  const generatePlan = async () => {
    if (!selectedGame || !setup) return;
    setGenerating(true);
    try {
      await saveSetup();
      const res = await api(`/api/games/${selectedGame.id}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locks: [] }),
      });
      const planData = await res.json();
      if (res.ok) {
        // Reload plan from DB
        const blocks = await api(`/api/games/${selectedGame.id}/plan`).then((r) => r.json());
        setPlan(blocks);
        setActiveGame(selectedGame);
      } else {
        setError(planData.error);
      }
    } catch (e) {
      setError(e.message);
    }
    setGenerating(false);
  };

  if (!activeSeason) return <div className="loading">No active season</div>;

  const attending = setup?.gamePlayers.filter((gp) => gp.attending) || [];
  const gkEligible = attending.filter((gp) => {
    const p = players.find((pl) => pl.id === gp.playerId);
    return p?.isGKEligible;
  });

  return (
    <div>
      <h2 className="section-title">Game Setup</h2>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <label className="field-label">Game</label>
        <select
          className="select"
          value={selectedGame?.id || ''}
          onChange={(e) => {
            const g = games.find((g) => g.id === parseInt(e.target.value));
            setSelectedGame(g);
          }}
        >
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              Game {g.gameNumber}{g.date ? ` — ${new Date(g.date).toLocaleDateString()}` : ''}
            </option>
          ))}
        </select>
      </div>

      {loading && <div className="loading">Loading…</div>}

      {!loading && setup && (
        <>
          <div className="card">
            <h3 className="subsection">Attendance ({attending.length} attending)</h3>
            {setup.gamePlayers.map((gp) => {
              const p = players.find((pl) => pl.id === gp.playerId);
              if (!p) return null;
              return (
                <div key={gp.playerId} className="player-row">
                  <button
                    className={`attend-btn ${gp.attending ? 'attending' : 'absent'}`}
                    onClick={() => updateAttending(gp.playerId, !gp.attending)}
                  >
                    {gp.attending ? '✓' : '✗'}
                  </button>
                  <span className="player-name">
                    {p.name}
                    {p.isGKEligible && <span className="badge gk" style={{ marginLeft: 6 }}>GK</span>}
                  </span>
                  {gp.attending && p.isGKEligible && (
                    <div className="goalie-btns">
                      <button
                        className={`goalie-btn ${gp.goalieHalf === 1 ? 'active' : ''}`}
                        onClick={() => updateGoalie(gp.playerId, 1)}
                      >H1</button>
                      <button
                        className={`goalie-btn ${gp.goalieHalf === 2 ? 'active' : ''}`}
                        onClick={() => updateGoalie(gp.playerId, 2)}
                      >H2</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="secondary" onClick={saveSetup} disabled={saving} style={{ flex: 1 }}>
              {saving ? 'Saving…' : 'Save Setup'}
            </button>
            <button className="primary" onClick={generatePlan} disabled={generating} style={{ flex: 1 }}>
              {generating ? 'Generating…' : 'Generate Plan'}
            </button>
          </div>
        </>
      )}

      {plan && plan.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 className="subsection">Plan Preview</h3>
          <PlanGrid plan={plan} players={players} />
        </div>
      )}

      <style>{`
        .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; }
        .subsection { font-size: 0.9rem; font-weight: 700; margin-bottom: 0.75rem; }
        .field-label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.4rem; }
        .select { width: 100%; font-size: 1rem; padding: 0.6rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius); background: white; }
        .player-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
        .player-row:last-child { border-bottom: none; }
        .player-name { flex: 1; font-size: 0.95rem; }
        .attend-btn { width: 40px; height: 40px; border-radius: 50%; font-size: 1rem; display: flex; align-items: center; justify-content: center; min-height: unset; padding: 0; }
        .attend-btn.attending { background: #d4edda; color: #155724; }
        .attend-btn.absent { background: #f8d7da; color: #721c24; }
        .goalie-btns { display: flex; gap: 4px; }
        .goalie-btn { padding: 0.3rem 0.5rem; font-size: 0.75rem; min-height: unset; background: var(--border); color: var(--text-muted); }
        .goalie-btn.active { background: #fff3cd; color: #856404; font-weight: 700; }
      `}</style>
    </div>
  );
}

function PlanGrid({ plan, players }) {
  const playerName = (id) => {
    const p = players.find((pl) => pl.id === id);
    return p ? p.name.split(' ')[0] : `#${id}`;
  };

  return (
    <div className="plan-grid">
      <div className="plan-header">
        <div className="plan-cell label" />
        {[1, 2, 3].map((bn) => <div key={bn} className="plan-cell label">B{bn}</div>)}
        {[1, 2, 3].map((bn) => <div key={bn + 10} className="plan-cell label">B{bn}</div>)}
      </div>
      <div className="plan-header">
        <div className="plan-cell label" />
        <div className="plan-cell half-label" style={{ gridColumn: 'span 3' }}>Half 1</div>
        <div className="plan-cell half-label" style={{ gridColumn: 'span 3' }}>Half 2</div>
      </div>

      {/* Get all players from plan */}
      {Array.from(new Set(plan.flatMap((b) => b.blockPlayers.map((bp) => bp.playerId)))).map((pid) => (
        <div key={pid} className="plan-row">
          <div className="plan-cell name">{playerName(pid)}</div>
          {[1, 2].flatMap((half) =>
            [1, 2, 3].map((bn) => {
              const block = plan.find((b) => b.half === half && b.blockNumber === bn);
              const bp = block?.blockPlayers.find((bp) => bp.playerId === pid);
              return (
                <div
                  key={`${half}-${bn}`}
                  className={`plan-cell ${bp?.isOnField ? 'on' : 'off'}`}
                >
                  {bp?.role === 'goalkeeper' ? 'GK' : bp?.isOnField ? '●' : '—'}
                </div>
              );
            })
          )}
        </div>
      ))}

      <style>{`
        .plan-grid { font-size: 0.75rem; overflow-x: auto; }
        .plan-header { display: grid; grid-template-columns: 60px repeat(6, 1fr); }
        .plan-row { display: grid; grid-template-columns: 60px repeat(6, 1fr); }
        .plan-cell { padding: 3px 2px; text-align: center; border-bottom: 1px solid var(--border); }
        .plan-cell.label { color: var(--text-muted); font-weight: 600; }
        .plan-cell.half-label { color: var(--text-muted); font-weight: 700; }
        .plan-cell.name { text-align: left; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .plan-cell.on { color: #155724; }
        .plan-cell.off { color: #721c24; }
      `}</style>
    </div>
  );
}
