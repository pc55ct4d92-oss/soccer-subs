const express = require('express');
const router = express.Router();
const prisma = require('../db');
const generatePlan = require('../lib/generatePlan');

// PATCH /api/games/:id
router.patch('/:id', async (req, res) => {
  try {
    const { gameNumber, date, notes } = req.body;
    const game = await prisma.game.update({
      where: { id: parseInt(req.params.id) },
      data: { gameNumber, date: date ? new Date(date) : undefined, notes },
    });
    res.json(game);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/games/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.game.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:id/setup
router.get('/:id/setup', async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        gamePlayers: { include: { player: true } },
      },
    });
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json(game);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games/:id/setup
// Body: { players: [{ playerId, attending, goalieHalf }] }
router.post('/:id/setup', async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    const { players } = req.body;

    // Upsert each GamePlayer record
    const results = await Promise.all(
      players.map(({ playerId, attending, goalieHalf }) =>
        prisma.gamePlayer.upsert({
          where: { gameId_playerId: { gameId, playerId } },
          update: { attending: attending ?? true, goalieHalf: goalieHalf ?? null },
          create: { gameId, playerId, attending: attending ?? true, goalieHalf: goalieHalf ?? null },
        })
      )
    );

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games/:id/generate-plan
// Body: { locks: [{ half, blockNumber, playerId, isOnField, role }], fromBlockIndex?: number, newPlayerId?: number }
router.post('/:id/generate-plan', async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    const { locks = [], fromBlockIndex, newPlayerId } = req.body;

    // Upsert late arrival before loading the game
    if (newPlayerId) {
      await prisma.gamePlayer.upsert({
        where: { gameId_playerId: { gameId, playerId: newPlayerId } },
        update: { attending: true },
        create: { gameId, playerId: newPlayerId, attending: true },
      });
    }

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        gamePlayers: { include: { player: true } },
      },
    });
    if (!game) return res.status(404).json({ error: 'Game not found' });

    // Load season stats for debt calculation
    const seasonId = game.seasonId;
    const allGames = await prisma.game.findMany({
      where: { seasonId },
      include: {
        gamePlayers: true,
        blocks: { include: { blockPlayers: true } },
      },
    });

    // If fromBlockIndex > 0, freeze all earlier blocks by converting their DB records into locks
    let mergedLocks = locks;
    if (fromBlockIndex > 0) {
      const BLOCKS = [
        { half: 1, blockNumber: 1 },
        { half: 1, blockNumber: 2 },
        { half: 1, blockNumber: 3 },
        { half: 2, blockNumber: 1 },
        { half: 2, blockNumber: 2 },
        { half: 2, blockNumber: 3 },
      ];
      const frozenBlocks = BLOCKS.slice(0, fromBlockIndex);
      const existingBlocks = await prisma.block.findMany({
        where: { gameId, half: { in: frozenBlocks.map((b) => b.half) } },
        include: { blockPlayers: true },
      });

      const existingLocks = [];
      for (const block of existingBlocks) {
        const blockDef = BLOCKS.find((b) => b.half === block.half && b.blockNumber === block.blockNumber);
        if (!blockDef) continue;
        const bi = BLOCKS.indexOf(blockDef);
        if (bi >= fromBlockIndex) continue;
        for (const bp of block.blockPlayers) {
          existingLocks.push({ half: block.half, blockNumber: block.blockNumber, playerId: bp.playerId, isOnField: bp.isOnField, role: bp.role });
        }
      }

      // Existing block locks take precedence for earlier blocks; user locks apply for later blocks
      const userLocksForLaterBlocks = locks.filter((l) => {
        const bi = BLOCKS.findIndex((b) => b.half === l.half && b.blockNumber === l.blockNumber);
        return bi >= fromBlockIndex;
      });
      mergedLocks = [...existingLocks, ...userLocksForLaterBlocks];
    }

    const plan = generatePlan(game, allGames, mergedLocks);

    // Persist the plan to Block + BlockPlayer tables
    for (const block of plan) {
      const dbBlock = await prisma.block.upsert({
        where: { gameId_half_blockNumber: { gameId, half: block.half, blockNumber: block.blockNumber } },
        update: {},
        create: { gameId, half: block.half, blockNumber: block.blockNumber },
      });

      for (const assignment of block.assignments) {
        await prisma.blockPlayer.upsert({
          where: { blockId_playerId: { blockId: dbBlock.id, playerId: assignment.playerId } },
          update: { isOnField: assignment.isOnField, role: assignment.role },
          create: {
            blockId: dbBlock.id,
            playerId: assignment.playerId,
            isOnField: assignment.isOnField,
            role: assignment.role,
          },
        });
      }
    }

    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:id/plan
