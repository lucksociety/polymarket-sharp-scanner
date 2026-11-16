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
