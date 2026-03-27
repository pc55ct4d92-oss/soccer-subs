import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const BLOCK_DURATION = 8 * 60; // 8 minutes in seconds

export default function GameTab({ activeSeason, activeGame, setActiveGame }) {
  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [plan, setPlan] = useState(null);
  const [currentBlockIdx, setCurrentBlockIdx] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(BLOCK_DURATION);
  const [timerRunning, setTimerRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!activeSeason) return;
    Promise.all([
      api(`/api/seasons/${activeSeason.id}/games`).then((r) => r.json()),
      api(`/api/seasons/${activeSeason.id}/players`).then((r) => r.json()),
    ]).then(([g, p]) => {
      setGames(g);
      setPlayers(p);
      const game = activeGame || (g.length > 0 ? g[g.length - 1] : null);
      setSelectedGame(game);
    });
  }, [activeSeason]);

  useEffect(() => {
    if (!selectedGame) return;
    setLoading(true);
    api(`/api/games/${selectedGame.id}/plan`)
      .then((r) => r.json())
      .then((blocks) => {
        setPlan(blocks.length > 0 ? blocks : null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [selectedGame]);

  // Timer logic
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((s) => {
          if (s <= 1) {
            clearInterval(timerRef.current);
            setTimerRunning(false);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [timerRunning]);

  const advanceBlock = () => {
    if (currentBlockIdx < 5) {
      setCurrentBlockIdx((i) => i + 1);
      setTimerSeconds(BLOCK_DURATION);
      setTimerRunning(false);
    }
  };

  const toggleRole = async (blockPlayerId, currentRole) => {
    const nextRole = currentRole === 'offense' ? 'defense' : 'offense';
    try {
      const res = await api(`/api/blockplayers/${blockPlayerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      const updated = await res.json();
      // Update local plan state
      setPlan((prev) =>
        prev.map((block) => ({
          ...block,
          blockPlayers: block.blockPlayers.map((bp) =>
            bp.id === blockPlayerId ? { ...bp, role: updated.role } : bp
          ),
        }))
      );
    } catch (e) {
      setError(e.message);
    }
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  if (!activeSeason) return <div className="loading">No active season</div>;
  if (loading) return <div className="loading">Loading plan…</div>;

  const currentBlock = plan ? plan[currentBlockIdx] : null;
  const onField = currentBlock?.blockPlayers.filter((bp) => bp.isOnField) || [];
  const sitting = currentBlock?.blockPlayers.filter((bp) => !bp.isOnField) || [];

  const playerName = (id) => {
    const p = players.find((pl) => pl.id === id);
    return p ? p.name : `#${id}`;
  };

  return (
    <div>
      <h2 className="section-title">Game</h2>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <label className="field-label">Game</label>
        <select
          className="select"
          value={selectedGame?.id || ''}
          onChange={(e) => {
            const g = games.find((g) => g.id === parseInt(e.target.value));
            setSelectedGame(g);
            setCurrentBlockIdx(0);
            setTimerSeconds(BLOCK_DURATION);
            setTimerRunning(false);
          }}
        >
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              Game {g.gameNumber}
            </option>
          ))}
        </select>
      </div>

      {!plan && (
        <div className="card">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No plan generated yet. Go to Setup tab to generate a plan.
          </p>
        </div>
      )}

      {plan && currentBlock && (
        <>
          {/* Block indicator */}
          <div className="block-nav">
            {plan.map((b, i) => (
              <button
                key={i}
                className={`block-dot ${i === currentBlockIdx ? 'active' : i < currentBlockIdx ? 'done' : ''}`}
                onClick={() => { setCurrentBlockIdx(i); setTimerSeconds(BLOCK_DURATION); setTimerRunning(false); }}
              >
                H{b.half}B{b.blockNumber}
              </button>
            ))}
          </div>

          {/* Timer */}
          <div className="timer-card card">
            <div className={`timer-display ${timerSeconds === 0 ? 'expired' : ''}`}>
              {formatTime(timerSeconds)}
            </div>
            <div className="timer-btns">
              <button
                className={timerRunning ? 'secondary' : 'primary'}
                onClick={() => setTimerRunning((r) => !r)}
              >
                {timerRunning ? 'Pause' : timerSeconds === BLOCK_DURATION ? 'Start' : 'Resume'}
              </button>
              <button className="secondary" onClick={() => { setTimerSeconds(BLOCK_DURATION); setTimerRunning(false); }}>
                Reset
              </button>
              <button className="primary" onClick={advanceBlock} disabled={currentBlockIdx >= 5}>
                Next Block →
              </button>
            </div>
          </div>

          {/* Field */}
          <div className="card">
            <h3 className="subsection">On Field ({onField.length})</h3>
            <div className="player-grid">
              {onField.map((bp) => (
                <button
                  key={bp.id}
                  className={`field-btn role-${bp.role || 'none'}`}
                  onClick={() => bp.role !== 'goalkeeper' && toggleRole(bp.id, bp.role)}
                >
                  <span className="field-name">{playerName(bp.playerId)}</span>
                  <span className="field-role">{bp.role || '—'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="subsection">Sitting ({sitting.length})</h3>
            <div className="sitting-list">
              {sitting.map((bp) => (
                <div key={bp.id} className="sitting-player">
                  {playerName(bp.playerId)}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <style>{`
        .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; }
        .subsection { font-size: 0.9rem; font-weight: 700; margin-bottom: 0.75rem; }
        .field-label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.4rem; }
        .select { width: 100%; font-size: 1rem; padding: 0.6rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius); background: white; }
        .block-nav { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
        .block-dot { padding: 0.4rem 0.75rem; font-size: 0.75rem; min-height: 36px; background: var(--border); color: var(--text-muted); }
        .block-dot.active { background: var(--green); color: white; font-weight: 700; }
        .block-dot.done { background: #d4edda; color: #155724; }
        .timer-card { text-align: center; }
        .timer-display { font-size: 3rem; font-weight: 700; font-variant-numeric: tabular-nums; margin-bottom: 1rem; }
        .timer-display.expired { color: #dc3545; }
        .timer-btns { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
        .timer-btns button { flex: 1; min-width: 80px; }
        .player-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
        .field-btn { display: flex; flex-direction: column; align-items: center; padding: 0.75rem; min-height: 64px; border-radius: var(--radius); }
        .field-btn.role-offense { background: #cce5ff; color: #004085; }
        .field-btn.role-defense { background: #d4edda; color: #155724; }
        .field-btn.role-goalkeeper { background: #fff3cd; color: #856404; }
        .field-btn.role-none { background: var(--border); color: var(--text); }
        .field-name { font-weight: 600; font-size: 0.95rem; }
        .field-role { font-size: 0.7rem; margin-top: 2px; text-transform: uppercase; opacity: 0.8; }
        .sitting-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .sitting-player { background: #f8d7da; color: #721c24; padding: 0.4rem 0.75rem; border-radius: var(--radius); font-size: 0.9rem; }
      `}</style>
    </div>
  );
}
