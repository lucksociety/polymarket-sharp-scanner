# Validation

Checks performed November 2, 2026:

- `node --test engine.test.js`: 24 tests passed. Covers cursor completeness/repeated cursors, v2 normalization, net hedge exposure, mark-invariant cost shares, recent net flow, de-vigging, independent/stale/future odds, sorted depth consumption, fee curves, missing fee and minimum-size rejection, crossed books, budget-safe fee rounding, distinct-game qualification, largest-win concentration, point-in-time history, linked-wallet opposition, fail-closed missing evidence, stale scans/quotes, price-bucket probability models, strictly pregame closing buckets, failed-history exclusion and forward replay.
- Syntax checked `engine.js`, `history.js`, `edge.js`, `replay.js` and extracted inline application JavaScript with Node 22.
- Live public endpoint smoke checks confirmed v2 positions/leaderboard envelopes and snake_case identifiers, current CLOB market `fd` fee parameters, book response shape, v2 resolution shape and point-in-time historical price data.
- In-app browser live scan of the 18 core wallets completed with 938 open positions and no console errors. With permissive display filters, it found 310 upcoming unique outcome candidates; strict default display thresholds legitimately returned no upcoming candidates at that scan.
- A live historical run with a 30-page-per-wallet budget read 76,498 trade rows from completed wallet cohorts and generated 385 usable modeled observations. Six wallets exceeded that budget and were explicitly excluded. 64 observations lacked an eligible strictly pregame closing price. Failed/truncated cohorts were not partially qualified. The released UI defaults to a configurable 100-page budget, with a stop control; full 100-page live backfill across the roster was not repeated.
- Isolated browser fixtures (not included in the deployed app) exercised a qualified model candidate with two qualified supporters, current quotes, a frozen paper entry, final-payout settlement and closing CLV. A synthetic $100 entry at 0.5125 all-in settled to $95.12 profit. This is test data, not evidence of strategy profitability.
- The exported synthetic browser journal replayed with zero eligibility mismatches. History cancellation retained all 385 prior saved observations.
- Mobile preview identified and fixed sticky controls covering buttons. Mobile controls now scroll with the page. The isolated flow completed without browser console errors.

Limitations: no independent sportsbook feed is bundled; default probability estimates use the documented observational Polymarket model. Fine historical price retention and high-volume history ceilings can exclude large portions of a wallet's record. History uses an explicit fee scenario and trader-entry prices, not actual historical copier fills or account-level after-cost profits. Current-roster survivor bias, unknown linked wallets, correlated games and nonstationarity remain. Forward profitability has not been established.

## Brand design follow-up

- Reused the supplied Luck Society artwork for both the clover coin and cropped nighttime city banner. Added emerald/black/gold panels, serif brand typography, dashboard navigation, clearer metrics, responsive filter layouts and a branded empty state.
- Moved advanced settings and methodology into native disclosures while retaining their existing event handlers. The probability-source badge updates with the selected mode.
- Checked desktop at 1440px and mobile at 390px. Mobile document width equaled the viewport, with no horizontal overflow. Confirmed artwork references loaded, navigation/disclosures worked and the browser recorded no console errors.
- Re-ran all 24 calculation tests and JavaScript syntax checks. A separate synthetic UI fixture still produced a qualified candidate, refreshed execution quotes and saved a paper entry after the design change.
