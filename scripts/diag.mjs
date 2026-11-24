// Diagnostic (research branch): how many public requests does one scan of the listed bettors need?
import { roster, collect, readPublic, validateOptions, postable, bigEnough, convinced } from '../cloudflare/scanner.mjs';
import { selectWatchlist } from '../cloudflare/journal.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const calls = { events: 0, positions: 0, activity: 0, other: 0 }; let slugs = 0, big = 0;
const get = async (url, ids) => { const u = new URL(url); const k = u.pathname === '/events' ? 'events' : u.pathname.includes('positions') ? 'positions' : u.pathname.includes('activity') ? 'activity' : 'other'; calls[k]++; if (k === 'events') slugs += u.searchParams.getAll('slug').length;
  for (let i = 0; ; i++) { try { const v = await readPublic(url, ids); return v; } catch (e) { if (/safe Workflow result size/.test(e.message)) { big++; console.log('TOO BIG', u.pathname, u.searchParams.get('user') || ''); } if (i >= 3) throw e; await sleep(1500 * 2 ** i); } } };
const traders = await roster(get, []); const opts = { ...validateOptions([]), asOf: Date.now() };
const scan = await collect(get, traders, opts);
const perWallet = {}; for (const p of scan.positions) { const w = p.trader; perWallet[w] ||= { open: 0, meta: 0 }; perWallet[w].open++; if (p.netShares > 0 && p.outcomeIndex !== 999 && bigEnough(p, opts.settings) && convinced(p, opts.settings)) perWallet[w].meta++; }
console.log('DIAG', JSON.stringify({ wallets: traders.length, ranked: traders.filter((t) => t.sharp).length, complete: scan.complete, warnings: scan.warnings.slice(0, 5), positions: scan.positions.length, calls, slugs, eventChunks: calls.events, tooBig: big, candidates: scan.candidates.length, postable: selectWatchlist(scan.candidates, { limit: 100, keep: postable }).length, all: selectWatchlist(scan.candidates, { limit: 100 }).length }));
console.log('DIAG top wallets by metadata rows', JSON.stringify(Object.entries(perWallet).sort((a, b) => b[1].meta - a[1].meta).slice(0, 12)));
const recent = (p) => { const t = typeof p.lastEvent === 'number' ? (p.lastEvent < 1e12 ? p.lastEvent * 1000 : p.lastEvent) : Date.parse(p.lastEvent); return !Number.isFinite(t) || Date.now() - t < 6 * 3600000; };
for (const p of selectWatchlist(scan.candidates, { limit: 20, keep: postable })) console.log('DIAG card', p.sport, p.trader, '|', p.title, '|', p.outcome, '|', p.trust.tier, 'alert', p.trust.alert, 'recent', recent(p), 'x' + p.sizeMultiple?.toFixed(1), '$' + Math.round(p.currentValue), 'paid', p.avgPrice, 'now', p.curPrice, 'starts in h', ((p.game - Date.now()) / 36e5).toFixed(1));
// Size of each wallet's scan result as the worker would store it (a Workflow step result may not exceed 1 MiB).
import { fetchWallet } from '../cloudflare/scanner.mjs';
const sizes = [];
for (const t of traders) { try { const v = await fetchWallet(t, get, opts.asOf); const full = Buffer.byteLength(JSON.stringify(v)), slim = Buffer.byteLength(JSON.stringify({ ...v, positions: v.positions.map(({ sharp, ...p }) => p) })); sizes.push([t.name, v.positions.length, full, slim]); } catch (e) { sizes.push([t.name, -1, 0, 0]); } }
console.log('DIAG sizes (name, positions, bytes with record, bytes without)', JSON.stringify(sizes.sort((a, b) => b[2] - a[2]).slice(0, 8)), 'over 1MiB:', sizes.filter((s) => s[2] > 1048576).length, 'total', sizes.reduce((a, s) => a + s[2], 0));
