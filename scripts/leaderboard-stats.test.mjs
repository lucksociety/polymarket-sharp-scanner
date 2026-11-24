import test from 'node:test';
import assert from 'node:assert/strict';
import { score, walletRecord, rank, median, RULES } from './leaderboard-stats.mjs';
const day = 864e5, now = Date.UTC(2026, 10, 16);
const bets = (n, wins, price, sport = 'NBA') => Array.from({ length: n }, (_, i) => ({ price, payout: i % n < 0 ? 0 : (i * wins) % n < wins ? 1 : 0, stake: 100, gameAt: now - (n - i) * day, sport }));
test('edge is win rate minus the all-in price, not raw win rate', () => {
  const fav = score(bets(100, 90, 0.92)), dog = score(bets(100, 60, 0.5));
  assert.equal(fav.winRate, 0.9); assert.ok(fav.edge < 0);          // 90% winners at 92¢ lose money
  assert.equal(dog.winRate, 0.6); assert.ok(dog.edge > 0.08);       // 60% winners at 50¢ are sharp
  assert.ok(dog.edgeLower < dog.edge);
});
test('median stake', () => { assert.equal(median([1, 9, 5]), 5); assert.equal(median([1, 3]), 2); assert.equal(median([]), null); });
test('qualification needs sample, both halves, recency', () => {
  const good = walletRecord({ bets: bets(120, 78, 0.5), stakes: [100, 200, 300], lastBuyAt: now - day }, now);
  assert.equal(good.qualified, true); assert.equal(good.proven, true); assert.equal(good.medianStake, 200);
  const thin = walletRecord({ bets: bets(100, 56, 0.5), stakes: [1], lastBuyAt: now }, now);
  assert.equal(thin.qualified, true); assert.equal(thin.proven, false);              // ahead, but could be luck
  assert.equal(walletRecord({ bets: bets(400, 212, 0.5), stakes: [1], lastBuyAt: now }, now).qualified, false);   // under 2 points above price
  assert.equal(walletRecord({ bets: bets(30, 25, 0.5), stakes: [1], lastBuyAt: now }, now).qualified, false);
  assert.equal(walletRecord({ bets: bets(120, 78, 0.5), stakes: [1], lastBuyAt: now - 40 * day }, now).qualified, false);
  // great first half, losing second half
  const mixed = [...bets(60, 55, 0.5).map((b) => ({ ...b, gameAt: b.gameAt - 100 * day })), ...bets(60, 27, 0.5)];
  const r = walletRecord({ bets: mixed, stakes: [1], lastBuyAt: now }, now);
  assert.ok(r.olderEdge > 0 && r.newerEdge < 0); assert.equal(r.qualified, false);
});
test('rank orders by conservative edge and caps the list', () => {
  const rs = [0.55, 0.7, 0.62].map((w, i) => ({ name: 'w' + i, ...walletRecord({ bets: bets(200, Math.round(200 * w), 0.5), stakes: [1], lastBuyAt: now }, now) }));
  const top = rank(rs, { ...RULES, topN: 2 });
  assert.deepEqual(top.map((r) => r.name), ['w1', 'w2']); assert.equal(top[0].rank, 1);
});

