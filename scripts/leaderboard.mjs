// Builds data/leaderboard.json: every tracked or discovered wallet scored on its last 180 days of
// pre-game sports bets. Public Polymarket endpoints only; no keys. Run in GitHub Actions.
import fs from 'node:fs';
import { CORE, classify } from '../cloudflare/roster.mjs';
import { walletRecord, rank, specialists, score, median, RULES, SPORT_RULES, POLICY } from './leaderboard-stats.mjs';

const DATA = 'https://data-api.polymarket.com', GAMMA = 'https://gamma-api.polymarket.com';
const WINDOW_DAYS = 180, MAX_PAGES = +process.env.MAX_PAGES || 40, MAX_WALLETS = +process.env.MAX_WALLETS || 400;
const now = Date.now(), start = Math.floor(now / 1000) - WINDOW_DAYS * 86400, end = Math.floor(now / 1000);
const warnings = [], counts = { requests: 0, retries: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 5) {
  for (let i = 0; ; i++) {
    counts.requests++;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json', 'User-Agent': 'LuckSociety-Polysharp/1.0 (leaderboard)' } });
      if (r.ok) return await r.json();
      if (i >= tries - 1 || (r.status !== 429 && r.status < 500)) throw Error('HTTP ' + r.status);
    } catch (e) { if (i >= tries - 1 || /HTTP 4(?!29)/.test(e.message)) throw e; }
    counts.retries++; await sleep(1500 * 2 ** i);
  }
}
async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }

// Newest first, so a very active wallet keeps its most recent trades when the page budget runs out.
async function trades(wallet) {
  const rows = [], seen = new Set(); let cursor = null, truncated = false;
  for (let i = 0; ; i++) {
    if (i >= MAX_PAGES) { truncated = true; break; }
    const u = new URL(`${DATA}/v2/activity?user=${wallet}&type=TRADE&start=${start}&end=${end}&sort_direction=DESC&limit=1000`);
    if (cursor) u.searchParams.set('cursor', cursor);
    const page = await get(u.href);
    if (!Array.isArray(page?.data) || !page.pagination || !Object.hasOwn(page.pagination, 'next_cursor')) throw Error('Invalid v2 page envelope');
    rows.push(...page.data); cursor = page.pagination.next_cursor;
    if (cursor === null) break;
    if (typeof cursor !== 'string' || !cursor || seen.has(cursor)) throw Error('Invalid/repeated pagination cursor');
    seen.add(cursor);
  }
  return { rows, truncated };
}

