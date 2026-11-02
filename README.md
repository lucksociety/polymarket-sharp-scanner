# Luck Society · Sharp Money Scanner

Static, read-only Polymarket sports scanner with executable-price screening and a forward paper journal. No keys, wallet connection, order submission, paid odds service, server or build step is required.

## Use

1. Open the site. Click **SCAN** to fetch open positions, the optional monthly discovery roster, and the last 24 hours of trade activity.
2. Click **Build Polymarket history (180 days)** once to collect prior trade observations, resolved payouts, and strictly pregame historical prices. Rebuild periodically and when changing the roster. Progress and incomplete coverage are shown. The default budget is 100 pages of 1,000 trades per wallet and is adjustable up to 1,000 pages. Wallets exceeding the selected budget are excluded, not partially analyzed; increase the budget to inspect them. Stop retains previously saved history after active requests finish.
3. Select a sport and display filters. Defaults are $1,000 position value and 4% of unmatched open entry cost. These are hypotheses, not optimized profitable thresholds; a strict screen can legitimately return no candidates.
4. Click **Refresh quotes**, or refresh a particular candidate. The app walks the actual ask ladder for the configured cash budget, includes this market's taker-fee curve, checks minimum order size, and rejects partial fills. Quotes expire after 30 seconds; scans expire after 5 minutes. Batch refresh covers the first 60 candidates; filters and per-card refresh let you inspect others.
5. Use **Qualified shortlist only**, or inspect every candidate's exclusion reasons. Log research or qualified **paper entries** at current quotes; export the journal regularly. Click **Check official resolutions** after games to calculate realized paper P&L and capture available pregame closing marks.

`SCAN`, history building, quote refresh and resolution checks are separate explicit actions. There is no unattended polling of wallets, automatic betting or push alert service. A 10-second local display refresh invalidates stale quotes without making network requests.

## What the filters measure

**Open cost share:** unmatched remaining entry cost / total entry cost of all fetched open holdings. Complementary shares in the same wallet are paired before calculating directional exposure; partial hedges keep their residual. Unlike mark-value concentration, this measure does not mechanically grow as the share price rises. It still excludes idle cash, other wallets, other platforms and unknown external hedges. Missing cost data prevents verified directional support. Tier labels are capped at Medium below $25,000 of open entry cost.

**Consensus:** calculated from the full scan before sport, amount, concentration or search display filters. Support and opposition are visible separately. Only qualified sport-specific records contribute weight, each capped at one unit and at 10% cost concentration. Optional related-wallet groups collapse into one contributor per side; a group on both sides cannot count as independent support. Unknown linked accounts remain an observational limitation. Failed scans are marked incomplete and cannot qualify a candidate.

**Fresh flow:** positive BUY minus SELL shares for the actual token in the configured window (default two hours), not a recent position timestamp or an old holding. Unavailable or incomplete activity does not count as fresh buying.

**Trader quality:** default 100 separate prior games over at least 90 days, positive modeled/imported after-cost ROI, positive stake-weighted CLV, and positive profit after removing the largest winning game. Multiple entries on one event do not inflate game counts. All qualifying results must be settled before the evaluation time. Imported sources are user assertions, not independently audited records.

## Polymarket-only probability model (default)

The history builder reads complete 180-day TRADE windows for each current tracked wallet. It takes the earliest observed pregame BUY per token/condition in that window, excludes wallets buying both outcomes of that condition, matches the market-specific game start via Gamma, and requires a final v2 payout of 0 or 1. Non-game futures and in-play entries are excluded. It requires a historical price observation within 15 minutes before kickoff whose entire aggregation bucket ended before kickoff. Missing, future, coarsely overlapping or unavailable observations are excluded and reported.

Each observation models a **fixed $100 purchase at the trader's observed price, held to resolution**. Its fee is an explicit scenario assumption: `rate × p × (1-p)` per share, default rate 0.05. This is not a claim about historical fees paid, actual wallet P&L, or a delayed copier's obtainable fill. It ignores actual exits and must not be presented as a copy-trading backtest. A price-history mark is a CLV proxy, not an executable closing ask.

For each candidate the probability model uses only that representative wallet's prior resolved games in the same sport with entry cost within ±10 cents of today's executable all-in price. It requires the configured minimum distinct games in this bucket. The fair estimate is the historical win fraction; the conservative estimate is its 95% Wilson lower bound minus the configured buffer (default two percentage points). Qualification uses the conservative estimate. This confidence interval assumes independent Bernoulli trials and does not eliminate correlated games, nonstationarity, roster survivor bias or selection bias. It is deliberately labeled **Model candidate**, never independent market mispricing or a guaranteed edge.

The app evaluates alternative representatives for each outcome, preserving the best eligible assessment rather than allowing a stale large holder to hide a fresh qualified one. This selection can itself introduce optimism; only later forward paper results can validate the policy.

## Optional independent odds / imported records

Use the expandable evidence panel to import JSON, paste JSON, or fetch an HTTPS public JSON feed with browser CORS enabled. Import **replaces** the dataset. Existing data, the journal and the last feed URL live in browser local storage; changing devices does not sync them. No secret API keys should be placed in a public feed URL.

