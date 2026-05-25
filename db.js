const { Pool } = require('pg');

function sslConfig() {
  const url = process.env.DATABASE_URL || '';
  if (!url) return false;
  // No SSL for local or Railway's private internal network
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('.railway.internal')) return false;
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

const DEFAULT_WEEKS = [
  { name: 'Group Stage — Week 1', stage: 'group',    week_number: 1, is_active: true  },
  { name: 'Group Stage — Week 2', stage: 'group',    week_number: 2, is_active: false },
  { name: 'Group Stage — Week 3', stage: 'group',    week_number: 3, is_active: false },
  { name: 'Round of 32',          stage: 'knockout', week_number: 4, is_active: false },
  { name: 'Round of 16',          stage: 'knockout', week_number: 5, is_active: false },
  { name: 'Quarter Finals',       stage: 'knockout', week_number: 6, is_active: false },
  { name: 'Semi Finals',          stage: 'knockout', week_number: 7, is_active: false },
  { name: 'Final',                stage: 'knockout', week_number: 8, is_active: false },
];

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS players (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS game_weeks (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        stage       TEXT NOT NULL,
        week_number INTEGER NOT NULL,
        is_active   BOOLEAN DEFAULT FALSE,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bets (
        id              SERIAL PRIMARY KEY,
        player_id       INTEGER REFERENCES players(id),
        game_week_id    INTEGER REFERENCES game_weeks(id),
        image_url       TEXT,
        image_public_id TEXT,
        selection       TEXT,
        event_name      TEXT,
        odds            REAL,
        stake           REAL    DEFAULT 5.0,
        result          TEXT    DEFAULT 'pending',
        profit          REAL    DEFAULT 0,
        raw_analysis    TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(player_id, game_week_id)
      );
    `);

    const { rows } = await client.query('SELECT COUNT(*) FROM game_weeks');
    if (parseInt(rows[0].count) === 0) {
      for (const w of DEFAULT_WEEKS) {
        await client.query(
          'INSERT INTO game_weeks (name, stage, week_number, is_active) VALUES ($1,$2,$3,$4)',
          [w.name, w.stage, w.week_number, w.is_active]
        );
      }
      console.log('  ✓ Game weeks seeded');
    }
  } finally {
    client.release();
  }
}

// ── Players ───────────────────────────────────────────────────────────────────

async function getPlayers() {
  const { rows } = await pool.query('SELECT * FROM players ORDER BY name ASC');
  return rows;
}

async function getPlayerByName(name) {
  const { rows } = await pool.query(
    'SELECT * FROM players WHERE LOWER(name) = LOWER($1)', [name]
  );
  return rows[0] || null;
}

async function addPlayer(name) {
  const { rows } = await pool.query(
    'INSERT INTO players (name) VALUES ($1) RETURNING *', [name]
  );
  return rows[0];
}

// ── Game Weeks ────────────────────────────────────────────────────────────────

async function getGameWeeks() {
  const { rows } = await pool.query('SELECT * FROM game_weeks ORDER BY week_number ASC');
  return rows.map(camelWeek);
}

async function getActiveGameWeek() {
  const { rows } = await pool.query('SELECT * FROM game_weeks WHERE is_active = TRUE LIMIT 1');
  return rows[0] ? camelWeek(rows[0]) : null;
}

async function getGameWeek(id) {
  const { rows } = await pool.query('SELECT * FROM game_weeks WHERE id = $1', [id]);
  return rows[0] ? camelWeek(rows[0]) : null;
}

async function setActiveGameWeek(id) {
  await pool.query('UPDATE game_weeks SET is_active = (id = $1)', [id]);
}

// ── Bets ──────────────────────────────────────────────────────────────────────

async function addBet(bet) {
  const { rows } = await pool.query(
    `INSERT INTO bets
       (player_id, game_week_id, image_url, image_public_id, selection, event_name, odds, stake, result, profit, raw_analysis)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [bet.playerId, bet.gameWeekId, bet.imageUrl, bet.imagePublicId,
     bet.selection, bet.eventName, bet.odds, bet.stake, bet.result, bet.profit, bet.rawAnalysis]
  );
  return rows[0];
}

async function updateBet(id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    vals.push(v);
  }
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE bets SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals
  );
  return rows[0] || null;
}