import { SPORT_RULES, upperTail, skillPrior, shrink, discoveries, sportRecords, sinceListed, specialists } from './leaderboard-stats.mjs';
// Deterministic pseudo-random bets: `p` is the true win chance, `price` what was paid.
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const drawn = (n, p, price, sport, r, t0 = now - 150 * day) => Array.from({ length: n }, (_, i) => ({ price, payout: r() < p ? 1 : 0, stake: 100, gameAt: t0 + (i + 1) * (140 * day / n), boughtAt: t0 + (i + 1) * (140 * day / n) - 36e5, sport }));
test('normal tail and false-discovery control', () => {
  assert.ok(Math.abs(upperTail(1.645) - 0.05) < 1e-3); assert.ok(Math.abs(upperTail(0) - 0.5) < 1e-6); assert.ok(Math.abs(upperTail(-1.645) - 0.95) < 1e-3);
  assert.deepEqual(discoveries([0.0001, 0.04, 0.5, 0.9], 0.2), [true, true, false, false]);
  assert.deepEqual(discoveries([0.2, 0.5, 0.9], 0.2), [false, false, false]);      // nothing stands out: nothing is proven
});
test('edges are pulled towards the average, more strongly on fewer bets', () => {
  const prior = { mu: 0, tau2: 0.02 ** 2 };
  const few = shrink(0.2, 0.05, prior), many = shrink(0.03, 0.01, prior);
  assert.ok(few.adj < 0.03 && few.adj > 0); assert.ok(many.adj > 0.02 && many.adj < 0.03);
  assert.equal(shrink(0.2, 0.05, { mu: 0.001, tau2: 0 }).adj, 0.001);               // no real spread of skill: nobody keeps an edge
  assert.equal(skillPrior([{ edge: 0.1, se: 0.05 }]).tau2, 0);
});
test('a crowd of coin-flippers yields no proven bettor; a real one is found and ranked first in their sport', () => {
  const r = rng(7), wallets = [];
  for (let i = 0; i < 120; i++) { const bets = drawn(80, 0.5, 0.5, i % 2 ? 'NBA' : 'NHL', r); wallets.push({ name: 'luck' + i, wallet: '0x' + String(i).padStart(40, '0'), bets, overall: score(bets), medianStake: 100, lastBuyAt: now - day }); }
  const noise = specialists(wallets, now);
  assert.equal(noise.prior.proven, 0);
  assert.ok(noise.specialists.every((s) => Object.values(s.sports).every((x) => !x.proven && x.credit < 0.03)));   // lucky records keep almost none of their edge
  const sharpBets = drawn(400, 0.62, 0.5, 'NBA', r);
  wallets.push({ name: 'real', wallet: '0x' + 'a'.repeat(40), bets: sharpBets, overall: score(sharpBets), medianStake: 250, lastBuyAt: now - day });
  const out = specialists(wallets, now), real = out.specialists.find((s) => s.name === 'real');
  assert.ok(real); assert.equal(real.sports.NBA.proven, true); assert.equal(real.sports.NBA.rank, 1); assert.ok(real.sports.NBA.credit > 0.04 && real.sports.NBA.credit <= SPORT_RULES.maxCredit);
  assert.equal(real.sports.NHL, undefined);                                         // no credit outside the sport
  assert.ok(Object.values(out.specialists.reduce((m, s) => { for (const k of Object.keys(s.sports)) m[k] = (m[k] || 0) + 1; return m; }, {})).every((n) => n <= SPORT_RULES.perSport));
  assert.ok(out.specialists.length <= SPORT_RULES.maxWallets);
});
test('idle bettors and one-sport records are handled per sport', () => {
  const r = rng(3), good = drawn(300, 0.6, 0.5, 'Soccer', r), bad = drawn(100, 0.4, 0.5, 'NFL', r);
  const crowd = Array.from({ length: 30 }, (_, i) => { const bets = drawn(60, 0.5, 0.5, 'Soccer', r); return { name: 'c' + i, wallet: '0x' + String(i).padStart(40, '1'), bets, overall: score(bets), medianStake: 50, lastBuyAt: now - day }; });
  const w = { name: 'mix', wallet: '0x' + 'b'.repeat(40), bets: [...good, ...bad], overall: score([...good, ...bad]), medianStake: 500, lastBuyAt: now - day };
  const mix = specialists([...crowd, w], now).specialists.find((s) => s.name === 'mix');
  assert.ok(mix.sports.Soccer); assert.equal(mix.sports.NFL, undefined);
  assert.equal(specialists([...crowd, { ...w, lastBuyAt: now - 40 * day }], now).specialists.some((s) => s.name === 'mix'), false);
  assert.ok(Object.keys(sportRecords([...good, ...bad])).length === 2);
});
test('record since listing uses only bets placed after the listing date, and flags a clearly losing run', () => {
  const r = rng(11), listedAt = now - 30 * day;
  const old = drawn(100, 0.7, 0.5, 'NBA', r, now - 170 * day).map((b) => ({ ...b, boughtAt: listedAt - day }));
  const fresh = Array.from({ length: 30 }, (_, i) => ({ price: 0.5, payout: i < 8 ? 1 : 0, stake: 100, gameAt: now - i * day, boughtAt: listedAt + day, sport: 'NBA' }));
  const s = sinceListed([...old, ...fresh], 'NBA', listedAt);
  assert.equal(s.games, 30); assert.equal(s.wins, 8); assert.equal(s.cold, true);
  assert.equal(sinceListed(old, 'NBA', listedAt).games, 0); assert.equal(sinceListed(fresh.slice(0, 10), 'NBA', listedAt).cold, false);   // too few bets to call
  const kept = specialists([{ name: 'k', wallet: '0x' + 'c'.repeat(40), bets: [], overall: score([]), medianStake: 1, lastBuyAt: now }], now, { 'x|NBA': 5 });
  assert.equal(kept.listed['x|NBA'], 5);                                            // listing dates are never rewritten
});
