// Pure scoring for the bettor leaderboard. No network access; unit tested.
// A "bet" is one game: the wallet's largest pre-game position in that game, bought on one side only.
export const POLICY = 'edge-over-price-v1';
export const RULES = { minGames: 50, minSpanDays: 30, maxIdleDays: 21, minEdge: 0.02, z: 1.645, feeRate: 0.05, topN: 30 };
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
export const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const allIn = (p, fee) => p + fee * p * (1 - p);

/** bets: [{price, payout (0|1), stake, gameAt (ms), sport}] already reduced to one per game. */
export function score(bets, { feeRate = RULES.feeRate, z = RULES.z } = {}) {
  const n = bets.length;
  if (!n) return { games: 0 };
  const d = bets.map((b) => b.payout - allIn(b.price, feeRate));       // per-bet result minus all-in price
  const m = mean(d), sd = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : 0;
  const wins = bets.filter((b) => b.payout === 1).length;
  const times = bets.map((b) => b.gameAt);
  return {
    games: n, wins, losses: n - wins, winRate: wins / n,
    avgPrice: mean(bets.map((b) => b.price)),
    edge: m,                                                            // win rate above the all-in price paid
    edgeLower: n > 1 ? m - z * sd / Math.sqrt(n) : -Infinity,           // conservative (one-sided 95%)
    roi: mean(bets.map((b) => b.payout / allIn(b.price, feeRate) - 1)), // flat stake, held to the end
    heldPnl: bets.reduce((s, b) => s + b.stake * (b.payout / allIn(b.price, feeRate) - 1), 0),
    firstGameAt: Math.min(...times), lastGameAt: Math.max(...times), spanDays: (Math.max(...times) - Math.min(...times)) / 864e5,
  };
}

/** Full record for one wallet. `positions` are all pre-game positions (for typical stake), `bets` the resolved one-per-game set. */
export function walletRecord({ bets, stakes, lastBuyAt }, now, rules = RULES) {
  const overall = score(bets, rules);
  const sorted = [...bets].sort((a, b) => a.gameAt - b.gameAt), half = sorted.length >> 1;
  const older = score(sorted.slice(0, half), rules), newer = score(sorted.slice(half), rules);
  const bySport = {};
  for (const sport of new Set(bets.map((b) => b.sport))) { const s = score(bets.filter((b) => b.sport === sport), rules); if (s.games >= 20) bySport[sport] = s; }
  const reasons = [];
  if (!(overall.games >= rules.minGames)) reasons.push(`fewer than ${rules.minGames} settled pre-game bets`);
  else {
    if (overall.spanDays < rules.minSpanDays) reasons.push(`record spans under ${rules.minSpanDays} days`);
    if (!(overall.edge >= rules.minEdge && overall.roi > 0)) reasons.push(`win rate is not at least ${Math.round(100 * rules.minEdge)} points above the price paid`);
    else if (!(older.edge > 0 && newer.edge > 0)) reasons.push('not ahead in both halves of the record');
  }
  if (!lastBuyAt || now - lastBuyAt > rules.maxIdleDays * 864e5) reasons.push(`no pre-game bet in ${rules.maxIdleDays} days`);
  return { ...overall, olderEdge: older.edge ?? null, newerEdge: newer.edge ?? null, bySport,
    medianStake: median(stakes), typicalBets: stakes.length, lastBuyAt: lastBuyAt || null, qualified: reasons.length === 0,
    // "proven": the edge stays above zero even after allowing for luck (one-sided 95%). Otherwise "leading".
    proven: reasons.length === 0 && overall.edgeLower > 0, reasons };
}

export function rank(records, rules = RULES) {
  const q = records.filter((r) => r.qualified).sort((a, b) => b.edgeLower - a.edgeLower);
  q.forEach((r, i) => { r.rank = i + 1; });
  return q.slice(0, rules.topN);
}