async function discover() {
  const known = new Map(CORE.map((t) => [t.wallet.toLowerCase(), { name: t.name, wallet: t.wallet.toLowerCase(), source: 'roster' }]));
  for (const [category, period, limit] of [['sports', 'month', 100], ['esports', 'month', 40], ['sports', 'all', 100], ['esports', 'all', 40], ['sports', 'week', 50]]) {
    try {
      const lb = await get(`${DATA}/v2/leaderboard?category=${category}&time_period=${period}&sort_by=PNL&limit=${limit}`, 2);
      if (!Array.isArray(lb.data)) throw Error('invalid leaderboard');
      let added = 0;
      for (const row of lb.data) { const w = String(row.user_id || '').toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(w) || known.has(w)) continue; known.set(w, { name: /^0x[0-9a-f]{20,}/i.test(row.user_name || '0x' + '0'.repeat(20)) ? w.slice(0, 6) + '…' + w.slice(-4) : String(row.user_name).slice(0, 40), wallet: w, source: `${category} ${period} leaderboard` }); added++; }
      console.log(`discovery ${category}/${period}: ${lb.data.length} rows, ${added} new`);
    } catch (e) { warnings.push(`Leaderboard ${category}/${period} unavailable: ${e.message}`); }
  }
  // PROBE: walk much deeper into Polymarket's leaderboards (every period, by profit and by volume) to widen the pool.
  if (process.env.DISCOVER_WIDE) {
    const per = +process.env.DISCOVER_DEPTH || 1000;
    for (const category of ['sports', 'esports']) for (const period of ['all', 'month', 'week', 'day']) for (const sort of ['PNL', 'VOLUME']) {
      let got = 0, added = 0, cursor = null, offset = 0, mode = null;
      for (let page = 0; page < 40 && got < per; page++) {
        const u = new URL(`${DATA}/v2/leaderboard?category=${category}&time_period=${period}&sort_by=${sort}&limit=100`);
        if (mode === 'cursor') u.searchParams.set('cursor', cursor); else if (page) u.searchParams.set('offset', String(offset));
        let lb; try { lb = await get(u.href, 2); } catch (e) { console.log(`wide ${category}/${period}/${sort} page ${page}: ${e.message}`); break; }
        if (page === 0) console.log(`wide ${category}/${period}/${sort}: keys ${Object.keys(lb || {}).join(',')} pagination ${JSON.stringify(lb?.pagination || null)} first ${JSON.stringify(lb?.data?.[0] || null).slice(0, 300)}`);
        if (!Array.isArray(lb?.data) || !lb.data.length) break;
        let fresh = 0;
        for (const row of lb.data) { const w = String(row.user_id || '').toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(w)) continue; got++; if (known.has(w)) continue; fresh++; added++;
          known.set(w, { name: /^0x[0-9a-f]{20,}/i.test(row.user_name || '0x' + '0'.repeat(20)) ? w.slice(0, 6) + '…' + w.slice(-4) : String(row.user_name).slice(0, 40), wallet: w, source: `wide ${category} ${period} ${sort}` }); }
        if (lb.pagination?.next_cursor) { mode = 'cursor'; cursor = lb.pagination.next_cursor; } else if (lb.pagination && Object.hasOwn(lb.pagination, 'next_cursor')) break; else { offset += lb.data.length; if (page > 0 && !fresh && mode === null) { /* offset may be ignored */ if (page > 1) break; } }
      }
      console.log(`wide ${category}/${period}/${sort}: ${got} rows, ${added} new, total ${known.size}`);
    }
  }
  return [...known.values()].slice(0, MAX_WALLETS);
}

const wallets = await discover();
console.log(`scoring ${wallets.length} wallets (${CORE.length} from the existing roster)`);

// 1) trades -> pre-game positions per wallet
let done = 0;
const perWallet = await pool(wallets, 8, async (t) => {
  try {
    const { rows, truncated } = await trades(t.wallet);
    const pos = new Map(), sides = new Map();
    for (const a of rows) {
      if (a.side !== 'BUY' || a.is_combo || a.outcome_index === 999 || !a.condition_id || !(a.price > 0 && a.price < 1) || !(a.size > 0)) continue;
      const set = sides.get(a.condition_id) || new Set(); set.add(a.token_id); sides.set(a.condition_id, set);
      const k = a.condition_id + '|' + a.token_id, p = pos.get(k) || { condition: a.condition_id, token: a.token_id, slug: a.event_slug, outcomeIndex: a.outcome_index, buys: [] };
      p.buys.push({ t: a.timestamp * 1000, price: +a.price, size: +a.size }); pos.set(k, p);
    }
    return { ...t, truncated, tradeRows: rows.length, positions: [...pos.values()].filter((p) => sides.get(p.condition).size === 1) };
  } catch (e) { warnings.push(`${t.name}: trade history unavailable (${e.message})`); return { ...t, failed: true, positions: [] }; }
  finally { if (++done % 20 === 0) console.log(`trades ${done}/${wallets.length} · ${counts.requests} requests`); }
});