```json
{
  "version": 1,
  "odds": [
    {
      "conditionId": "0xREPLACE_WITH_64_HEX_DIGITS",
      "source": "Sportsbook A",
      "asOf": "2026-11-02T20:00:00Z",
      "outcomes": ["Yes", "No"],
      "decimalOdds": [1.80, 2.10],
      "rules": "Exact market line; include overtime; draw and void rules match",
      "rulesConfirmed": true
    }
  ],
  "history": [
    {
      "wallet": "0xREPLACE_WITH_40_HEX_DIGITS",
      "sport": "NBA",
      "eventId": "unique-game-id",
      "source": "Complete independently reconciled trade ledger",
      "entryAt": "2026-06-01T19:00:00Z",
      "settledAt": "2026-06-02T02:00:00Z",
      "stake": 100,
      "pnlNet": -100,
      "entryAllIn": 0.55,
      "closingProbability": 0.57,
      "costsIncluded": true
    }
  ],
  "clusters": {}
}
```

Replace placeholders with real identifiers; do not import this illustrative row as evidence. At least two distinct independent source labels per condition are required. Include every mutually exclusive outcome for each source, with names matching the Polymarket outcome labels. For a binary "team wins" contract, convert a three-way sportsbook market to the corresponding win/not-win pair before importing, and verify draw rules. The app cannot independently verify your mapping, source independence or completeness.

Each source's raw implied probabilities `1 / decimalOdds` are normalized by their sum to remove proportional vig. The fair estimate is the median of source probabilities; the conservative estimate is the minimum source probability minus the buffer. Quotes older than 15 minutes, future observations, missing outcome matches and unconfirmed rules are excluded. Adding repeated snapshots or changing source capitalization cannot increase the source count.

Historical `pnlNet` must include all actual costs, and all losses must be present. `entryAllIn` is cost per share; `closingProbability` is the corresponding same-outcome closing benchmark. CLV is closing probability minus entry cost. Add `"0xwallet": "related-team"` to `clusters` to group known related accounts. Imported evidence never proves identity independence by itself.

## Execution, edge and ranking

- Fee parameters come from `/clob-markets/{condition_id}` (`fd.r`, `fd.e`); no missing value is treated as zero. Per-share fee is `rate × [p × (1-p)]^exponent`. Fee amounts are rounded conservatively upward at five decimal places. No rebates are assumed.
- Asks are sorted from cheapest to most expensive. The configured budget includes fees. The app computes full-size average cost, fees, slippage, worst consumed ask and bid/ask spread. Empty, crossed or identity-mismatched books fail closed.
- `edge per share = conservative probability − executable all-in cost`.
- `expected return on cost = edge / all-in cost`. Rank eligible candidates by this estimate.
- Defaults: 2 cents minimum net edge, 2 qualified supporters, no qualified opponents, 3-cent maximum spread, upcoming games only. Minimum estimated win probability is a separate control; a high chance of winning does not imply positive expected value.

## Paper journal and honest validation

Every paper snapshot freezes its observation time, roster, settings, qualified/research label, raw quote/fees, assessment and entire evidence dataset. It models a taker fill at the observed ladder; it does not claim an order was placed or filled. The journal is limited to 1,000 entries, with the most recent 100 displayed. Export includes all entries. Duplicate outcomes within one scan are rejected; repeat scans and correlated same-game bets remain separate experiments and must not be counted as independent evidence.

Final payouts come from `/v2/resolutions`, including fractional payouts. Missing finality stays pending. Closing CLV comes from a strictly pregame historical observation, or an available independently imported pregame benchmark. Results show overall and qualified-only ROI separately.

Run `node replay.js exported-journal.json` to reproduce the eligibility/ROI calculations from each frozen detection snapshot. Replay does not optimize thresholds, fill missing historical order books, prove out-of-sample profitability, or remove current-roster survivor bias. Real validation must use later forward observations, prices available at detection, and separate games. Export before clearing browser storage. No profitable strategy is asserted.

## APIs and development

Data API v2 envelope, snake_case fields, cursor pagination and explicit error states replace legacy routes. All request windows/filters are repeated when paging; repeated cursors and truncated history walks fail closed. Gamma supplies event/market metadata; CLOB supplies current book depth and fees. Public endpoints may be rate-limited or blocked by browser/network policy, in which case the app reports incomplete data.

```sh
python3 -m http.server 8765
node --test engine.test.js
node replay.js exported-journal.json
```

The existing visual style, roster editing in `index.html` and GitHub Pages deployment are retained. Runtime files: `index.html`, `engine.js`, `history.js`, `edge.js`, `dashboard.css` and `assets/luck-society-reference.png`. The supplied Luck Society reference artwork provides the actual clover coin and city header, displayed through cropped SVG viewports without the social-profile footer. The dashboard uses an emerald, black and gold palette, responsive controls, native disclosures for advanced settings/methodology, visible keyboard focus and reduced-motion support. There are no third-party JavaScript dependencies. See `VALIDATION.md` for checks performed on this change.

## Discord /polysharp

The Cloudflare-backed command is installed in Luck Society. `/polysharp` runs a fresh scan and posts qualifying model candidates in the invoking channel. Optional arguments: `sport`, `limit` (1–5), `budget`, `min_edge` (cents/share) and `min_win` (percentage). It reports missing history or incomplete scans instead of promoting fallback picks. See [the Cloudflare command documentation](cloudflare/README.md) for deployment, cache coverage, limits and tests. The production command runs independently of GitHub Pages and does not require a bot token during normal operation.