async function getBet(id) {
  const { rows } = await pool.query('SELECT * FROM bets WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getBetByPlayerAndWeek(playerId, gameWeekId) {
  const { rows } = await pool.query(
    'SELECT * FROM bets WHERE player_id = $1 AND game_week_id = $2', [playerId, gameWeekId]
  );
  return rows[0] || null;
}

async function getBetsForWeek(gameWeekId) {
  const { rows } = await pool.query(
    `SELECT b.*, p.name as player_name
     FROM bets b
     JOIN players p ON b.player_id = p.id
     WHERE b.game_week_id = $1
     ORDER BY b.created_at ASC`,
    [gameWeekId]
  );
  return rows.map(camelBet);
}

async function deleteBet(id) {
  const { rowCount } = await pool.query('DELETE FROM bets WHERE id = $1', [id]);
  return rowCount > 0;
}

async function getAllBets() {
  const { rows } = await pool.query(
    `SELECT b.*,
            p.name        AS player_name,
            gw.name       AS game_week_name,
            gw.week_number AS week_number
     FROM bets b
     JOIN players   p  ON b.player_id    = p.id
     JOIN game_weeks gw ON b.game_week_id = gw.id
     ORDER BY gw.week_number ASC, b.created_at ASC`
  );
  return rows.map(r => ({
    ...camelBet(r),
    playerName:   r.player_name,
    gameWeekName: r.game_week_name,
    weekNumber:   r.week_number,
  }));
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

async function getLeaderboard(gameWeekId = null) {
  if (gameWeekId) {
    const { rows } = await pool.query(
      `SELECT
         p.id                                                              AS "playerId",
         p.name                                                            AS "playerName",
         COALESCE(ROUND(b.profit::numeric, 2), 0)::float                  AS profit,
         CASE WHEN b.result = 'won' THEN 1 ELSE 0 END                     AS winners,
         CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END                     AS "totalBets",
         CASE WHEN b.result IN ('won','lost') THEN 1 ELSE 0 END           AS "settledBets",
         b.odds::float                                                     AS "avgOdds",
         CASE WHEN b.id IS NOT NULL THEN json_build_object(
           'id',        b.id,
           'result',    b.result,
           'odds',      b.odds,
           'selection', b.selection,
           'eventName', b.event_name,
           'imageUrl',  b.image_url,
           'profit',    b.profit
         ) ELSE NULL END                                                   AS bet
       FROM players p
       LEFT JOIN bets b ON p.id = b.player_id AND b.game_week_id = $1
       ORDER BY profit DESC, p.name ASC`,
      [gameWeekId]
    );
    return rows;
  }

  const { rows } = await pool.query(
    `SELECT
       p.id                                                                AS "playerId",
       p.name                                                              AS "playerName",
       COALESCE(ROUND(SUM(b.profit)::numeric, 2), 0)::float               AS profit,
       COUNT(CASE WHEN b.result = 'won' THEN 1 END)::int                  AS winners,
       COUNT(b.id)::int                                                    AS "totalBets",
       COUNT(CASE WHEN b.result IN ('won','lost') THEN 1 END)::int        AS "settledBets",
       ROUND(AVG(b.odds)::numeric, 2)::float                              AS "avgOdds"
     FROM players p
     LEFT JOIN bets b ON p.id = b.player_id
     GROUP BY p.id, p.name
     ORDER BY profit DESC, p.name ASC`
  );
  return rows;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function camelWeek(w) {
  return {
    id:         w.id,
    name:       w.name,
    stage:      w.stage,
    weekNumber: w.week_number,
    isActive:   w.is_active,
    createdAt:  w.created_at,
  };
}

function camelBet(b) {
  return {
    id:            b.id,
    playerId:      b.player_id,
    playerName:    b.player_name ?? null,
    gameWeekId:    b.game_week_id,
    imageUrl:      b.image_url,
    imagePublicId: b.image_public_id,
    selection:     b.selection,
    eventName:     b.event_name,
    odds:          b.odds,
    stake:         b.stake,
    result:        b.result,
    profit:        b.profit,
    rawAnalysis:   b.raw_analysis,
    createdAt:     b.created_at,
  };
}

module.exports = {
  pool,
  initDB,
  getPlayers, getPlayerByName, addPlayer,
  getGameWeeks, getActiveGameWeek, getGameWeek, setActiveGameWeek,
  addBet, updateBet, getBet, getBetByPlayerAndWeek, getBetsForWeek, deleteBet,
  getAllBets, getLeaderboard,
};
