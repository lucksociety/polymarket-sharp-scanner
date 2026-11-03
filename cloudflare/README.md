# /polysharp on Cloudflare

This is the always-on Discord command for the Luck Society scanner. The HTTP Worker verifies Discord's Ed25519 signatures, acknowledges commands immediately, then uses a durable Cloudflare Workflow to collect public Polymarket positions, recent trades, game metadata and executable quotes. The Workflow edits the original deferred Discord response in the invoking channel. It never places bets.

## Command

`/polysharp [sport] [limit] [budget] [min_edge] [min_win]`

By default the command returns the dashboard’s highest-conviction upcoming game cards, sorted by net directional entry cost divided by total open entry cost. It uses the same `SharpEngine.topConviction` function as the dashboard: one card per bettor and market, a $25,000 minimum open cost book, positive unmatched exposure, $1,000 position floor and 4% minimum open cost share. `sport` filters sports and `limit` explicitly chooses 1–5 cards. With no `limit`, the conviction reply shows up to 10 plays and links to the dashboard. The optional edge mode defaults to 3 picks. Different bettors on the same outcome remain separate cards, matching the dashboard.

The cards show the bettor, conviction percentage/tier, net entry cost, indicative market-price snapshot, supporting/opposing wallet counts and start time. A concentration ranking does not require historical edge qualification. Price snapshots are not executable-fill promises, and conviction is not a win probability. Partial scans explicitly rank only the loaded wallets instead of presenting them as the full roster.

Supplying `min_edge` or `min_win` explicitly opts into the stricter modeled-edge shortlist. `min_edge` is cents per share and `min_win` is a percentage; `budget` controls its fee/depth calculation. That optional path requires current quotes, two qualified supporters, zero qualified opponents, 100 prior games spanning 90 days, recent net buying and conservative modeled edge. Missing or incomplete evidence cannot produce a qualifying pick. It uses independent history jobs and cached bounded continuation; default conviction scans neither wait for nor launch historical backfills. The roster includes the dashboard’s 18 core wallets plus current monthly discovery wallets. The command requires no message-content intent or Gateway connection.

Only the edge path reprices candidates and requires a quote at most 30 seconds old. Historical observations remain an assumed-fee hold model, not verified copier profitability. Fine historical price retention, history page ceilings and survivor bias can limit coverage. Prior complete history is retained on failure, refreshed after 24 hours and excluded after 48 hours.

## Resources

- Worker: `polysharp`
- Workflow: `polysharp-jobs`, class `PolysharpWorkflow`, binding `SCANS`
- Workers KV namespace: `CACHE`, binding `CACHE`
- Endpoint: `https://polysharp.dreiss324.workers.dev/interactions`
- Health: `https://polysharp.dreiss324.workers.dev/health`
- Public application ID and verification key are in `discord.mjs` and `wrangler.jsonc`.
- `ALLOWED_GUILD_IDS` currently limits use to Luck Society (`780172495268610059`); change it to enable other servers.
- Optional `HISTORY_MAX_PAGES` adjusts the default complete-history pagination ceiling (1–100).

The Worker needs no Discord bot token during normal operation. Discord sends a short-lived interaction response token in each signed request; the Workflow uses it only to edit that command's response. The response token is held in private Workflow state and is never logged or stored in public KV. Worker logging is disabled in the source configuration.

## Register and install

Set `DISCORD_BOT_TOKEN` in a local process environment and run `npm run register`; this performs a single-command POST upsert and preserves any other application commands. The token is never embedded in source or generated bundles. Rotate tokens disclosed in chat. Do not commit tokens, `.env`, `.dev.vars`, Wrangler credentials or local state.

Install the application to the intended Discord server with `applications.commands` (and optionally `bot`) scopes. Configure the Discord application's Interactions Endpoint URL to the URL above. Discord validates it using a signed PING, and the Worker must return the PONG before commands can be received. The app's public key must match the configured key.

An example install URL for the supplied application is:

https://discord.com/oauth2/authorize?client_id=1566896795152416808&scope=applications.commands&integration_type=0

A command that is already requested within the same server-minute is coalesced by a unique Workflow instance ID; later requests receive a private cooldown message. No unrelated channel messages or unsolicited mentions are sent. The command is public only in the channel where the user invokes it.

## Development and deployment

`npm ci` installs the pinned Wrangler tooling. `npm test` runs signature, command, report, API-compaction and response tests. `npm run dev` runs the Worker locally; the root calculation suite remains `node --test ../engine.test.js`. The deployed KV namespace ID is recorded in `wrangler.jsonc`. Deploy with `npm run deploy` using your authorized Cloudflare account.

The implementation runs on Workers Free without upgrading the account. Wallet and quote jobs are dispatched with Workflow batch creation, staggered to reduce API throttling, and return bounded results through private KV. Large wallets and historical backfills cache API pages privately and continue in a new bounded job after 20 requests, so high-volume traders are not silently truncated. Quote children have a 40-request ceiling. The parent has separate 25-query metadata and 20-query final-price budgets. Public data calls retry with backoff; oversized, failed or truncated data blocks qualification. History jobs are delayed twelve minutes behind foreground work and retain prior complete evidence on failure. KV propagation and public API throttling can add several minutes. Scan jobs have a ten-minute response deadline. Platform quotas can still stop a run; such failures produce no fallback recommendations.

The roster and classifier in `roster.mjs` are copied from the dashboard configuration. Keep them synchronized when changing the dashboard's core roster. All pricing, quality, consensus and history calculations import the same root `engine.js` and `history.js` used by the dashboard.
