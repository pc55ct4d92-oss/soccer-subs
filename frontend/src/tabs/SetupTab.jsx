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
  const [showNewGame, setShowNewGame] = useState(false);
  const [newGameNumber, setNewGameNumber] = useState('');
  const [newGameDate, setNewGameDate] = useState('');
  const [creatingGame, setCreatingGame] = useState(false);
  const [locks, setLocks] = useState([]);

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

  const createGame = async (e) => {
    e.preventDefault();
    if (!activeSeason || !newGameNumber) return;
    setCreatingGame(true);
    try {
      const res = await api(`/api/seasons/${activeSeason.id}/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameNumber: parseInt(newGameNumber), date: newGameDate || null }),
      });
      const created = await res.json();
      if (!res.ok) { setError(created.error); return; }
      const updated = await api(`/api/seasons/${activeSeason.id}/games`).then((r) => r.json());
      setGames(updated);
      setSelectedGame(created);
      setLocks([]);
      setShowNewGame(false);
      setNewGameNumber('');
      setNewGameDate('');
    } catch (e) {
      setError(e.message);
    } finally {
      setCreatingGame(false);
    }
  };

  const toggleLock = (playerId, blockIndex) => {
    setLocks((prev) => {
      const exists = prev.some((l) => l.playerId === playerId && l.blockIndex === blockIndex);
      return exists
        ? prev.filter((l) => !(l.playerId === playerId && l.blockIndex === blockIndex))
        : [...prev, { playerId, blockIndex }];
    });
  };

  const generatePlan = async () => {
    if (!selectedGame || !setup) return;
    setGenerating(true);
    try {
      await saveSetup();
      const locksForApi = locks.map(({ playerId, blockIndex }) => {
        const half = blockIndex < 3 ? 1 : 2;
        const blockNumber = (blockIndex % 3) + 1;
        const block = plan?.find((b) => b.half === half && b.blockNumber === blockNumber);
        const bp = block?.blockPlayers.find((bp) => bp.playerId === playerId);
        return { half, blockNumber, playerId, isOnField: bp?.isOnField ?? true, role: bp?.role ?? null };
      });
      const res = await api(`/api/games/${selectedGame.id}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locks: locksForApi }),
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
          <label className="field-label" style={{ margin: 0 }}>Game</label>
          <button className="new-game-toggle" onClick={() => setShowNewGame((v) => !v)}>
            {showNewGame ? 'Cancel' : '+ New game'}
          </button>
        </div>
        {showNewGame && (
          <form onSubmit={createGame} className="new-game-form">
            <input
              type="number"
              className="new-game-input"
              placeholder="Game #"
              value={newGameNumber}
              onChange={(e) => setNewGameNumber(e.target.value)}
              required
              min="1"
            />
            <input
              type="date"
              className="new-game-input"
              value={newGameDate}
              onChange={(e) => setNewGameDate(e.target.value)}
            />
            <button type="submit" className="primary" disabled={creatingGame} style={{ whiteSpace: 'nowrap' }}>
              {creatingGame ? 'Creating…' : 'Create'}
            </button>
          </form>
        )}
        <select
          className="select"
          value={selectedGame?.id || ''}
          onChange={(e) => {
            const g = games.find((g) => g.id === parseInt(e.target.value));
            setSelectedGame(g);
            setLocks([]);
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
        <div style={{ marginTop: '1rem' }}>
          <h3 className="subsection" style={{ paddingLeft: '0.25rem' }}>Plan Preview</h3>
          <BlockCards plan={plan} players={players} onSitPlayerTap={() => {}} />
        </div>
      )}

      <style>{`
        .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; }
        .subsection { font-size: 0.9rem; font-weight: 700; margin-bottom: 0.75rem; }
        .field-label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.4rem; }
        .select { width: 100%; font-size: 1rem; padding: 0.6rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius); background: white; }
        .new-game-toggle { font-size: 0.75rem; color: var(--green); background: none; border: none; padding: 0; min-height: unset; cursor: pointer; font-weight: 600; }
        .new-game-form { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; }
        .new-game-input { font-size: 0.9rem; padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: var(--radius); background: white; flex: 1; min-width: 80px; }
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

const BLOCK_TIMES = ['0–8m', '8–16m', '16–24m'];

function BlockCards({ plan, players, onSitPlayerTap }) {
  const playerName = (id) => {
    const p = players.find((pl) => pl.id === id);
    return p ? p.name.split(' ')[0] : `#${id}`;
  };

  const renderHalf = (half) => (
    <div key={half} className="bc-half">
      <div className="bc-half-label">{half === 1 ? '1st Half' : '2nd Half'}</div>
      <div className="bc-row">
        {[1, 2, 3].map((bn) => {
          const blockIndex = (half - 1) * 3 + (bn - 1);
          const block = plan.find((b) => b.half === half && b.blockNumber === bn);
          if (!block) return null;
          const gk = block.blockPlayers.find((bp) => bp.isOnField && bp.role === 'goalkeeper');
          const field = block.blockPlayers.filter((bp) => bp.isOnField && bp.role !== 'goalkeeper');
          const sitting = block.blockPlayers.filter((bp) => !bp.isOnField);
          return (
            <div key={bn} className="bc-card">
              <div className="bc-time">{BLOCK_TIMES[bn - 1]}</div>
              {gk && <div className="bc-gk">{playerName(gk.playerId)}</div>}
              {field.map((bp) => (
                <div key={bp.playerId} className="bc-field">{playerName(bp.playerId)}</div>
              ))}
              {sitting.map((bp) => (
                <button
                  key={bp.playerId}
                  className="bc-sitting"
                  onClick={() => onSitPlayerTap(bp.playerId, blockIndex)}
                >
                  ↓ {playerName(bp.playerId)}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="bc-wrap">
      {renderHalf(1)}
      {renderHalf(2)}
      <style>{`
        .bc-wrap { display: flex; flex-direction: column; gap: 1rem; }
        .bc-half-label { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; padding-left: 0.25rem; }
        .bc-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }
        .bc-card { background: white; border: 1px solid var(--border); border-radius: var(--radius); padding: 0.5rem; display: flex; flex-direction: column; gap: 2px; }
        .bc-time { font-size: 0.65rem; font-weight: 700; color: var(--text-muted); margin-bottom: 4px; }
        .bc-gk { font-size: 0.8rem; font-weight: 700; color: #856404; background: #fff3cd; border-radius: 4px; padding: 3px 5px; }
        .bc-field { font-size: 0.8rem; color: #155724; padding: 2px 0; }
        .bc-sitting { font-size: 0.8rem; color: #721c24; background: none; border: none; border-radius: 4px; padding: 4px 2px; min-height: 36px; width: 100%; text-align: left; cursor: pointer; display: block; }
      `}</style>
    </div>
  );
}