router.get('/:id/plan', async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    const blocks = await prisma.block.findMany({
      where: { gameId },
      orderBy: [{ half: 'asc' }, { blockNumber: 'asc' }],
      include: {
        blockPlayers: { include: { player: true } },
      },
    });
    res.json(blocks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games/:id/emergency-sub
// Body: { blockId, outPlayerId, inPlayerId, role }
router.post('/:id/emergency-sub', async (req, res) => {
  try {
    const { blockId, outPlayerId, inPlayerId, role } = req.body;

    const [outUpdate, inUpdate] = await Promise.all([
      prisma.blockPlayer.update({
        where: { blockId_playerId: { blockId, playerId: outPlayerId } },
        data: { isOnField: false, role: null },
      }),
      prisma.blockPlayer.upsert({
        where: { blockId_playerId: { blockId, playerId: inPlayerId } },
        update: { isOnField: true, role: role ?? null },
        create: { blockId, playerId: inPlayerId, isOnField: true, role: role ?? null },
      }),
    ]);

    res.json({ out: outUpdate, in: inUpdate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/games/:id/minutes
// Body: { players: [{ playerId, totalMinutes, offenseMinutes, defenseMinutes, gkMinutes }] }
router.patch('/:id/minutes', async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    const { players } = req.body;

    const results = await Promise.all(
      players.map(({ playerId, totalMinutes, offenseMinutes, defenseMinutes, gkMinutes }) =>
        prisma.gamePlayer.upsert({
          where: { gameId_playerId: { gameId, playerId } },
          update: { totalMinutes, offenseMinutes, defenseMinutes, gkMinutes },
          create: { gameId, playerId, totalMinutes, offenseMinutes, defenseMinutes, gkMinutes },
        })
      )
    );

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/games/:id/goals
router.get('/:id/goals', async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    const goals = await prisma.goal.findMany({
      where: { gameId },
      orderBy: { scoredAt: 'asc' },
      include: { player: { select: { name: true } } },
    });
    res.json(goals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/games/:id/goals
// Body: { playerId?: number, isOpponent?: boolean }
router.post('/:id/goals', async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    const { playerId, isOpponent = false } = req.body;

    const [goal] = await prisma.$transaction([
      prisma.goal.create({
        data: { gameId, playerId: playerId ?? null, isOpponent },
        include: { player: { select: { name: true } } },
      }),
      isOpponent
        ? prisma.game.update({ where: { id: gameId }, data: { theirScore: { increment: 1 } } })
        : prisma.game.update({ where: { id: gameId }, data: { ourScore: { increment: 1 } } }),
    ]);

    res.status(201).json(goal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/games/:id/goals/:goalId
router.delete('/:id/goals/:goalId', async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    const goalId = parseInt(req.params.goalId);

    const goal = await prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    const game = await prisma.game.findUnique({ where: { id: gameId } });

    await prisma.$transaction([
      prisma.goal.delete({ where: { id: goalId } }),
      goal.isOpponent
        ? prisma.game.update({ where: { id: gameId }, data: { theirScore: Math.max(0, game.theirScore - 1) } })
        : prisma.game.update({ where: { id: gameId }, data: { ourScore: Math.max(0, game.ourScore - 1) } }),
    ]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
