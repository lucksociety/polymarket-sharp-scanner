# Sports scanner: candidates and watched positions

The default `/polysharp` scan uses all 75 roster wallets. It produces two separate sections:

- **Qualified model candidates · paper testing:** only entries passing the history, current-price, buying and exposure gates. There can be zero candidates. This is not a claim of demonstrated forward profitability.
- **Watched positions · not recommendations:** a maximum of one position per game, ranked by concentration in the wallet's remaining open entry cost. A large percentage alone cannot qualify a bet.

Both sections show prices and link the dashboard. The existing command options remain compatible; default output is up to ten games rather than a forced list of ten recommendations. The updated registration definition also permits an explicit limit from 1 to 10; existing Discord registrations may retain their old 1–5 option range until re-registered. The default of ten does not depend on re-registration.

## Qualification policy `sport-price-v1`

Existing sport-specific historical requirements remain: at least 100 prior games over at least 90 days, positive modeled fixed-stake P&L and average closing-price advantage, and profit remaining after removing the largest winning game. The Polymarket-only probability model additionally requires 100 prior games within 10 cents of the executable price and subtracts a Wilson uncertainty margin and buffer. These are observational historical estimates, not independently verified fair odds.

Additional default gates:

- At least 20 settled observations in the same sport within the preceding 30 days, with positive recent P&L.
- Positive net buying within 120 minutes, worth at least the greater of $500 or 5% of the remaining position entry cost. This prevents a tiny top-up from refreshing an old large holding.
- The best available ask cannot be over 2 cents above the latest observed buy price. Liquidity, spread, fee parameters, full stake depth, conservative modeled edge and quote freshness are checked separately.
- At least two materially exposed, historically qualified supporting wallets. Known linked wallets are collapsed; unknown common ownership remains a limitation. Material visible opposition in the same market blocks a candidate, even if that opposing wallet is unverified.
- Complete roster scan; fresh position snapshot; upcoming game; one candidate per game, including alternate markets and `-more-markets` variants.

The full roster remains watched. No wallet is removed solely because of a few losses. The more-markets grouping is a practical correlation control, not a guarantee that every underlying matchup or linked bet is recognized.

## History completeness

Historical first-buy entries are hypothetical $100 holds at observed trader prices with an explicit assumed fee curve. They do not reproduce followers' executable fills, actual wallet P&L, order timing or hedges elsewhere. History now carries a `ready` flag. Missing API cohorts, missing market metadata, failed resolution requests, or selectively missing closing-price records prevent that cohort from qualifying. Old caches are invalidated by the `history-v6` prefix. Only complete caches less than 24 hours old can qualify. Missing histories warm in the background; they do not produce fallback candidates while unavailable.

## Permanent private paper log

Before a result is posted, the Workflow writes an application-level append-only record in its existing private KV binding:

- `signals/v1/YYYY-MM-DD/<run-id>`: exact rendered payload, policy, settings, scan completeness, wallet/sport/market/side, indicative mark, consumed executable order-book levels, fee/depth calculation, qualification or rejection reasons, and references to immutable historical evidence.
- The same key plus `/publication`: delivery receipt, message ID when available, timestamp and whether observation jobs were queued. A prepared record without a receipt is not counted as a published signal.
- `evidence/v1/<wallet>/<built-at>`: immutable historical model inputs used by the qualification step, separate from expiring working caches.
- `closes/v1/<asset>/<scheduled-start-ms>`: a strictly pregame price bucket, where available. Closing is evaluated at the scheduled game time frozen in the signal; reschedules require separate review.
- `settlements/v1/<condition>`: independently observed resolution and outcome payouts. Pending or unavailable results remain unknown; they are not losses.

No interaction token, bot token or channel webhook is saved in the signal record. There is no public journal endpoint. Existing historical Discord posts cannot supply missing executable quotes and are not inserted into the forward paper cohort. Entries, evidence and observations have no expiry; transient scan caches still expire normally.

Closing observations and settlement checks run as background Workflow jobs. Settlement checks retry up to eight days. Retries fetch fresh resolution observations instead of replaying a cached pending response. Missing data remains explicitly unknown. No real orders are placed.

## Read-only audit

A local export can be summarized with:

```sh
node cloudflare/audit.mjs private-journal-export.json
```

For a private remote export, supply `CLOUDFLARE_API_TOKEN` (or `CLOUDFLARE_OAUTH_TOKEN`), `CLOUDFLARE_ACCOUNT_ID` and `POLYSHARP_KV_ID` through the environment, then run:

```sh
node cloudflare/audit.mjs --remote /private/tmp/polysharp-journal.json
```

The command performs reads only. It reports the first published executable observation per policy and game, with candidate and watchlist baselines kept separate. Unpublished, incomplete, stale, retrospective or unpriced observations do not become qualified paper returns. Results include ROI, closing coverage and breakdowns by wallet and sport. Quote-based paper returns are still not actual fills or a guarantee of future profits.

Do not tune a policy on a period and describe performance in that same period as independent validation. Freeze a new policy version when material qualification rules change and evaluate it on later signals. Early small samples should remain inconclusive.
