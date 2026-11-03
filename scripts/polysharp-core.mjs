// Browser- and Node-safe scan core for PolySharp (no Node imports). Used by scripts/polysharp.mjs.
const DATA = 'https://data-api.polymarket.com/v2';
const GAMMA = 'https://gamma-api.polymarket.com';
const SITE = 'https://lucksociety.github.io/polymarket-sharp-scanner/';
const GOLD = 0xE8B931, GREEN = 0x1F8A3A;
const TOP_N = 10;
const MIN_BOOK = 25000;          // accounts smaller than this are ignored for conviction ranking
const MIN_BET = 1000;            // ignore bets under $1K
const LIVE_WINDOW = 3.5 * 3600e3;
const HORIZON = 7 * 864e5;       // only games starting within the next 7 days (or live)

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) { await sleep(1000 * (+r.headers.get('retry-after') || 2) + 300 * i); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(600 * (i + 1)); }
  }
  throw new Error('rate limited');
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const money = v => { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K' : a.toFixed(0); return (v < 0 ? '-$' : '$') + s; };
const cents = p => (p * 100).toFixed(p < 0.1 || p > 0.9 ? 1 : 0) + '¢';
const pct = v => v >= 0.1 ? (v * 100).toFixed(0) + '%' : (v * 100).toFixed(1) + '%';

export function classify(tags, slug = '') {
  const t = new Set(tags), s = slug;
  if (t.has('nfl') || s.startsWith('nfl-')) return 'NFL';
  if (t.has('nba') || s.startsWith('nba-')) return 'NBA';
  if (t.has('nhl') || s.startsWith('nhl-')) return 'NHL';
  if (t.has('mlb') || s.startsWith('mlb-')) return 'MLB';
  if (t.has('ufc') || t.has('mma') || s.startsWith('ufc-')) return 'UFC';
  if (t.has('league-of-legends') || t.has('lol') || s.startsWith('lol-')) return 'LoL';
  if (t.has('esports') || /^(cs2|dota2|val)-/.test(s)) return 'Esports';
  if (t.has('tennis') || s.startsWith('atp-') || s.startsWith('wta-')) return 'Tennis';
  if (t.has('soccer')) return 'Soccer';
  if (t.has('sports') || t.has('games')) return 'Other sports';
  return 'Non-sports';
}
const EMOJI = { NFL: '🏈', NBA: '🏀', NHL: '🏒', MLB: '⚾', UFC: '🥊', LoL: '🎮', Esports: '🎮', Tennis: '🎾', Soccer: '⚽', 'Other sports': '🏟️' };

async function openPositions(wallet) {
  const all = []; let cursor = null;
  for (let page = 0; page < 5; page++) {
    const res = await getJSON(`${DATA}/positions?user=${wallet}&status=OPEN&sort_by=CURRENT_VALUE&sort_direction=DESC&limit=1000` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''));
    const rows = res?.data || []; all.push(...rows);
    cursor = res?.pagination?.next_cursor; if (!cursor || !rows.length) break;
  }
  return all;
}

