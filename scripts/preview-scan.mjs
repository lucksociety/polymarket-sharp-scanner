// Dry run of the /polysharp scan with live public data. Prints the Discord report; posts nothing.
import { roster, collect, readPublic, DEFAULTS, validateOptions } from '../cloudflare/scanner.mjs';
import { selectWatchlist } from '../cloudflare/journal.mjs';
import { scanReport } from '../cloudflare/scan-report.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
const get = async (url, ids) => { for (let i = 0; ; i++) { calls++; try { return await readPublic(url, ids); } catch (e) { if (i >= 3) throw e; await sleep(1500 * 2 ** i); } } };
const SPORT = process.env.SPORT || 'All';
const warnings = [], traders = await roster(get, warnings), options = validateOptions(SPORT === 'All' ? [] : [{ name: 'sport', type: 3, value: SPORT }]);
console.log(`roster: ${traders.length} wallets, ranked=${traders.some((t) => t.sharp)}`, warnings);
const scan = await collect(get, traders, { ...options, asOf: Date.now() });
console.log(`scanned ${scan.scannedWallets}/${traders.length}, positions ${scan.positions.length}, candidates ${scan.candidates.length}, complete ${scan.complete}, calls ${calls}`, scan.warnings.slice(0, 5));
const upcoming = scan.positions.filter((p) => p.isGame && p.game > Date.now() && p.netShares > 0);
console.log(`upcoming-game positions with game metadata: ${upcoming.length}; at least $1,000: ${upcoming.filter((p) => p.currentValue >= 1000).length}`);
const mult = scan.positions.filter((p) => p.netShares > 0 && p.currentValue >= 200 && Number.isFinite(p.sizeMultiple)).map((p) => p.sizeMultiple).sort((a, b) => a - b);
console.log(`size multiples among $1,000+ positions: n=${mult.length} median=${mult[mult.length >> 1]?.toFixed(2)} >=0.5x: ${mult.filter((m) => m >= 0.5).length}`);
const watchlist = selectWatchlist(scan.candidates, { now: Date.now(), limit: 10 });
const out = scanReport({ watchlist, scan, rosterCount: traders.length, options, now: Date.now() });
for (const e of out.payload.embeds) { console.log('\n=== ' + e.title + '\n' + (e.description || '')); for (const f of e.fields || []) console.log('\n' + f.name + '\n' + f.value); }
