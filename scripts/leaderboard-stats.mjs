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
    se: n > 1 ? sd / Math.sqrt(n) : null,                               // how far luck alone could move the edge
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

// ---------------------------------------------------------------------------------------------------------------------
// Sport specialists. A bettor is judged sport by sport, and every edge is marked down for luck before it is used.
//
// Why: hundreds of wallets are screened, so the best-looking records are partly the luckiest ones. Two corrections:
//  1. "adj" pulls each record towards the average of all records, more strongly the fewer bets it rests on
//     (empirical Bayes; the spread of real skill is estimated from all records together).
//  2. "proven" is decided across all records at once (false-discovery control), so it means "too good to be luck even
//     after allowing for how many bettors were looked at", not just "good on its own".
// `screened`: the roster includes bettors hand-picked from a 24 Nov 2026 search of 7,042 wallets (3,233 sport records with 30+ early
// bets). "Proven" has to allow for all of those, or the picked bettors would look proven simply for having been picked.
export const SPORT_RULES = { minGames: 30, minSpanDays: 30, maxIdleDays: 21, sportIdleDays: 45, perSport: 12, maxWallets: 60,
  minAdj: 0.005, fdr: 0.2, screened: 3233, popMinGames: 20, coldMinGames: 20, maxCredit: 0.08, z: 1.645, feeRate: 0.05 };

// Upper tail of the standard normal (Abramowitz & Stegun 7.1.26; accurate to about 1e-7).
export function upperTail(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return z >= 0 ? erfc / 2 : 1 - erfc / 2;
}
/** Average edge and spread of real skill across records [{edge, se}] (DerSimonian-Laird). */
export function skillPrior(rows) {
  const ok = rows.filter((r) => Number.isFinite(r.edge) && r.se > 0);
  if (ok.length < 10) return { mu: 0, tau2: 0, records: ok.length };
  const w = ok.map((r) => 1 / r.se ** 2), sw = w.reduce((a, b) => a + b, 0);
  const mu = ok.reduce((a, r, i) => a + w[i] * r.edge, 0) / sw;
  const q = ok.reduce((a, r, i) => a + w[i] * (r.edge - mu) ** 2, 0), c = sw - w.reduce((a, x) => a + x * x, 0) / sw;
  return { mu, tau2: Math.max(0, (q - (ok.length - 1)) / c), records: ok.length };
}
/** A record's edge after allowing for luck, and how uncertain that still is. */
export function shrink(edge, se, prior) {
  if (!(se > 0) || !Number.isFinite(edge)) return { adj: prior.mu, sd: Math.sqrt(prior.tau2) };
  const k = prior.tau2 / (prior.tau2 + se * se);
  return { adj: k * edge + (1 - k) * prior.mu, sd: Math.sqrt(k) * se };
}
/** Benjamini-Hochberg: which of these p-values still count once all of them are considered together. */
export function discoveries(ps, q, screened = 0) {
  const m = Math.max(ps.length, screened);       // the bar is set by how many records were really looked through, not only today's
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); let cut = -1;
  order.forEach(([p], k) => { if (p <= q * (k + 1) / m) cut = k; });
  const out = ps.map(() => false); for (let k = 0; k <= cut; k++) out[order[k][1]] = true;
  return out;
}

/** Every sport a wallet has bet, scored separately. bets: [{price, payout, stake, gameAt, boughtAt, sport}]. */
export function sportRecords(bets, rules = SPORT_RULES) {
  const out = {};
  for (const sport of new Set(bets.map((b) => b.sport))) {
    const mine = bets.filter((b) => b.sport === sport).sort((a, b) => a.gameAt - b.gameAt), half = mine.length >> 1;
    const s = score(mine, rules);
    out[sport] = { ...s, olderEdge: score(mine.slice(0, half), rules).edge ?? null, newerEdge: score(mine.slice(half), rules).edge ?? null };
  }
  return out;
}
/** Record on bets placed after the bettor was first listed in a sport. This is the only part of a record that was not used to pick them. */
export function sinceListed(bets, sport, listedAt, rules = SPORT_RULES) {
  const s = score(bets.filter((b) => b.sport === sport && b.boughtAt >= listedAt), rules);
  if (!s.games) return { listedAt, games: 0, wins: 0, edge: null, roi: null, cold: false };
  return { listedAt, games: s.games, wins: s.wins, edge: s.edge, roi: s.roi,
    cold: s.games >= rules.coldMinGames && s.se > 0 && s.edge < -s.se };       // clearly behind since listing
}
/**
 * wallets: [{name, wallet, bets, overall (walletRecord), medianStake, lastBuyAt}]
 * listed:  {"wallet|sport": first time listed (ms)}; new pairs are added with `now`.
 * Returns the bettors to scan, each with the sports they are trusted in, plus the luck model that was used.
 */
