require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const { v2: cloudinary } = require('cloudinary');
const Anthropic  = require('@anthropic-ai/sdk');
const db         = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'goals2026';

// ── Cloudinary ─────────────────────────────────────────────────────────────

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadToCloudinary(buffer, mimetype) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: 'worldcup-bets', resource_type: 'image' },
      (err, result) => { if (err) reject(err); else resolve(result); }
    ).end(buffer);
  });
}

// ── Multer (memory — no disk writes) ──────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    cb(null, /image\/(jpeg|jpg|png|webp|gif)/.test(file.mimetype));
  },
});

// ── Anthropic ──────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function analyseBetslip(buffer, mimetype) {
  const base64 = buffer.toString('base64');
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimetype || 'image/jpeg', data: base64 },
        },
        {
          type: 'text',
          text: `Analyse this Bet365 betting slip image. Return ONLY a valid JSON object — no markdown, no code fences, just raw JSON.

Fields to extract:
- "selection": string — what was bet on (e.g. "Arsenal to Win", "Both Teams to Score", "Over 2.5 Goals")
- "event_name": string — the match/event name if visible (e.g. "Arsenal vs Chelsea")
- "odds": number — decimal odds. If fractional (e.g. "8/1"), convert: (8/1)+1 = 9.0
- "stake": number — amount staked (should be around 5.00)
- "result": string — "won", "lost", "void", or "pending" (pending if not yet settled)
- "returns": number or null — actual or potential returns shown on the slip
- "bet_type": string — "single", "accumulator", "each way", etc.

Example: {"selection":"Aston Villa to Win","event_name":"Man City vs Aston Villa","odds":9.0,"stake":5.0,"result":"pending","returns":45.0,"bet_type":"single"}`,
        },
      ],
    }],
  });

  const text  = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : text);
}

function calcProfit(result, odds, stake = 5) {
  if (result === 'won' && odds) return parseFloat(((stake * odds) - stake).toFixed(2));
  if (result === 'lost')        return -stake;
  return 0;
}

// ── App ────────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static('public'));

// ── Players ────────────────────────────────────────────────────────────────

app.get('/api/players', async (_, res) => {
  res.json(await db.getPlayers());
});

app.post('/api/players', async (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  let player = await db.getPlayerByName(name);
  if (!player) player = await db.addPlayer(name);
  res.json(player);
});

// ── Game Weeks ─────────────────────────────────────────────────────────────

app.get('/api/gameweeks', async (_, res) => {
  res.json(await db.getGameWeeks());
});

app.get('/api/gameweeks/active', async (_, res) => {
  res.json(await db.getActiveGameWeek());
});