// 2) game start times and sport
const slugs = [...new Set(perWallet.flatMap((w) => w.positions.map((p) => p.slug)).filter(Boolean))], events = new Map();
console.log(`${slugs.length} events to look up`);
const chunk = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
let metaErrors = 0;
await pool(chunk(slugs, 25), 8, async (c) => {
  try { for (const e of await get(`${GAMMA}/events?${c.map((s) => 'slug=' + encodeURIComponent(s)).join('&')}&limit=100`)) events.set(e.slug, { sport: classify((e.tags || []).map((t) => t.slug), e.slug), markets: new Map((e.markets || []).filter((m) => m.gameStartTime).map((m) => [m.conditionId, Date.parse(m.gameStartTime)])) }); }
  catch (e) { metaErrors++; }
});
if (metaErrors) warnings.push(`${metaErrors} game-metadata requests failed; those bets are left out`);

for (const w of perWallet) {
  w.pregame = [];
  for (const p of w.positions) {
    const ev = events.get(p.slug), game = ev?.markets.get(p.condition);
    if (!ev || ev.sport === 'Non-sports' || !Number.isFinite(game)) continue;
    const buys = p.buys.filter((b) => b.t < game).sort((a, b) => a.t - b.t);
    if (!buys.length) continue;
    w.pregame.push({ ...p, buys: undefined, game, sport: ev.sport, eventId: (p.slug || p.condition).replace(/-more-markets$/, ''), price: buys[0].price, firstBuy: buys[0].t, stake: buys.reduce((s, b) => s + b.price * b.size, 0), lastBuy: buys.at(-1).t });
  }
}

// 3) results
const conditions = [...new Set(perWallet.flatMap((w) => w.pregame.filter((p) => p.game < now).map((p) => p.condition)))], payouts = new Map();
console.log(`${conditions.length} markets to settle`);
let resErrors = 0;
await pool(chunk(conditions, 20), 8, async (c) => {
  try { const r = await get(`${DATA}/v2/resolutions?condition=${c.join(',')}`); for (const x of r.data || []) if (x.status === 'resolved' && Array.isArray(x.payouts)) payouts.set(x.condition_id, x.payouts); }
  catch (e) { resErrors++; }
});
if (resErrors) warnings.push(`${resErrors} result requests failed; those bets are left out`);