export function specialists(wallets, now, listed = {}, rules = SPORT_RULES) {
  const pairs = [];
  for (const w of wallets) {
    const bySport = sportRecords(w.bets, rules);
    for (const [sport, r] of Object.entries(bySport)) if (sport !== 'Non-sports' && r.games >= rules.popMinGames && r.se > 0) pairs.push({ w, sport, r });
  }
  const prior = skillPrior(pairs.map((p) => p.r));
  const testable = pairs.filter((p) => p.r.games >= rules.minGames), found = discoveries(testable.map((p) => upperTail(p.r.edge / p.r.se)), rules.fdr, rules.screened);
  testable.forEach((p, i) => { p.proven = found[i]; });
  for (const p of pairs) {
    const { adj, sd } = shrink(p.r.edge, p.r.se, prior); p.adj = adj; p.adjSd = sd;
    const active = p.w.lastBuyAt && now - p.w.lastBuyAt <= rules.maxIdleDays * 864e5 && now - p.r.lastGameAt <= rules.sportIdleDays * 864e5;
    p.listable = p.r.games >= rules.minGames && p.r.spanDays >= rules.minSpanDays && active && p.r.edge > 0 && p.r.roi > 0 && p.r.newerEdge > 0 && adj >= rules.minAdj;
    // Edge credited on a card: the luck-adjusted figure, or for a proven record the conventional conservative bound if that is higher.
    p.credit = Math.min(rules.maxCredit, p.proven ? Math.max(adj, p.r.edge - rules.z * p.r.se) : adj);
  }
  const chosen = [], bySportList = {};
  for (const p of pairs.filter((p) => p.listable).sort((a, b) => (b.proven === true) - (a.proven === true) || b.credit - a.credit)) (bySportList[p.sport] ||= []).push(p);
  for (const [sport, list] of Object.entries(bySportList)) list.slice(0, rules.perSport).forEach((p, i) => { p.rank = i + 1; chosen.push(p); });
  // Keep the scan affordable: if too many wallets qualify, keep the ones with the best single-sport standing.
  const best = new Map();
  for (const p of chosen) { const k = p.w.wallet, v = (p.proven ? 1 : 0) + p.credit; if (!(best.get(k) >= v)) best.set(k, v); }
  const keep = new Set([...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, rules.maxWallets).map(([k]) => k));
  const out = new Map(), listedOut = { ...listed };
  for (const p of chosen) {
    if (!keep.has(p.w.wallet)) continue;
    const key = p.w.wallet + '|' + p.sport; listedOut[key] ??= now;
    const since = sinceListed(p.w.bets, p.sport, listedOut[key], rules);
    const row = out.get(p.w.wallet) || { name: p.w.name, wallet: p.w.wallet, medianStake: p.w.medianStake, games: p.w.overall.games, wins: p.w.overall.wins, losses: p.w.overall.losses,
      winRate: p.w.overall.winRate, avgPrice: p.w.overall.avgPrice, edge: p.w.overall.edge, sports: {} };
    row.sports[p.sport] = { rank: p.rank, games: p.r.games, wins: p.r.wins, winRate: p.r.winRate, avgPrice: p.r.avgPrice, edge: p.r.edge, roi: p.r.roi,
      adj: p.adj, credit: p.credit, proven: p.proven === true, cold: since.cold, since };
    out.set(p.w.wallet, row);
  }
  const rows = [...out.values()].filter((r) => r.medianStake > 0);
  return { specialists: rows, listed: listedOut, prior: { mu: prior.mu, tau: Math.sqrt(prior.tau2), records: prior.records, tested: testable.length, proven: testable.filter((p) => p.proven).length } };
}
