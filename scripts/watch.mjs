// Watches the ranked bettors for new big bets. When one appears it asks the worker to rescan and post an alert.
// The worker decides what is actually posted and never repeats a card; this script only avoids waking it for nothing.
import fs from 'node:fs';
import { roster, collect, readPublic, validateOptions } from '../cloudflare/scanner.mjs';
import { selectWatchlist } from '../cloudflare/journal.mjs';
const STATE = process.env.STATE_FILE || '.alert-state.json', WORKER = process.env.ALERT_URL || 'https://polysharp.dreiss324.workers.dev/alert';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, ids) => { for (let i = 0; ; i++) { try { return await readPublic(url, ids); } catch (e) { if (i >= 3) throw e; await sleep(1500 * 2 ** i); } } };
const now = Date.now();
let state = null; try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
const first = !state?.seen; state = { seen: {}, ...(state || {}) };

const traders = await roster(get, []);
if (!traders.some((t) => t.sharp)) { console.log('Leaderboard unavailable; nothing to watch.'); process.exit(0); }
const scan = await collect(get, traders, { ...validateOptions([]), asOf: now });
if (!scan.complete) { console.log('Incomplete scan; skipping this round.', scan.warnings.slice(0, 3)); process.exit(0); }
const recent = (p) => { const t = typeof p.lastEvent === 'number' ? (p.lastEvent < 1e12 ? p.lastEvent * 1000 : p.lastEvent) : Date.parse(p.lastEvent); return !Number.isFinite(t) || now - t < 6 * 3600000; };
const cards = selectWatchlist(scan.candidates, { now, limit: 10 }).filter((p) => p.sharp && p.trust?.alert), key = (p) => p.wallet + '|' + p.asset;
const fresh = cards.filter((p) => !state.seen[key(p)] && recent(p));
console.log(`${scan.scannedWallets} wallets, ${cards.length} cards, ${fresh.length} new${first ? ' (first run: recording only)' : ''}`);
for (const p of fresh) console.log(`  new: #${p.sharp.rank} ${p.trader} · ${p.title} · ${p.outcome} · ${p.trust.tier} · ${p.sizeMultiple.toFixed(1)}x`);

let accepted = first || !fresh.length;
if (!first && fresh.length) {
  try {
    const r = await fetch(WORKER, { method: 'POST', signal: AbortSignal.timeout(20000) });
    console.log('alert request:', r.status, (await r.text()).slice(0, 200));
    accepted = r.status === 202;
  } catch (e) { console.log('alert request failed:', e.message); }
}
// Remember every card that is not new, and the new ones only once the worker has taken the request.
for (const p of cards) if (accepted || !fresh.includes(p)) state.seen[key(p)] = state.seen[key(p)] || now;
for (const [k, t] of Object.entries(state.seen)) if (now - t > 14 * 864e5) delete state.seen[k];
fs.writeFileSync(STATE, JSON.stringify(state));
