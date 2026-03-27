const express = require('express');
const router = express.Router();
const prisma = require('../db');

// GET /api/seasons
router.get('/', async (req, res) => {
  try {
    const seasons = await prisma.season.findMany({ orderBy: { year: 'desc' } });
    res.json(seasons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seasons
router.post('/', async (req, res) => {
  try {
    const { name, year, isActive } = req.body;
    const season = await prisma.season.create({ data: { name, year, isActive: isActive ?? false } });
    res.status(201).json(season);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/seasons/:id
router.patch('/:id', async (req, res) => {
  try {
    const { name, year, isActive } = req.body;
    const season = await prisma.season.update({
      where: { id: parseInt(req.params.id) },
      data: { name, year, isActive },
    });
    res.json(season);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/seasons/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.season.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/seasons/:id/players
router.get('/:id/players', async (req, res) => {
  try {
    const players = await prisma.player.findMany({
      where: { seasonId: parseInt(req.params.id) },
      orderBy: { name: 'asc' },
    });
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seasons/:id/players
router.post('/:id/players', async (req, res) => {
  try {
    const { name, isGKEligible } = req.body;
    const player = await prisma.player.create({
      data: { seasonId: parseInt(req.params.id), name, isGKEligible: isGKEligible ?? false },
    });
    res.status(201).json(player);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/seasons/:id/games
router.get('/:id/games', async (req, res) => {
  try {
    const games = await prisma.game.findMany({
      where: { seasonId: parseInt(req.params.id) },
      orderBy: { gameNumber: 'asc' },
    });
    res.json(games);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/seasons/:id/games
router.post('/:id/games', async (req, res) => {
  try {
    const { gameNumber, date, notes } = req.body;
    const game = await prisma.game.create({
      data: {
        seasonId: parseInt(req.params.id),
        gameNumber,
        date: date ? new Date(date) : null,
        notes,
      },
    });
    res.status(201).json(game);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/seasons/:id/stats
router.get('/:id/stats', async (req, res) => {
  try {
    const seasonId = parseInt(req.params.id);

    const players = await prisma.player.findMany({ where: { seasonId }, orderBy: { name: 'asc' } });

    const games = await prisma.game.findMany({
      where: { seasonId },
      include: {
        gamePlayers: true,
        blocks: { include: { blockPlayers: true } },
      },
    });

    const stats = players.map((player) => {
      let totalBlocksAttended = 0;
      let totalBlocksOnField = 0;
      let offenseBlocks = 0;
      let defenseBlocks = 0;
      let goalkeeperBlocks = 0;
      let gamesAttended = 0;
      let totalMinutes = 0;
      let debt = 0;

      for (const game of games) {
        const gp = game.gamePlayers.find((gp) => gp.playerId === player.id);
        if (!gp || !gp.attending) continue;

        gamesAttended++;
        const halfBlockCount = 3; // 3 blocks per half
        totalBlocksAttended += halfBlockCount * 2;
        totalMinutes += gp.totalMinutes;

        // Debt: expected minutes this game minus actual minutes
        const attendingGPs = game.gamePlayers.filter((gp) => gp.attending);
        const teamMinutes = attendingGPs.reduce((sum, gp) => sum + gp.totalMinutes, 0);
        const expectedMinutes = attendingGPs.length > 0 ? teamMinutes / attendingGPs.length : 0;
        debt += expectedMinutes - gp.totalMinutes;

        for (const block of game.blocks) {
          const bp = block.blockPlayers.find((bp) => bp.playerId === player.id);
          if (!bp) continue;
          if (bp.isOnField) {
            totalBlocksOnField++;
            if (bp.role === 'offense') offenseBlocks++;
            else if (bp.role === 'defense') defenseBlocks++;
            else if (bp.role === 'goalkeeper') goalkeeperBlocks++;
          }
        }
      }

      const totalBlocksSat = totalBlocksAttended - totalBlocksOnField;
      const avgSitRate = totalBlocksAttended > 0 ? totalBlocksSat / totalBlocksAttended : 0;

      return {
        playerId: player.id,
        name: player.name,
        isGKEligible: player.isGKEligible,
        gamesAttended,
        totalBlocksAttended,
        totalBlocksOnField,
        totalBlocksSat,
        offenseBlocks,
        defenseBlocks,
        goalkeeperBlocks,
        sitRate: avgSitRate,
        totalMinutes,
        debt,
      };
    });

    // Team average sit rate (kept for reference)
    const attendingStats = stats.filter((s) => s.totalBlocksAttended > 0);
    const totalAttended = attendingStats.reduce((sum, s) => sum + s.totalBlocksAttended, 0);
    const totalSat = attendingStats.reduce((sum, s) => sum + s.totalBlocksSat, 0);
    const teamAvgSitRate = totalAttended > 0 ? totalSat / totalAttended : 0;

    res.json({ teamAvgSitRate, players: stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
