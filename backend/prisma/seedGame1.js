require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = require('../db');

// Player IDs as confirmed in the DB
const P = {
  blair:    1,
  cj:       2,
  ellie:    3,
  grace:    4,
  kate:     5,
  lucyb:    6,
  lucyr:    7,
  maitland: 8,
  shea:     9,
  tara:     10,
  wesley:   11,
};

const ALL_PLAYER_IDS = Object.values(P);

// GamePlayer records — all 11 attended, Tara H1 goalie, Lucy R H2 goalie
const GAME_PLAYERS = [
  { playerId: P.blair,    goalieHalf: null, totalMinutes: 32, offenseMinutes: 8,  defenseMinutes: 24, gkMinutes: 0  },
  { playerId: P.cj,       goalieHalf: null, totalMinutes: 31, offenseMinutes: 31, defenseMinutes: 0,  gkMinutes: 0  },
  { playerId: P.ellie,    goalieHalf: null, totalMinutes: 23, offenseMinutes: 22, defenseMinutes: 1,  gkMinutes: 0  },
  { playerId: P.grace,    goalieHalf: null, totalMinutes: 32, offenseMinutes: 24, defenseMinutes: 8,  gkMinutes: 0  },
  { playerId: P.kate,     goalieHalf: null, totalMinutes: 32, offenseMinutes: 15, defenseMinutes: 17, gkMinutes: 0  },
  { playerId: P.lucyb,    goalieHalf: null, totalMinutes: 31, offenseMinutes: 10, defenseMinutes: 21, gkMinutes: 0  },
  { playerId: P.lucyr,    goalieHalf: 2,    totalMinutes: 31, offenseMinutes: 0,  defenseMinutes: 8,  gkMinutes: 24 },
  { playerId: P.maitland, goalieHalf: null, totalMinutes: 32, offenseMinutes: 24, defenseMinutes: 7,  gkMinutes: 0  },
  { playerId: P.shea,     goalieHalf: null, totalMinutes: 23, offenseMinutes: 0,  defenseMinutes: 23, gkMinutes: 0  },
  { playerId: P.tara,     goalieHalf: 1,    totalMinutes: 32, offenseMinutes: 8,  defenseMinutes: 0,  gkMinutes: 24 },
  { playerId: P.wesley,   goalieHalf: null, totalMinutes: 32, offenseMinutes: 0,  defenseMinutes: 31, gkMinutes: 0  },
];

// Block assignments — 7 on field per block, 4 sitting
// goalie field denotes the GK for that block (gets role='goalkeeper')
const BLOCK_ASSIGNMENTS = [
  {
    half: 1, blockNumber: 1, goalie: P.tara,
    onField: [P.blair, P.cj, P.grace, P.kate, P.maitland, P.tara, P.wesley],
  },
  {
    half: 1, blockNumber: 2, goalie: P.tara,
    onField: [P.cj, P.ellie, P.lucyb, P.lucyr, P.maitland, P.shea, P.tara],
  },
  {
    half: 1, blockNumber: 3, goalie: P.tara,
    onField: [P.blair, P.ellie, P.grace, P.kate, P.shea, P.tara, P.wesley],
  },
  {
    half: 2, blockNumber: 1, goalie: P.lucyr,
    onField: [P.blair, P.cj, P.grace, P.kate, P.lucyb, P.lucyr, P.maitland],
  },
  {
    half: 2, blockNumber: 2, goalie: P.lucyr,
    onField: [P.cj, P.ellie, P.lucyb, P.lucyr, P.shea, P.tara, P.wesley],
  },
  {
    half: 2, blockNumber: 3, goalie: P.lucyr,
    onField: [P.blair, P.grace, P.kate, P.lucyr, P.maitland, P.tara, P.wesley],
  },
];

async function main() {
  console.log('Loading Game 1 data for Season 1...');

  // Upsert Game 1
  let game = await prisma.game.findFirst({ where: { seasonId: 1, gameNumber: 1 } });
  if (game) {
    game = await prisma.game.update({
      where: { id: game.id },
      data: { date: new Date('2025-03-26') },
    });
    console.log(`Updated game id=${game.id}`);
  } else {
    game = await prisma.game.create({
      data: { seasonId: 1, gameNumber: 1, date: new Date('2025-03-26') },
    });
    console.log(`Created game id=${game.id}`);
  }

  // Upsert GamePlayers (all attending)
  for (const gp of GAME_PLAYERS) {
    await prisma.gamePlayer.upsert({
      where: { gameId_playerId: { gameId: game.id, playerId: gp.playerId } },
      update: {
        attending:      true,
        goalieHalf:     gp.goalieHalf,
        totalMinutes:   gp.totalMinutes,
        offenseMinutes: gp.offenseMinutes,
        defenseMinutes: gp.defenseMinutes,
        gkMinutes:      gp.gkMinutes,
      },
      create: {
        gameId:         game.id,
        playerId:       gp.playerId,
        attending:      true,
        goalieHalf:     gp.goalieHalf,
        totalMinutes:   gp.totalMinutes,
        offenseMinutes: gp.offenseMinutes,
        defenseMinutes: gp.defenseMinutes,
        gkMinutes:      gp.gkMinutes,
      },
    });
    console.log(`  GamePlayer playerId=${gp.playerId} total=${gp.totalMinutes}min`);
  }

  // Upsert Blocks and BlockPlayers
  for (const ba of BLOCK_ASSIGNMENTS) {
    const block = await prisma.block.upsert({
      where: { gameId_half_blockNumber: { gameId: game.id, half: ba.half, blockNumber: ba.blockNumber } },
      update: {},
      create: { gameId: game.id, half: ba.half, blockNumber: ba.blockNumber },
    });
    console.log(`  Block H${ba.half}B${ba.blockNumber} id=${block.id}`);

    const onFieldSet = new Set(ba.onField);

    for (const pid of ALL_PLAYER_IDS) {
      const isOnField = onFieldSet.has(pid);
      const role = isOnField && pid === ba.goalie ? 'goalkeeper' : null;

      await prisma.blockPlayer.upsert({
        where: { blockId_playerId: { blockId: block.id, playerId: pid } },
        update: { isOnField, role },
        create: { blockId: block.id, playerId: pid, isOnField, role },
      });
    }
  }

  console.log('Game 1 load complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
