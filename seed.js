/**
 * Seed script — populates Game Week 1 with 10 test players
 * Uses real 2026 World Cup Group Stage Week 1 fixtures
 *
 * Run locally:  node seed.js
 * Run with clear: node seed.js --clear
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

function calcProfit(result, odds, stake = 5) {
  if (result === 'won' && odds) return parseFloat(((stake * odds) - stake).toFixed(2));
  if (result === 'lost') return -stake;
  return 0;
}

// Real 2026 World Cup Group Stage Week 1 fixtures with Bet365-style odds
const SEED_BETS = [
  {
    playerName: 'Luke',
    selection:  'England to Win',
    eventName:  'England vs Croatia',
    odds:       9.00,   // 8/1 — big price, England strong favourites but Croatia dangerous
    result:     'pending',
  },
  {
    playerName: 'Jamie',
    selection:  'Both Teams to Score',
    eventName:  'Brazil vs Morocco',
    odds:       2.10,   // Even money roughly — Morocco attack decent
    result:     'won',
  },
  {
    playerName: 'Sarah',
    selection:  'Germany to Win',
    eventName:  'Germany vs Curacao',
    odds:       1.25,   // 1/4 — near-certainty
    result:     'won',
  },
  {
    playerName: 'Tom',
    selection:  'Netherlands to Win',
    eventName:  'Netherlands vs Japan',
    odds:       1.62,   // 8/13 — Japan caused an upset!
    result:     'lost',
  },
  {
    playerName: 'Mike',
    selection:  'France to Win',
    eventName:  'France vs Senegal',
    odds:       1.67,   // 4/6
    result:     'won',
  },
  {
    playerName: 'Dave',
    selection:  'Mexico to Win',
    eventName:  'Mexico vs South Africa',
    odds:       1.62,   // 8/13 — hosts opening game
    result:     'won',
  },
  {
    playerName: 'Emma',
    selection:  'Argentina to Win',
    eventName:  'Argentina vs Algeria',
    odds:       1.40,   // 2/5 — reigning champs heavy favourites
    result:     'won',
  },
  {
    playerName: 'Chris',
    selection:  'Over 2.5 Goals',
    eventName:  'Spain vs Cape Verde',
    odds:       1.90,   // 9/10 — Spain expected to smash it
    result:     'won',
  },
  {
    playerName: 'Jess',
    selection:  'USA to Win',
    eventName:  'USA vs Paraguay',
    odds:       2.10,   // 11/10 — host nation pressure, Paraguay solid
    result:     'lost',
  },
  {
    playerName: 'Ryan',
    selection:  'Belgium to Win',
    eventName:  'Belgium vs Egypt',
    odds:       1.67,   // 4/6
    result:     'won',
  },
];

async function seed(clear = false) {
  const client = await pool.connect();
  try {
    console.log('\n⚽  World Cup Bets — Seed Script\n');

    // Get game week 1
    const { rows: weeks } = await client.query(
      'SELECT * FROM game_weeks WHERE week_number = 1'
    );
    if (!weeks.length) {
      console.error('✗  Game weeks not found — run the server first to initialise the DB');
      process.exit(1);
    }
    const gw1 = weeks[0];
    console.log(`   Game week: ${gw1.name} (id: ${gw1.id})`);

    if (clear) {
      // Remove only bets for game week 1 seed players
      const names = SEED_BETS.map(b => b.playerName);
      await client.query(
        `DELETE FROM bets WHERE game_week_id = $1
           AND player_id IN (
             SELECT id FROM players WHERE name = ANY($2)
           )`,
        [gw1.id, names]
      );
      console.log('   Cleared existing seed bets\n');
    }

    let created = 0;
    let skipped = 0;

    for (const bet of SEED_BETS) {
      // Upsert player
      let player;
      const { rows: existing } = await client.query(
        'SELECT * FROM players WHERE LOWER(name) = LOWER($1)', [bet.playerName]
      );
      if (existing.length) {
        player = existing[0];
      } else {
        const { rows } = await client.query(
          'INSERT INTO players (name) VALUES ($1) RETURNING *', [bet.playerName]
        );
        player = rows[0];
      }

      // Check for duplicate bet
      const { rows: existingBet } = await client.query(
        'SELECT id FROM bets WHERE player_id = $1 AND game_week_id = $2',
        [player.id, gw1.id]
      );
      if (existingBet.length) {
        console.log(`   ⚡  ${bet.playerName.padEnd(8)} — already has a bet, skipping`);
        skipped++;
        continue;
      }

      const profit = calcProfit(bet.result, bet.odds, 5);
      await client.query(
        `INSERT INTO bets
           (player_id, game_week_id, selection, event_name, odds, stake, result, profit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [player.id, gw1.id, bet.selection, bet.eventName,
         bet.odds, 5.00, bet.result, profit]
      );

      const profitStr = bet.result === 'pending'
        ? '⏳ pending'
        : profit >= 0 ? `✅ +£${profit.toFixed(2)}` : `❌ -£${Math.abs(profit).toFixed(2)}`;

      console.log(
        `   ${bet.playerName.padEnd(8)}` +
        `  ${bet.eventName.padEnd(26)}` +
        `  ${bet.selection.padEnd(22)}` +
        `  ${String(bet.odds).padEnd(5)}  ${profitStr}`
      );
      created++;
    }

    console.log(`\n   ✓ Done — ${created} bets created, ${skipped} skipped\n`);
    console.log('   Leaderboard preview:\n');

    const { rows: lb } = await client.query(
      `SELECT p.name, COALESCE(SUM(b.profit),0) as profit,
              COUNT(CASE WHEN b.result='won' THEN 1 END) as wins,
              COUNT(b.id) as total
       FROM players p
       LEFT JOIN bets b ON p.id = b.player_id
       GROUP BY p.id, p.name
       ORDER BY profit DESC`
    );

    lb.forEach((r, i) => {
      const profit = parseFloat(r.profit);
      const p = profit >= 0 ? `+£${profit.toFixed(2)}` : `-£${Math.abs(profit).toFixed(2)}`;
      console.log(`   ${String(i+1).padStart(2)}.  ${r.name.padEnd(8)}  ${p.padStart(8)}  ${r.wins}W/${r.total}P`);
    });

    console.log('');
  } finally {
    client.release();
    await pool.end();
  }
}

const clear = process.argv.includes('--clear');
seed(clear).catch(err => { console.error(err); process.exit(1); });
