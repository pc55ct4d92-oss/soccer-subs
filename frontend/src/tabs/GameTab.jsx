import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const BLOCK_DURATION = 8 * 60; // 8 minutes in seconds

export default function GameTab({ activeSeason, activeGame, setActiveGame, setActiveTab }) {
  const [games, setGames] = useState([]);
  const [players, setPlayers] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [plan, setPlan] = useState(null);
  const [currentBlockIdx, setCurrentBlockIdx] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(BLOCK_DURATION);
  const [timerRunning, setTimerRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [blockStartTime, setBlockStartTime] = useState(null);
  const [playerMinutes, setPlayerMinutes] = useState({});
  const [halfTimerSeconds, setHalfTimerSeconds] = useState(0);
  const [halfTimerRunning, setHalfTimerRunning] = useState(false);
  const [isHalftime, setIsHalftime] = useState(false);
  const [halftimeSeconds, setHalftimeSeconds] = useState(300);
  const [arrivalSheet, setArrivalSheet] = useState(false);
  const [leaveSheet, setLeaveSheet] = useState(null); // { playerId, blockPlayerId, role }
  const [isGameOver, setIsGameOver] = useState(false);
  const [goals, setGoals] = useState([]);
  const [scorerSheet, setScorerSheet] = useState(false);
  const timerRef = useRef(null);
  const halfTimerRef = useRef(null);
  const halftimeRef = useRef(null);

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
  }, [activeSeason, activeGame]);

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
    api(`/api/games/${selectedGame.id}/setup`)
      .then((r) => r.json())
      .then((data) => {
        const minutes = {};
        data.gamePlayers.forEach((gp) => {
          minutes[gp.playerId] = {
            totalMinutes: gp.totalMinutes || 0,
            offenseMinutes: gp.offenseMinutes || 0,
            defenseMinutes: gp.defenseMinutes || 0,
            gkMinutes: gp.gkMinutes || 0,
          };
        });
        setPlayerMinutes(minutes);
      })
      .catch(() => {});
    api(`/api/games/${selectedGame.id}/goals`)
      .then((r) => r.json())
      .then((data) => setGoals(data))
      .catch(() => {});
  }, [selectedGame]);

  // Half timer — counts up, never pauses
  useEffect(() => {
    if (halfTimerRunning) {
      halfTimerRef.current = setInterval(() => {
        setHalfTimerSeconds((s) => s + 1);
      }, 1000);
    } else {
      clearInterval(halfTimerRef.current);
    }
    return () => clearInterval(halfTimerRef.current);
  }, [halfTimerRunning]);

  // Halftime countdown — resets to 300 and counts down while isHalftime is true
  useEffect(() => {
    if (isHalftime) {
      setHalftimeSeconds(300);
      halftimeRef.current = setInterval(() => {
        setHalftimeSeconds((s) => {
          if (s <= 1) { clearInterval(halftimeRef.current); return 0; }
          return s - 1;
        });
      }, 1000);
    } else {
      clearInterval(halftimeRef.current);
    }
    return () => clearInterval(halftimeRef.current);
  }, [isHalftime]);

  // Block timer logic
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

  const advanceBlock = async () => {
    if (currentBlockIdx > 5) return;

    const elapsed = blockStartTime
      ? Math.min(Math.round((Date.now() - blockStartTime) / 60000 * 10) / 10, 8)
      : 8;

    const updated = { ...playerMinutes };
    if (currentBlock) {
      for (const bp of currentBlock.blockPlayers) {
        if (!bp.isOnField) continue;
        const prev = updated[bp.playerId] || { totalMinutes: 0, offenseMinutes: 0, defenseMinutes: 0, gkMinutes: 0 };
        const next = { ...prev, totalMinutes: prev.totalMinutes + elapsed };
        if (bp.role === 'offense') next.offenseMinutes = prev.offenseMinutes + elapsed;
        else if (bp.role === 'defense') next.defenseMinutes = prev.defenseMinutes + elapsed;
        else if (bp.role === 'goalkeeper') next.gkMinutes = prev.gkMinutes + elapsed;
        updated[bp.playerId] = next;
      }
    }

    setPlayerMinutes(updated);

    await api(`/api/games/${selectedGame.id}/minutes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        players: Object.entries(updated).map(([playerId, mins]) => ({
          playerId: parseInt(playerId),
          ...mins,
        })),
      }),
    });

    if (currentBlockIdx === 5) {
      setTimerRunning(false);
      setHalfTimerRunning(false);
      setIsGameOver(true);
      return;
    }

    if (currentBlockIdx === 2) {
      setIsHalftime(true);
      setTimerRunning(false);
      setHalfTimerRunning(false);
      setHalfTimerSeconds(0);
      setBlockStartTime(null);
    } else {
      setBlockStartTime(Date.now());
      setTimerRunning(true);
    }
    setCurrentBlockIdx((i) => i + 1);
    setTimerSeconds(BLOCK_DURATION);
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

  const doLateArrival = async (playerId) => {
    const res = await api(`/api/games/${selectedGame.id}/generate-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPlayerId: playerId, fromBlockIndex: currentBlockIdx + 1, locks: [] }),
    });
    const newPlan = await res.json();

    setPlan((prev) => {
      const updated = [...prev];
      // Replace blocks from currentBlockIdx + 1 forward with regenerated plan
      for (let i = currentBlockIdx + 1; i < updated.length; i++) {
        const block = newPlan.find((b) => b.half === updated[i].half && b.blockNumber === updated[i].blockNumber);
        if (block) updated[i] = { ...block, blockPlayers: block.assignments };
      }
      // Add arriving player to current block as sitting if not already present
      const cur = updated[currentBlockIdx];
      if (!cur.blockPlayers.some((bp) => bp.playerId === playerId)) {
        updated[currentBlockIdx] = {
          ...cur,
          blockPlayers: [...cur.blockPlayers, { id: null, playerId, isOnField: false, role: null }],
        };
      }
      return updated;
    });

    setPlayerMinutes((prev) => ({
      ...prev,
      [playerId]: prev[playerId] || { totalMinutes: 0, offenseMinutes: 0, defenseMinutes: 0, gkMinutes: 0 },
    }));
    setArrivalSheet(false);
  };

  const doEarlyLeave = async () => {
    const { playerId, blockPlayerId, role } = leaveSheet;
    const elapsed = blockStartTime ? (Date.now() - blockStartTime) / 60000 : 0;
    const credit = elapsed >= 4 ? 8 : 4;

    const prev = playerMinutes[playerId] || { totalMinutes: 0, offenseMinutes: 0, defenseMinutes: 0, gkMinutes: 0 };
    const next = { ...prev, totalMinutes: prev.totalMinutes + credit };
    if (role === 'offense') next.offenseMinutes = prev.offenseMinutes + credit;
    else if (role === 'defense') next.defenseMinutes = prev.defenseMinutes + credit;
    else if (role === 'goalkeeper') next.gkMinutes = prev.gkMinutes + credit;
    const updatedMinutes = { ...playerMinutes, [playerId]: next };
    setPlayerMinutes(updatedMinutes);

    await api(`/api/games/${selectedGame.id}/minutes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        players: Object.entries(updatedMinutes).map(([pid, mins]) => ({ playerId: parseInt(pid), ...mins })),
      }),
    });

    // PATCH current and future blockplayer DB records
    await Promise.all(
      plan.slice(currentBlockIdx).flatMap((block) => {
        const bp = block.blockPlayers.find((bp) => bp.playerId === playerId);
        if (!bp || !bp.id || !bp.isOnField) return [];
        return [api(`/api/blockplayers/${bp.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isOnField: false, role: null }),
        })];
      })
    );

    setPlan((prev) =>
      prev.map((block, i) => {
        if (i < currentBlockIdx) return block;
        return {
          ...block,
          blockPlayers: block.blockPlayers.map((bp) =>
            bp.playerId === playerId ? { ...bp, isOnField: false, role: null } : bp
          ),
        };
      })
    );

    setLeaveSheet(null);
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const playerName = (id) => {
    const p = players.find((pl) => pl.id === id);
    if (!p) return `#${id}`;
    const firstName = p.name.split(' ')[0];
    const hasDuplicate = players.some((pl) => pl.id !== p.id && pl.name.split(' ')[0] === firstName);
    if (hasDuplicate) {
      const lastName = p.name.split(' ')[1];
      return lastName ? `${firstName} ${lastName[0]}` : firstName;
    }
    return firstName;
  };

  if (!activeSeason) return <div className="loading">No active season</div>;
  if (loading) return <div className="loading">Loading plan…</div>;

  if (isGameOver) {
    const gameLabel = selectedGame
      ? `Game ${selectedGame.gameNumber}${selectedGame.date ? ` · ${new Date(selectedGame.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
      : 'Game';
    const summaryRows = Object.entries(playerMinutes)
      .map(([id, mins]) => ({ id: parseInt(id), ...mins }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);
    return (
      <div>
        <h2 className="section-title">Game Over</h2>
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>{gameLabel}</div>
          <table className="gameover-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Min</th>
                <th>Off</th>
                <th>Def</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.id}>
                  <td>{playerName(row.id)}</td>
                  <td>{Math.round(row.totalMinutes)}</td>
                  <td>{Math.round(row.offenseMinutes)}</td>
                  <td>{Math.round(row.defenseMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="primary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => {
            setActiveGame(null);
            setIsGameOver(false);
            setActiveTab('season');
          }}>
            Done
          </button>
        </div>
        <style>{`
          .gameover-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
          .gameover-table th { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 2px solid var(--border); font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; }
          .gameover-table td { padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); }
          .gameover-table tr:last-child td { border-bottom: none; }
        `}</style>
      </div>
    );
  }

  const currentBlock = plan ? plan[currentBlockIdx] : null;
  const onField = currentBlock?.blockPlayers.filter((bp) => bp.isOnField) || [];
  const sitting = currentBlock?.blockPlayers.filter((bp) => !bp.isOnField) || [];
  const absentPlayers = players.filter((p) => !currentBlock?.blockPlayers.some((bp) => bp.playerId === p.id));

  return (
    <div>
      <h2 className="section-title">
        {selectedGame
          ? `Game ${selectedGame.gameNumber}${selectedGame.date ? ` · ${new Date(selectedGame.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
          : 'Game'}
      </h2>

      {error && <div className="error">{error}</div>}

      {!plan && (
        <div className="card">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No game in progress. Go to Game Setup to start a game.
          </p>
        </div>
      )}

      {plan && currentBlock && (
        <>
          {/* Timer */}
          <div className="timer-card card">
            {currentBlock && !isHalftime && (
              <div className="block-label">H{currentBlock.half} · Block {currentBlock.blockNumber}</div>
            )}
            {isHalftime ? (
              <>
                <div className="halftime-heading">Halftime</div>
                <div className="halftime-countdown">{formatTime(halftimeSeconds)}</div>
                <button className="primary" style={{ width: '100%' }} onClick={() => {
                  setIsHalftime(false);
                  setHalfTimerSeconds(0);
                  setHalfTimerRunning(true);
                  setBlockStartTime(Date.now());
                  setTimerRunning(true);
                }}>
                  Start 2nd Half
                </button>
              </>
            ) : (
              <>
                <div className={`timer-display ${timerSeconds <= 90 ? 'expired' : ''}`}>
                  {formatTime(timerSeconds)}
                </div>
                {halfTimerRunning && (
                  <div className="half-timer">Half: {formatTime(halfTimerSeconds)}</div>
                )}
                <div className="timer-btns">
                  <button
                    className={timerRunning ? 'secondary' : 'primary'}
                    onClick={() => {
                      if (!timerRunning && blockStartTime === null) {
                        setBlockStartTime(Date.now());
                        setHalfTimerRunning(true);
                      }
                      setTimerRunning((r) => !r);
                    }}
                  >
                    {timerRunning ? 'Pause' : timerSeconds === BLOCK_DURATION ? 'Start' : 'Resume'}
                  </button>
                  <button className="secondary" onClick={() => { setTimerSeconds(BLOCK_DURATION); setTimerRunning(false); }}>
                    Reset
                  </button>
                  <button className="primary" onClick={advanceBlock} disabled={isGameOver}>
                    Next Block →
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Score */}
          <div className="card">
            <div className="score-row">
              <span className="score-display">Us {goals.filter((g) => !g.isOpponent).length} · Them {goals.filter((g) => g.isOpponent).length}</span>
            </div>
            <div className="score-btns">
              <button className="primary" style={{ flex: 1 }} onClick={() => setScorerSheet(true)}>+ We Scored</button>
              <button className="secondary" style={{ flex: 1 }} onClick={async () => {
                const res = await api(`/api/games/${selectedGame.id}/goals`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ isOpponent: true }),
                });
                const goal = await res.json();
                setGoals((prev) => [...prev, goal]);
              }}>+ They Scored</button>
            </div>
            {goals.length > 0 && (
              <div className="goal-log">
                {[...goals].reverse().map((g) => (
                  <div key={g.id} className="goal-row">
                    <span>⚽ {g.isOpponent ? 'Opponent' : (g.player ? playerName(g.playerId) : 'Unknown')}</span>
                    <button className="goal-undo" onClick={async () => {
                      await api(`/api/games/${selectedGame.id}/goals/${g.id}`, { method: 'DELETE' });
                      setGoals((prev) => prev.filter((x) => x.id !== g.id));
                    }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Field */}
          <div className="card">
            <h3 className="subsection">On Field ({onField.length})</h3>
            <div className="player-grid">
              {onField.filter((bp) => bp.role !== 'goalkeeper').map((bp) => (
                <button
                  key={bp.id ?? bp.playerId}
                  className={`field-btn role-${bp.role || 'none'}`}
                  onClick={() => toggleRole(bp.id, bp.role)}
                >
                  <span className="field-name">{playerName(bp.playerId)}</span>
                  <span className="field-role">{bp.role || '—'}</span>

                </button>
              ))}
            </div>
            {onField.filter((bp) => bp.role === 'goalkeeper').map((bp) => (
              <div key={bp.id ?? bp.playerId} style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                <div className="field-btn role-goalkeeper" style={{ width: '100%', flexDirection: 'row', justifyContent: 'center', gap: '0.5rem' }}>
                  <span className="field-name">{playerName(bp.playerId)}</span>
                  <span className="field-role">GOALKEEPER</span>
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <h3 className="subsection" style={{ margin: 0 }}>Sitting ({sitting.length})</h3>
              {absentPlayers.length > 0 && (
                <button className="add-arrival-btn" onClick={() => setArrivalSheet(true)}>+ Add</button>
              )}
            </div>
            <div className="sitting-list">
              {sitting.map((bp) => (
                <div key={bp.id} className="sitting-player">
                  {playerName(bp.playerId)}
                </div>
              ))}
            </div>
          </div>

          {(() => {
            const nextBlock = !isHalftime && currentBlockIdx < 5 ? plan[currentBlockIdx + 1] : null;
            if (!nextBlock) return null;
            const comingOff = currentBlock.blockPlayers.filter((bp) =>
              bp.isOnField && nextBlock.blockPlayers.find((n) => n.playerId === bp.playerId && !n.isOnField)
            );
            if (comingOff.length === 0) return null;
            return (
              <div className="card">
                <h3 className="subsection">Coming Off</h3>
                <div className="sitting-list">
                  {comingOff.map((bp) => (
                    <div key={bp.playerId} className="sitting-player">{playerName(bp.playerId)}</div>
                  ))}
                </div>
              </div>
            );
          })()}
          {arrivalSheet && (
            <>
              <div className="sheet-backdrop" onClick={() => setArrivalSheet(false)} />
              <div className="sheet" onClick={(e) => e.stopPropagation()}>
                <div className="sheet-title">Late Arrival</div>
                <div className="sheet-sub">Select a player who just arrived.</div>
                <div className="sheet-list">
                  {absentPlayers.map((p) => (
                    <button key={p.id} className="sheet-row" onClick={() => doLateArrival(p.id)}>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                    </button>
                  ))}
                </div>
                <button className="sheet-cancel" onClick={() => setArrivalSheet(false)}>Cancel</button>
              </div>
            </>
          )}

          {scorerSheet && (
            <>
              <div className="sheet-backdrop" onClick={() => setScorerSheet(false)} />
              <div className="sheet" onClick={(e) => e.stopPropagation()}>
                <div className="sheet-title">Who scored?</div>
                <div className="sheet-list">
                  {onField.filter((bp) => bp.role !== 'goalkeeper').map((bp) => (
                    <button key={bp.playerId} className="sheet-row" onClick={async () => {
                      const res = await api(`/api/games/${selectedGame.id}/goals`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ playerId: bp.playerId, isOpponent: false }),
                      });
                      const goal = await res.json();
                      setGoals((prev) => [...prev, goal]);
                      setScorerSheet(false);
                    }}>
                      <span style={{ fontWeight: 600 }}>{playerName(bp.playerId)}</span>
                    </button>
                  ))}
                </div>
                <button className="sheet-cancel" onClick={() => setScorerSheet(false)}>Cancel</button>
              </div>
            </>
          )}

          {leaveSheet && (() => {
            const leavingPlayer = players.find((p) => p.id === leaveSheet.playerId);
            const elapsed = blockStartTime ? (Date.now() - blockStartTime) / 60000 : 0;
            const credit = elapsed >= 4 ? 8 : 4;
            return (
              <>
                <div className="sheet-backdrop" onClick={() => setLeaveSheet(null)} />
                <div className="sheet" onClick={(e) => e.stopPropagation()}>
                  <div className="sheet-title">Early Leave</div>
                  <div className="sheet-sub">
                    {leavingPlayer?.name} is leaving early. They'll receive {credit} min credit ({elapsed >= 4 ? 'full' : 'half'} block).
                  </div>
                  <button className="primary" style={{ width: '100%', marginBottom: '0.5rem' }} onClick={doEarlyLeave}>
                    Confirm Leave
                  </button>
                  <button className="sheet-cancel" onClick={() => setLeaveSheet(null)}>Cancel</button>
                </div>
              </>
            );
          })()}
        </>
      )}

      <style>{`
        .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 1rem; }
        .subsection { font-size: 0.9rem; font-weight: 700; margin-bottom: 0.75rem; }
        .field-label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.4rem; }
        .select { width: 100%; font-size: 1rem; padding: 0.6rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius); background: white; }
        .timer-card { text-align: center; }
        .block-label { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.5rem; }
        .timer-display { font-size: 3rem; font-weight: 700; font-variant-numeric: tabular-nums; margin-bottom: 0.25rem; }
        .timer-display.expired { color: #dc3545; }
        .half-timer { font-size: 0.85rem; color: var(--text-muted); font-variant-numeric: tabular-nums; margin-bottom: 1rem; }
        .halftime-heading { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.4rem; }
        .halftime-countdown { font-size: 2.5rem; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-muted); margin-bottom: 1rem; }
        .timer-btns { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
        .timer-btns button { flex: 1; min-width: 80px; }
        .player-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
        .field-btn { display: flex; flex-direction: column; align-items: center; padding: 0.4rem 0.5rem; min-height: 48px; border-radius: var(--radius); }
        .field-btn.role-offense { background: #cce5ff; color: #004085; }
        .field-btn.role-defense { background: #d4edda; color: #155724; }
        .field-btn.role-goalkeeper { background: #fff3cd; color: #856404; }
        .field-btn.role-none { background: var(--border); color: var(--text); }
        .field-name { font-weight: 600; font-size: 0.95rem; }
        .field-role { font-size: 0.7rem; margin-top: 2px; text-transform: uppercase; opacity: 0.8; }
        .sitting-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .sitting-player { background: #f8d7da; color: #721c24; padding: 0.4rem 0.75rem; border-radius: var(--radius); font-size: 0.9rem; }
        .field-leave { position: absolute; top: 4px; right: 4px; font-size: 0.8rem; opacity: 0.6; line-height: 1; padding: 2px 4px; }
        .field-btn { position: relative; }
        .add-arrival-btn { font-size: 0.75rem; color: var(--green); background: none; border: none; padding: 0; min-height: unset; font-weight: 600; cursor: pointer; }
        .sheet-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 100; }
        .sheet { position: fixed; bottom: 0; left: 0; right: 0; background: white; border-radius: 16px 16px 0 0; padding: 1.25rem 1rem 2rem; z-index: 101; box-shadow: 0 -4px 24px rgba(0,0,0,0.15); }
        .sheet-title { font-size: 1.05rem; font-weight: 700; margin-bottom: 0.2rem; }
        .sheet-sub { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem; }
        .sheet-list { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1rem; }
        .sheet-row { display: flex; align-items: center; padding: 0.75rem 0.5rem; border: 1px solid var(--border); border-radius: var(--radius); background: white; min-height: 48px; cursor: pointer; text-align: left; }
        .sheet-cancel { width: 100%; padding: 0.75rem; background: var(--border); color: var(--text); border: none; border-radius: var(--radius); font-size: 0.95rem; font-weight: 600; min-height: 48px; cursor: pointer; }
        .score-row { text-align: center; margin-bottom: 0.75rem; }
        .score-display { font-size: 1.4rem; font-weight: 700; }
        .score-btns { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
        .goal-log { display: flex; flex-direction: column; gap: 0.25rem; border-top: 1px solid var(--border); padding-top: 0.6rem; }
        .goal-row { display: flex; align-items: center; justify-content: space-between; font-size: 0.9rem; padding: 0.15rem 0; }
        .goal-undo { background: none; border: none; color: var(--text-muted); font-size: 1rem; cursor: pointer; padding: 0 0.25rem; min-height: unset; line-height: 1; }
        .subs-list { display: flex; flex-direction: column; gap: 0.25rem; }
        .sub-row { font-size: 0.95rem; padding: 0.2rem 0; }
        .sub-off { color: #721c24; }
        .sub-on { color: #155724; }
        .sub-arrow { color: var(--text-muted); }
      `}</style>
    </div>
  );
}