export async function scan(roster, now = Date.now()) {
  const wallets = roster.traders;
  const per = await pool(wallets, 4, async t => {
    try {
      const rows = await openPositions(t.wallet);
      const open = rows.filter(r => !r.redeemable && r.current_price > 0.002 && r.current_price < 0.998 && r.current_value >= 1);
      let book = 0;
      try { book = +(await getJSON(`${DATA}/value?user=${t.wallet}`))?.data?.value || 0; } catch {}
      book = Math.max(book, open.reduce((a, r) => a + r.current_value, 0));
      const sides = {}; open.forEach(r => (sides[r.condition_id] ||= new Set()).add(r.outcome_index));
      return { t, book, open: open.map(r => ({ ...r, hedged: sides[r.condition_id].size > 1 })) };
    } catch (e) { return { t, book: 0, open: [], error: e.message }; }
  });
  const slugs = [...new Set(per.flatMap(x => x.open.map(r => r.event_slug)).filter(Boolean))];
  const events = {};
  const chunks = []; for (let i = 0; i < slugs.length; i += 40) chunks.push(slugs.slice(i, i + 40));
  await pool(chunks, 3, async chunk => {
    try {
      const evs = await getJSON(`${GAMMA}/events?${chunk.map(s => 'slug=' + encodeURIComponent(s)).join('&')}&limit=100`);
      for (const e of evs) {
        const gs = (e.markets || []).map(m => m.gameStartTime).find(Boolean);
        events[e.slug] = { sport: classify((e.tags || []).map(x => x.slug), e.slug), game: gs ? Date.parse(String(gs).replace(' ', 'T').replace(/\+00$/, 'Z')) : NaN, title: e.title };
      }
    } catch {}
  });
  const bets = [];
  for (const x of per) {
    if (x.book < MIN_BOOK) continue;
    for (const r of x.open) {
      const ev = events[r.event_slug] || { sport: classify([], r.event_slug), game: NaN, title: r.title };
      if (ev.sport === 'Non-sports' || r.hedged || r.current_value < MIN_BET) continue;
      if (isNaN(ev.game) || ev.game < now - LIVE_WINDOW || ev.game > now + HORIZON) continue;
      bets.push({ trader: x.t.name, wallet: x.t.wallet, spec: x.t.spec, sport: ev.sport, event: ev.title, event_slug: r.event_slug,
        market: r.title, outcome: r.outcome, condition: r.condition_id, entry: r.avg_price, price: r.current_price,
        value: r.current_value, book: x.book, conv: Math.min(1, r.current_value / x.book), game: ev.game, live: ev.game <= now });
    }
  }
  bets.sort((a, b) => b.conv - a.conv || b.value - a.value);
  const top = [], seen = new Set();
  for (const b of bets) { const k = b.wallet + b.condition; if (seen.has(k)) continue; seen.add(k); top.push(b); if (top.length === TOP_N) break; }
  // how many roster wallets are on the same side of each top bet
  for (const b of top) b.backers = per.filter(x => x.open.some(r => r.condition_id === b.condition && r.outcome === b.outcome && !r.hedged)).map(x => x.t.name);
  return { scannedAt: now, wallets: wallets.length, withBets: per.filter(x => x.open.length).length, errors: per.filter(x => x.error).map(x => x.t.name), candidates: bets.length, top };
}

const et = ts => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(ts) + ' ET';

export function discordMessages(result, source) {
  const header = {
    color: GOLD,
    title: '☘️ PolySharp · Top 10 Conviction Bets',
    url: SITE,
    description: `The biggest bets, as a share of their whole open book, from **${result.wallets}** proven-profitable sports wallets on Polymarket. Games in the next 7 days or live now.`,
    footer: { text: `Luck Society · ${source === 'dashboard' ? 'Triggered from the dashboard' : '/polysharp'} · ${result.candidates} qualifying bets scanned · Not betting advice` },
    timestamp: new Date(result.scannedAt).toISOString(),
  };
  if (!result.top.length) return [{ embeds: [{ ...header, color: GREEN, description: header.description + '\n\nNo qualifying bets right now.' }] }];
  const fields = result.top.map((b, i) => ({
    name: `${i + 1}. ${EMOJI[b.sport] || '🏟️'} ${b.outcome} @ ${cents(b.price)} · ${pct(b.conv)} of book`.slice(0, 256),
    value: [`${b.market}`.slice(0, 180),
      `**${b.trader}** · ${money(b.value)} on it (book ${money(b.book)}) · entry ${cents(b.entry)}`,
      `${b.live ? '🔴 Live now' : '🕒 ' + et(b.game)}${b.backers.length > 1 ? ` · 🤝 also: ${b.backers.filter(n => n !== b.trader).slice(0, 3).join(', ')}` : ''} · [market](https://polymarket.com/event/${b.event_slug})`].join('\n').slice(0, 1024),
  }));
  return [{ embeds: [{ ...header, fields }] }];
}
