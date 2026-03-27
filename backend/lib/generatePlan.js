/**
 * Gaffer plan generator
 *
 * Rules:
 * - 11 players, 7 on field per block, 4 sitting
 * - 6 blocks: H1B1, H1B2, H1B3, H2B1, H2B2, H2B3
 * - 2 goalies per game (one per half), each assigned via goalieHalf
 * - Goalie plays full half in goal, then gets exactly 2 field blocks the other half (sits 1)
 * - No player sits two consecutive blocks (including H1B3 → H2B1 boundary)
 * - Debt-weighted selection: players who have sat more (higher sitPriority) sit sooner
 *   In-game sit count is the primary tiebreaker so distribution is even within a game
 */

function generatePlan(game, allGames, locks = []) {
  const attending = game.gamePlayers.filter((gp) => gp.attending);
  const playerCount = attending.length;

  if (playerCount < 7) {
    throw new Error(`Not enough players: need at least 7, have ${playerCount}`);
  }

  // Build sit-priority map from historical data (excluding current game)
  // Higher value = player needs to sit more = chosen first to sit
  const sitPriorityMap = buildSitPriorityMap(attending, allGames, game.id);

  // Identify goalies
  const h1Goalie = attending.find((gp) => gp.goalieHalf === 1);
  const h2Goalie = attending.find((gp) => gp.goalieHalf === 2);

  const BLOCKS = [
    { half: 1, blockNumber: 1 },
    { half: 1, blockNumber: 2 },
    { half: 1, blockNumber: 3 },
    { half: 2, blockNumber: 1 },
    { half: 2, blockNumber: 2 },
    { half: 2, blockNumber: 3 },
  ];

  const blockIndex = (half, bn) => (half - 1) * 3 + (bn - 1);

  // Build lock map: { "half-blockNumber": { playerId: { isOnField, role } } }
  const lockMap = {};
  for (const lock of locks) {
    const key = `${lock.half}-${lock.blockNumber}`;
    if (!lockMap[key]) lockMap[key] = {};
    lockMap[key][lock.playerId] = { isOnField: lock.isOnField, role: lock.role };
  }

  // Per-player sit tracker: 6 booleans (true = sitting that block)
  const sitTracker = {};
  // In-game sit count for tiebreaking within a game
  const inGameSits = {};
  for (const gp of attending) {
    sitTracker[gp.playerId] = [false, false, false, false, false, false];
    inGameSits[gp.playerId] = 0;
  }

  const plan = [];

  for (const { half, blockNumber } of BLOCKS) {
    const bi = blockIndex(half, blockNumber);
    const lockKey = `${half}-${blockNumber}`;
    const blockLocks = lockMap[lockKey] || {};

    // Determine current half's goalie
    const goalie = half === 1 ? h1Goalie : h2Goalie;

    // Build locked-in and locked-out sets
    const lockedIn = new Set();
    const lockedOut = new Set();

    // Current-half goalie is always on field in goal
    if (goalie) lockedIn.add(goalie.playerId);

    for (const [playerIdStr, { isOnField }] of Object.entries(blockLocks)) {
      const pid = parseInt(playerIdStr);
      if (isOnField) lockedIn.add(pid);
      else lockedOut.add(pid);
    }

    // Eligible to volunteer as sitters: not locked in, not sitting previous block
    const eligible = attending
      .map((gp) => gp.playerId)
      .filter((pid) => {
        if (lockedIn.has(pid)) return false;
        if (lockedOut.has(pid)) return true; // forced sit — always eligible
        if (bi > 0 && sitTracker[pid][bi - 1]) return false; // consecutive sit not allowed
        return true;
      });

    const sitCount = playerCount - 7;

    // Players forced to sit (locked out)
    const forcedSit = attending
      .map((gp) => gp.playerId)
      .filter((pid) => lockedOut.has(pid));

    const sittingThisBlock = new Set(forcedSit);
    const remainingSitCount = sitCount - forcedSit.length;

    // Sort volunteer pool:
    //   Primary: fewer in-game sits so far → higher priority to sit (ascending inGameSits)
    //   Secondary: higher historical sitPriority → higher priority to sit (descending)
    const volunteerPool = eligible
      .filter((pid) => !lockedOut.has(pid))
      .sort((a, b) => {
        const sitDiff = inGameSits[a] - inGameSits[b]; // fewer sits = higher priority
        if (sitDiff !== 0) return sitDiff;
        return (sitPriorityMap[b] || 0) - (sitPriorityMap[a] || 0);
      });

    for (const pid of volunteerPool) {
      if (sittingThisBlock.size >= sitCount) break;

      // Off-half goalie rule: can sit at most 1 block in their field half
      const isH1GoalieInH2 = h1Goalie && pid === h1Goalie.playerId && half === 2;
      const isH2GoalieInH1 = h2Goalie && pid === h2Goalie.playerId && half === 1;
      if (isH1GoalieInH2 || isH2GoalieInH1) {
        const halfStart = (half - 1) * 3;
        const satSoFarThisHalf = sitTracker[pid].slice(halfStart, bi).filter(Boolean).length;
        if (satSoFarThisHalf >= 1) continue; // already sat once this half
      }

      sittingThisBlock.add(pid);
    }

    // Build assignments and update trackers
    const assignments = [];
    for (const gp of attending) {
      const pid = gp.playerId;
      const isSitting = sittingThisBlock.has(pid);
      const isOnField = !isSitting;

      let role = null;
      if (isOnField) {
        if (blockLocks[pid]) {
          role = blockLocks[pid].role;
        } else if (goalie && pid === goalie.playerId) {
          role = 'goalkeeper';
        }
      }

      assignments.push({ playerId: pid, isOnField, role });
      sitTracker[pid][bi] = !isOnField;
      if (!isOnField) inGameSits[pid]++;
    }

    plan.push({ half, blockNumber, assignments });
  }

  return plan;
}

/**
 * Build sit-priority map from historical data.
 * Higher value = player has played fewer minutes than expected = should sit sooner now.
 *
 * For each past game the player attended:
 *   expectedMinutes = teamTotalMinutes / attendingCount
 *   debt += expectedMinutes - player.totalMinutes
 *
 * Positive debt = played less than their share = higher sit priority.
 */
function buildSitPriorityMap(attending, allGames, currentGameId) {
  const map = {};

  for (const gp of attending) {
    const pid = gp.playerId;
    let debt = 0;

    for (const game of allGames) {
      if (game.id === currentGameId) continue;

      const gamePlayer = game.gamePlayers.find((g) => g.playerId === pid);
      if (!gamePlayer || !gamePlayer.attending) continue;

      const attendingGPs = game.gamePlayers.filter((g) => g.attending);
      const teamMinutes = attendingGPs.reduce((sum, g) => sum + g.totalMinutes, 0);
      const expectedMinutes = attendingGPs.length > 0 ? teamMinutes / attendingGPs.length : 0;
      debt += expectedMinutes - gamePlayer.totalMinutes;
    }

    map[pid] = debt; // positive = played less than expected = higher sit priority
  }

  return map;
}

module.exports = generatePlan;
