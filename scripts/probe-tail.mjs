// PROBE (research branch only). For chosen bettor-sport records: would copying them have paid?
// Each early bet (first bought 2+ hours before the game) is re-priced at the market price 30 minutes after the bettor
// bought and at the last price before the game, and the record is re-scored at those prices.
import fs from 'node:fs';
import { classify } from '../cloudflare/roster.mjs';
import { score } from './leaderboard-stats.mjs';
const DATA = 'https://data-api.polymarket.com', GAMMA = 'https://gamma-api.polymarket.com';
const now = Date.now(), start = Math.floor(now / 1000) - 180 * 86400, end = Math.floor(now / 1000), CAP = +process.env.CAP || 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let requests = 0;
async function get(url, tries = 5) { for (let i = 0; ; i++) { requests++; try { const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json', 'User-Agent': 'LuckSociety-Polysharp/1.0 (probe)' } }); if (r.ok) return await r.json(); if (i >= tries - 1 || (r.status !== 429 && r.status < 500)) throw Error('HTTP ' + r.status); } catch (e) { if (i >= tries - 1 || /HTTP 4(?!29)/.test(e.message)) throw e; } await sleep(1500 * 2 ** i); } }
async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }
const chunk = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const targets = JSON.parse(fs.readFileSync('data/probe-targets.json', 'utf8')), wallets = [...new Set(targets.map((t) => t.wallet))];
async function trades(wallet) { const rows = []; let cursor = null; for (let i = 0; i < 40; i++) { const u = new URL(`${DATA}/v2/activity?user=${wallet}&type=TRADE&start=${start}&end=${end}&sort_direction=DESC&limit=1000`); if (cursor) u.searchParams.set('cursor', cursor); const page = await get(u.href); rows.push(...(page.data || [])); cursor = page.pagination?.next_cursor; if (!cursor) break; } return rows; }
const per = new Map();
await pool(wallets, 6, async (w) => {
  try {
    const pos = new Map(), sides = new Map();
    for (const a of await trades(w)) { if (a.side !== 'BUY' || a.is_combo || a.outcome_index === 999 || !a.condition_id || !(a.price > 0 && a.price < 1) || !(a.size > 0)) continue;
      const set = sides.get(a.condition_id) || new Set(); set.add(a.token_id); sides.set(a.condition_id, set);
      const k = a.condition_id + '|' + a.token_id, p = pos.get(k) || { condition: a.condition_id, token: a.token_id, slug: a.event_slug, outcomeIndex: a.outcome_index, buys: [] }; p.buys.push({ t: a.timestamp * 1000, price: +a.price, size: +a.size }); pos.set(k, p); }
    per.set(w, [...pos.values()].filter((p) => sides.get(p.condition).size === 1));
  } catch (e) { console.log('trades failed', w, e.message); per.set(w, []); }
});
console.log(`${wallets.length} wallets read · ${requests} requests`);
const slugs = [...new Set([...per.values()].flat().map((p) => p.slug).filter(Boolean))], events = new Map();
await pool(chunk(slugs, 25), 8, async (c) => { try { for (const e of await get(`${GAMMA}/events?${c.map((s) => 'slug=' + encodeURIComponent(s)).join('&')}&limit=100`)) events.set(e.slug, { sport: classify((e.tags || []).map((t) => t.slug), e.slug), markets: new Map((e.markets || []).filter((m) => m.gameStartTime).map((m) => [m.conditionId, Date.parse(m.gameStartTime)])) }); } catch {} });
const bets = new Map();   // wallet|sport -> main early bet per game
for (const t of targets) {
  const byGame = new Map();
  for (const p of per.get(t.wallet) || []) { const ev = events.get(p.slug), game = ev?.markets.get(p.condition); if (!ev || ev.sport !== t.sport || !Number.isFinite(game) || game >= now) continue;
    const buys = p.buys.filter((b) => b.t < game).sort((a, b) => a.t - b.t); if (!buys.length) continue;
    const b = { condition: p.condition, token: p.token, outcomeIndex: p.outcomeIndex, game, t: buys[0].t, price: buys[0].price, stake: buys.reduce((s, x) => s + x.price * x.size, 0), sport: t.sport }, id = (p.slug || p.condition).replace(/-more-markets$/, ''), prev = byGame.get(id);
    if (!prev || prev.stake < b.stake) byGame.set(id, b); }
  bets.set(t.wallet + '|' + t.sport, [...byGame.values()].filter((b) => b.game - b.t >= 2 * 36e5).sort((a, b) => b.game - a.game).slice(0, CAP));
}
const all = [...bets.values()].flat(), payouts = new Map();
await pool(chunk([...new Set(all.map((b) => b.condition))], 20), 8, async (c) => { try { const r = await get(`${DATA}/v2/resolutions?condition=${c.join(',')}`); for (const x of r.data || []) if (x.status === 'resolved' && Array.isArray(x.payouts)) payouts.set(x.condition_id, x.payouts); } catch {} });
console.log(`${all.length} early bets to re-price · ${requests} requests`);
let shown = 0;
const priceAt = async (token, asOfMs, notBeforeMs) => {
  try { const j = await get(`${DATA}/v2/prices-history?token_id=${token}&as_of=${Math.floor(asOfMs / 1000)}`, 3);
    if (shown++ < 3) console.log('sample prices-history', JSON.stringify(j).slice(0, 500));
    const pts = (j.data || []).filter((p) => p.price > 0 && p.price < 1 && Number.isFinite(p.timestamp) && (p.timestamp + (p.resolution_seconds || 0)) * 1000 <= asOfMs + 1000).sort((a, b) => b.timestamp - a.timestamp);
    const pt = pts[0]; if (!pt) return { price: null, why: 'none' };
    return { price: pt.price, ageMin: (asOfMs - (pt.timestamp + (pt.resolution_seconds || 0)) * 1000) / 60000, res: pt.resolution_seconds ?? null, stale: (pt.timestamp + (pt.resolution_seconds || 0)) * 1000 < notBeforeMs };
  } catch (e) { return { price: null, why: e.message }; }
};
await pool(all, 8, async (b) => { const pay = payouts.get(b.condition)?.[b.outcomeIndex]; b.payout = pay === 1e6 ? 1 : pay === 0 ? 0 : null; if (b.payout === null) return;
  b.after = await priceAt(b.token, Math.min(b.t + 30 * 60000, b.game - 60000), b.t); b.close = await priceAt(b.token, b.game - 1000, b.t); });
console.log(`re-priced · ${requests} requests`);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null), mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const out = targets.map((t) => { const bs = (bets.get(t.wallet + '|' + t.sport) || []).filter((b) => b.payout !== null);
  const sc = (pick) => { const xs = bs.map((b) => ({ price: pick(b), payout: b.payout, stake: 1, gameAt: b.game, sport: b.sport })).filter((x) => x.price > 0 && x.price < 1); const s = score(xs); return s.games ? { games: s.games, wins: s.wins, avgPrice: r4(s.avgPrice), edge: r4(s.edge), se: r4(s.se), roi: r4(s.roi) } : { games: 0 }; };
  const both = bs.filter((b) => b.after?.price && b.close?.price), fresh = bs.filter((b) => b.after?.price && !b.after.stale);
  return { ...t, bets: bs.length, entry: sc((b) => b.price), after30: sc((b) => b.after?.price), after30fresh: sc((b) => (b.after && !b.after.stale ? b.after.price : null)), close: sc((b) => b.close?.price),
    entryOnPriced: sc((b) => (b.after?.price ? b.price : null)), moveAfter30: r4(mean(bs.filter((b) => b.after?.price).map((b) => b.after.price - b.price))), moveClose: r4(mean(bs.filter((b) => b.close?.price).map((b) => b.close.price - b.price))),
    staleShare: r4(bs.filter((b) => b.after?.price).length ? bs.filter((b) => b.after?.price && b.after.stale).length / bs.filter((b) => b.after?.price).length : null), medianStake: r4(bs.map((b) => b.stake).sort((a, b) => a - b)[bs.length >> 1]), ageMin: r4(mean(fresh.map((b) => b.after.ageMin))), res: both[0]?.after?.res ?? null }; });
fs.writeFileSync('data/probe-tail.json', JSON.stringify({ generatedAt: new Date(now).toISOString(), requests, cap: CAP, records: out }));
for (const o of out.slice(0, 12)) console.log(JSON.stringify(o).slice(0, 700));