// 4) score
const records = perWallet.filter((w) => !w.failed).map((w) => {
  const byGame = new Map();
  for (const p of w.pregame) {
    const pay = payouts.get(p.condition)?.[p.outcomeIndex];
    if (pay !== 0 && pay !== 1000000) continue;                       // unsettled, void or split: not a win or a loss
    const b = { price: p.price, payout: pay / 1e6, stake: p.stake, gameAt: p.game, boughtAt: p.firstBuy, sport: p.sport }, prev = byGame.get(p.eventId);
    if (!prev || prev.stake < b.stake) byGame.set(p.eventId, b);       // the wallet's main bet in that game
  }
  const rec = walletRecord({ bets: [...byGame.values()], stakes: w.pregame.map((p) => p.stake).filter((x) => x >= 10), lastBuyAt: w.pregame.length ? Math.max(...w.pregame.map((p) => p.lastBuy)) : null }, now);
  return { name: w.name, wallet: w.wallet, source: w.source, truncated: w.truncated, tradeRows: w.tradeRows, bets: [...byGame.values()], ...rec };
});
const sharps = rank(records);
// Sport specialists: each bettor judged sport by sport, with every edge marked down for luck. `data/listed.json` remembers when a
// bettor was first listed in a sport so the record since then (the only part not used to pick them) can be reported.
const LISTED = 'data/listed.json';
let listedBefore = {}; try { const j = JSON.parse(fs.readFileSync(LISTED, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) listedBefore = j; } catch {}
const spec = specialists(records.map((r) => ({ name: r.name, wallet: r.wallet, bets: r.bets, overall: r, medianStake: r.medianStake, lastBuyAt: r.lastBuyAt })), now, listedBefore);
const round = (x, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : null);
const tidySport = (x) => ({ rank: x.rank, games: x.games, wins: x.wins, winRate: round(x.winRate), avgPrice: round(x.avgPrice), edge: round(x.edge), roi: round(x.roi), adj: round(x.adj), credit: round(x.credit),
  proven: x.proven, cold: x.cold, since: { listedAt: x.since.listedAt, games: x.since.games, wins: x.since.wins, edge: round(x.since.edge), roi: round(x.since.roi) } });
const tidySpec = (r) => ({ name: r.name, wallet: r.wallet, medianStake: round(r.medianStake, 2), games: r.games, wins: r.wins ?? 0, losses: r.losses ?? 0, winRate: round(r.winRate), avgPrice: round(r.avgPrice), edge: round(r.edge),
  sports: Object.fromEntries(Object.entries(r.sports).sort((a, b) => a[1].rank - b[1].rank).map(([k, x]) => [k, tidySport(x)])) });
const tidy = (r) => ({ rank: r.rank ?? null, name: r.name, wallet: r.wallet, source: r.source, qualified: r.qualified, proven: !!r.proven, reasons: r.reasons,
  games: r.games, wins: r.wins ?? 0, losses: r.losses ?? 0, winRate: round(r.winRate), avgPrice: round(r.avgPrice), edge: round(r.edge), edgeLower: round(r.edgeLower),
  roi: round(r.roi), heldPnl: round(r.heldPnl, 0), olderEdge: round(r.olderEdge), newerEdge: round(r.newerEdge), spanDays: round(r.spanDays, 0),
  medianStake: round(r.medianStake, 2), typicalBets: r.typicalBets, lastBuyAt: r.lastBuyAt, truncated: !!r.truncated,
  bySport: Object.fromEntries(Object.entries(r.bySport || {}).map(([k, s]) => [k, { games: s.games, wins: s.wins, winRate: round(s.winRate), avgPrice: round(s.avgPrice), edge: round(s.edge), roi: round(s.roi) }])) });
const out = { version: 2, policy: POLICY, generatedAt: new Date(now).toISOString(), windowDays: WINDOW_DAYS, rules: RULES,
  method: 'One bet per game: the wallet\'s largest pre-game position, bought on one side only, held to the result. Edge = win rate minus the all-in price paid (assumed fee 0.05·p·(1−p)). Ranked by the conservative (one-sided 95%) edge. To be listed a wallet needs 50+ settled bets over 30+ days, a bet in the last 21 days, a win rate at least 2 points above price with a positive flat-stake return, and to be ahead in both the older and newer half of its record. "Proven" means the conservative edge is still above zero. Retrospective; not proof of future profit.',
  counts: { wallets: wallets.length, scored: records.length, qualified: records.filter((r) => r.qualified).length, proven: records.filter((r) => r.proven).length, ...counts, events: events.size, settledMarkets: payouts.size },
  sportRules: SPORT_RULES, luck: { averageEdge: round(spec.prior.mu), skillSpread: round(spec.prior.tau), records: spec.prior.records, tested: spec.prior.tested, proven: spec.prior.proven },
  sportMethod: 'Sport specialists: each bettor is scored separately in each sport (30+ settled bets there, active, ahead of the price overall and in the newer half). Hundreds of records are screened, so each edge is marked down for luck: "adj" pulls it towards the average of all records, more strongly on fewer bets, and "proven" is decided across all records together so that only about one in five proven records should be a fluke. "since" is the record on bets placed after the bettor was first listed in that sport.',
  warnings, specialists: spec.specialists.map(tidySpec), sharps: sharps.map(tidy), others: records.filter((r) => !sharps.includes(r)).sort((a, b) => (b.games >= RULES.minGames) - (a.games >= RULES.minGames) || b.edgeLower - a.edgeLower).map(tidy) };
if (records.length < wallets.length * 0.8 || !payouts.size) { console.error('Too much data missing; leaderboard not written.', JSON.stringify(out.counts), warnings.slice(0, 5)); process.exit(1); }
fs.mkdirSync('data', { recursive: true });
if (!process.env.PROBE) fs.writeFileSync('data/leaderboard.json', JSON.stringify(out, null, 1));
if (!process.env.PROBE) fs.writeFileSync(LISTED, JSON.stringify(Object.fromEntries(Object.entries(spec.listed).sort()), null, 1));
if (process.env.PROBE) fs.writeFileSync('data/probe.json', JSON.stringify({ generatedAt: out.generatedAt, counts: out.counts, luck: out.luck, warnings, sources: Object.entries(records.reduce((m, r) => { m[r.source] = (m[r.source] || 0) + 1; return m; }, {})),
  pairs: spec.pairs.map((p) => { const mine = p.w.bets.filter((b) => b.sport === p.sport), lead = (b) => (b.gameAt - b.boughtAt) / 36e5;
    const part = (lo, hi = Infinity) => { const s = score(mine.filter((b) => lead(b) >= lo && lead(b) < hi)); return s.games ? { games: s.games, wins: s.wins, avgPrice: round(s.avgPrice), edge: round(s.edge), se: round(s.se), z: s.se > 0 ? round(s.edge / s.se, 2) : null, roi: round(s.roi) } : { games: 0 }; };
    return { leadMedianH: round(median(mine.map(lead)), 2), lt1h: part(0, 1), h1to3: part(1, 3), h3to12: part(3, 12), h12plus: part(12), early2h: part(2), early6h: part(6), name: p.w.name, wallet: p.w.wallet, source: records.find((r) => r.wallet === p.w.wallet)?.source, sport: p.sport, games: p.r.games, wins: p.r.wins, avgPrice: round(p.r.avgPrice), edge: round(p.r.edge), se: round(p.r.se), z: round(p.r.edge / p.r.se, 2), roi: round(p.r.roi),
    older: round(p.r.olderEdge), newer: round(p.r.newerEdge), spanDays: round(p.r.spanDays, 0), lastGameAt: p.r.lastGameAt, lastBuyAt: p.w.lastBuyAt, adj: round(p.adj), credit: round(p.credit), proven: p.proven === true, listable: !!p.listable, medianStake: round(p.w.medianStake, 0), truncated: !!records.find((r) => r.wallet === p.w.wallet)?.truncated }; }) }));
const pct = (x) => (x == null ? '—' : (100 * x).toFixed(1));
console.log(`\n${out.counts.qualified} of ${records.length} scored wallets qualify. Top ${sharps.length}:`);
for (const r of out.sharps) console.log(`#${String(r.rank).padStart(2)} ${r.name.padEnd(28)} ${String(r.wins).padStart(3)}-${String(r.losses).padEnd(3)} win ${pct(r.winRate)}% at avg ${pct(r.avgPrice)}¢ | edge +${pct(r.edge)} (low ${pct(r.edgeLower)}) | roi ${pct(r.roi)}% | halves ${pct(r.olderEdge)}/${pct(r.newerEdge)} | median bet $${Math.round(r.medianStake)} | ${r.proven ? 'PROVEN' : 'leading'} | ${r.source}${r.truncated ? ' | truncated' : ''}`);
console.log('\nBest of the rest:'); for (const r of out.others.slice(0, 15)) console.log(`   ${r.name.padEnd(28)} ${r.wins}-${r.losses} win ${pct(r.winRate)}% at ${pct(r.avgPrice)}¢ edge ${pct(r.edge)} (low ${pct(r.edgeLower)}) :: ${r.reasons.join('; ')}`);
console.log(JSON.stringify(out.counts), warnings.slice(0, 10));
console.log(`\nLuck model: average edge ${pct(spec.prior.mu)} pts, spread of real skill ${pct(spec.prior.tau)} pts across ${spec.prior.records} sport records; ${spec.prior.proven} of ${spec.prior.tested} proven. ${out.specialists.length} specialists:`);
for (const r of out.specialists) console.log(`   ${r.name.padEnd(28)} ` + Object.entries(r.sports).map(([k, x]) => `${k} #${x.rank} ${x.wins}-${x.games - x.wins} raw +${pct(x.edge)} credited +${pct(x.credit)}${x.proven ? ' PROVEN' : ''}${x.cold ? ' COLD' : ''}${x.since.games ? ` since ${x.since.wins}-${x.since.games - x.since.wins}` : ''}`).join(' | '));