app.put('/api/gameweeks/:id/activate', async (req, res) => {
  if (req.body?.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Wrong password' });
  await db.setActiveGameWeek(parseInt(req.params.id));
  res.json({ success: true, activeWeek: await db.getGameWeek(parseInt(req.params.id)) });
});

// ── Leaderboard ────────────────────────────────────────────────────────────

app.get('/api/leaderboard', async (req, res) => {
  res.json(await db.getLeaderboard(req.query.weekId ? parseInt(req.query.weekId) : null));
});

// ── Upload & Analyse ───────────────────────────────────────────────────────

app.post('/api/upload', upload.single('betslip'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  const playerName = req.body?.playerName?.trim();
  const gameWeekId = parseInt(req.body?.gameWeekId);
  if (!playerName || !gameWeekId) return res.status(400).json({ error: 'Player name and game week required' });

  const week = await db.getGameWeek(gameWeekId);
  if (!week) return res.status(400).json({ error: 'Invalid game week' });

  let player = await db.getPlayerByName(playerName);
  if (!player) player = await db.addPlayer(playerName);

  if (await db.getBetByPlayerAndWeek(player.id, gameWeekId)) {
    return res.status(409).json({ error: `${playerName} has already submitted for ${week.name}` });
  }

  // Upload image to Cloudinary
  let imageUrl = null;
  let imagePublicId = null;
  const cloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY;

  if (cloudinaryConfigured) {
    try {
      const result  = await uploadToCloudinary(req.file.buffer, req.file.mimetype);
      imageUrl      = result.secure_url;
      imagePublicId = result.public_id;
    } catch (err) {
      console.error('Cloudinary upload failed:', err.message);
    }
  }

  // Save bet (pending) immediately
  const bet = await db.addBet({
    playerId: player.id, gameWeekId,
    imageUrl, imagePublicId,
    selection: null, eventName: null,
    odds: null, stake: 5.0,
    result: 'pending', profit: 0,
    rawAnalysis: null,
  });

  // Analyse with Claude using the in-memory buffer
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({
      success: true, betId: bet.id, playerName: player.name,
      analysis: null, warning: 'Set ANTHROPIC_API_KEY to enable auto-analysis.',
    });
  }

  try {
    const analysis = await analyseBetslip(req.file.buffer, req.file.mimetype);
    const profit   = calcProfit(analysis.result, analysis.odds, analysis.stake || 5);

    await db.updateBet(bet.id, {
      selection:    analysis.selection  || null,
      event_name:   analysis.event_name || null,
      odds:         analysis.odds       ? parseFloat(analysis.odds) : null,
      stake:        parseFloat(analysis.stake) || 5.0,
      result:       analysis.result     || 'pending',
      profit,
      raw_analysis: JSON.stringify(analysis),
    });

    res.json({
      success: true, betId: bet.id, playerName: player.name,
      analysis: { ...analysis, profit },
    });
  } catch (err) {
    console.error('Analysis error:', err.message);
    res.json({
      success: true, betId: bet.id, playerName: player.name,
      analysis: null, warning: 'Bet saved! Auto-analysis failed — admin can update result manually.',
    });
  }
});

// ── Bets ───────────────────────────────────────────────────────────────────

app.get('/api/gameweeks/:id/bets', async (req, res) => {
  res.json(await db.getBetsForWeek(parseInt(req.params.id)));
});

app.put('/api/bets/:id', async (req, res) => {
  if (req.body?.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Wrong password' });
  const bet = await db.getBet(parseInt(req.params.id));
  if (!bet) return res.status(404).json({ error: 'Bet not found' });

  const { result, odds, selection, event_name } = req.body;
  const effectiveOdds = odds != null ? parseFloat(odds) : bet.odds;
  const profit = calcProfit(result ?? bet.result, effectiveOdds, bet.stake);

  const updated = await db.updateBet(parseInt(req.params.id), {
    result:     result     ?? bet.result,
    odds:       effectiveOdds,
    selection:  selection  ?? bet.selection,
    event_name: event_name ?? bet.event_name,
    profit,
  });
  res.json(updated);
});

app.delete('/api/bets/:id', async (req, res) => {
  if (req.body?.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Wrong password' });
  const bet = await db.getBet(parseInt(req.params.id));
  if (!bet) return res.status(404).json({ error: 'Bet not found' });

  // Remove from Cloudinary if stored there
  if (bet.image_public_id && process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.uploader.destroy(bet.image_public_id).catch(() => {});
  }

  const deleted = await db.deleteBet(parseInt(req.params.id));
  res.json({ success: deleted });
});

// ── Start ──────────────────────────────────────────────────────────────────

async function start() {
  try {
    await db.initDB();
    console.log('  ✓ Database ready');
  } catch (err) {
    console.error('  ✗ Database init failed:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n⚽  World Cup Bets 2026 → http://localhost:${PORT}\n`);
    if (!process.env.ANTHROPIC_API_KEY)
      console.warn('  ⚠  ANTHROPIC_API_KEY not set — betslip analysis disabled');
    if (!process.env.CLOUDINARY_CLOUD_NAME)
      console.warn('  ⚠  Cloudinary not configured — images will not be stored');
  });
}

start();
