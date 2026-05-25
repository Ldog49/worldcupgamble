const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'data.json');

const DEFAULT_GAME_WEEKS = [
  { id: 1, name: 'Group Stage — Week 1', stage: 'group', weekNumber: 1, isActive: true },
  { id: 2, name: 'Group Stage — Week 2', stage: 'group', weekNumber: 2, isActive: false },
  { id: 3, name: 'Group Stage — Week 3', stage: 'group', weekNumber: 3, isActive: false },
  { id: 4, name: 'Round of 32',          stage: 'knockout', weekNumber: 4, isActive: false },
  { id: 5, name: 'Round of 16',          stage: 'knockout', weekNumber: 5, isActive: false },
  { id: 6, name: 'Quarter Finals',       stage: 'knockout', weekNumber: 6, isActive: false },
  { id: 7, name: 'Semi Finals',          stage: 'knockout', weekNumber: 7, isActive: false },
  { id: 8, name: 'Final',                stage: 'knockout', weekNumber: 8, isActive: false },
];

class Store {
  constructor() {
    this._load();
  }

  _load() {
    try {
      this._data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    } catch {
      this._data = {
        players: [],
        gameWeeks: DEFAULT_GAME_WEEKS,
        bets: [],
        _nextIds: { player: 1, bet: 1 },
      };
      this._save();
    }
  }

  _save() {
    fs.writeFileSync(STORE_PATH, JSON.stringify(this._data, null, 2));
  }

  // ── Players ──────────────────────────────────────────────────────────────

  getPlayers() {
    return [...this._data.players].sort((a, b) => a.name.localeCompare(b.name));
  }

  getPlayer(id) {
    return this._data.players.find(p => p.id === id) || null;
  }

  getPlayerByName(name) {
    return this._data.players.find(p => p.name.toLowerCase() === name.toLowerCase()) || null;
  }

  addPlayer(name) {
    const player = { id: this._data._nextIds.player++, name, createdAt: new Date().toISOString() };
    this._data.players.push(player);
    this._save();
    return player;
  }

  // ── Game Weeks ────────────────────────────────────────────────────────────

  getGameWeeks() {
    return [...this._data.gameWeeks].sort((a, b) => a.weekNumber - b.weekNumber);
  }

  getActiveGameWeek() {
    return this._data.gameWeeks.find(w => w.isActive) || null;
  }

  getGameWeek(id) {
    return this._data.gameWeeks.find(w => w.id === id) || null;
  }

  setActiveGameWeek(id) {
    this._data.gameWeeks.forEach(w => { w.isActive = w.id === id; });
    this._save();
  }

  // ── Bets ──────────────────────────────────────────────────────────────────

  getBets() {
    return [...this._data.bets];
  }

  getBet(id) {
    return this._data.bets.find(b => b.id === id) || null;
  }

  getBetByPlayerAndWeek(playerId, gameWeekId) {
    return this._data.bets.find(b => b.playerId === playerId && b.gameWeekId === gameWeekId) || null;
  }

  getBetsForWeek(gameWeekId) {
    return this._data.bets.filter(b => b.gameWeekId === gameWeekId);
  }

  addBet(bet) {
    const newBet = { ...bet, id: this._data._nextIds.bet++, createdAt: new Date().toISOString() };
    this._data.bets.push(newBet);
    this._save();
    return newBet;
  }

  updateBet(id, updates) {
    const idx = this._data.bets.findIndex(b => b.id === id);
    if (idx === -1) return null;
    this._data.bets[idx] = { ...this._data.bets[idx], ...updates };
    this._save();
    return this._data.bets[idx];
  }

  deleteBet(id) {
    const idx = this._data.bets.findIndex(b => b.id === id);
    if (idx === -1) return false;
    this._data.bets.splice(idx, 1);
    this._save();
    return true;
  }

  // ── Leaderboard ───────────────────────────────────────────────────────────

  getLeaderboard(gameWeekId = null) {
    const players = this.getPlayers();
    const bets = gameWeekId
      ? this.getBetsForWeek(parseInt(gameWeekId))
      : this.getBets();

    return players
      .map(player => {
        const playerBets = bets.filter(b => b.playerId === player.id);
        const wins = playerBets.filter(b => b.result === 'won').length;
        const settled = playerBets.filter(b => b.result === 'won' || b.result === 'lost').length;
        const totalProfit = parseFloat(playerBets.reduce((s, b) => s + (b.profit || 0), 0).toFixed(2));
        const betsWithOdds = playerBets.filter(b => b.odds != null);
        const avgOdds = betsWithOdds.length
          ? parseFloat((betsWithOdds.reduce((s, b) => s + b.odds, 0) / betsWithOdds.length).toFixed(2))
          : null;

        return {
          playerId: player.id,
          playerName: player.name,
          profit: totalProfit,
          winners: wins,
          totalBets: playerBets.length,
          settledBets: settled,
          avgOdds,
          bet: gameWeekId ? (playerBets[0] || null) : null,
        };
      })
      .sort((a, b) => b.profit - a.profit || a.playerName.localeCompare(b.playerName));
  }
}

module.exports = new Store();
