# ☘ Luck Society · Sharp Money Scanner

Live open-position scanner for Polymarket's most profitable bettors in **each sport**: NHL, NBA, NFL, MLB, soccer, tennis, UFC and esports.

Hit **SCAN** and the page pulls every open bet from the roster straight from Polymarket's public API, then the **PolySharp relay** posts the top 10 conviction bets to Discord. The same top 10 is available any time with **/polysharp** in Discord.

## What it shows
- **By day:** Live Now → Today → Tomorrow → each day this week → Later → Futures & Season-Long, each collapsible
- **Conviction:** every bet's value as a % of that trader's open book — 🔥 Max (10%+), High (4–10%), Med (1–4%), Low (<1%). Accounts under $25K are capped at Med.
- **Biggest Conviction Plays:** the 8 upcoming-game bets that are the largest share of a trader's book
- **Sharp Consensus:** markets where 2+ tracked traders are on the same side
- **Hedge filter:** hides bets where a trader holds both sides of a market (usually market-making)
- **Sport tabs:** NFL, NBA, NHL, MLB, UFC, Soccer, Tennis, League of Legends, other sports
- **By trader** view, minimum conviction / bet size filters, search
- **+ Hot hands** (off by default): also scans this month's top Sports and Esports leaderboard traders

## The roster (`roster.json`)
Built from settled results, not leaderboard rank. For each sport:
1. Collect every wallet that placed $1K+ bets on that sport's games in the last 120 days.
2. Total each wallet's **settled profit in that sport only** over those 120 days (closed + resolved-unredeemed positions from `/v2/positions`).
3. Keep up to 8 per sport with at least 15 settled bets, a positive return on stake (3%+), a sport-specific profit floor, and activity in the last 3 weeks.

Each trader's `sports` array records the per-sport profit, return, bet count and win rate. The dashboard and the Discord relay both read this file, so edit it in one place.

## PolySharp relay (Discord)
```
Discord /polysharp ──► Cloudflare Worker (discord-worker/) ──► GitHub Actions (polysharp.yml) ──► reply in Discord
Dashboard SCAN     ──► Worker POST /scan (3-min cooldown) ──► GitHub Actions (polysharp.yml) ──► PolySharp channel webhook
```
`scripts/polysharp.mjs` does the scan in Actions with the same rules as the dashboard: open sports bets of $1K+, games live or starting in the next 7 days, no hedges, accounts of $25K+, ranked by % of book.

### One-time setup
1. **Discord app.** In the Discord Developer Portal create an application named PolySharp, add a bot, and invite it to your server (scope `applications.commands`). Copy the Application ID and Public Key into `discord-worker/wrangler.toml`.
2. **Channel webhook.** In the channel that should receive dashboard posts: Edit Channel → Integrations → Webhooks → New Webhook → Copy URL.
3. **GitHub token.** Create a fine-grained token for `lucksociety/polymarket-sharp-scanner` with **Actions: read and write**.
4. **Actions secrets** (repo Settings → Secrets and variables → Actions): `RELAY_KEY` (any long random string) and `DISCORD_WEBHOOK_URL` (from step 2).
5. **Deploy the Worker:** `cd discord-worker && npx wrangler deploy`, then `npx wrangler secret put GITHUB_TOKEN` and `npx wrangler secret put RELAY_KEY` (same value as step 4).
6. **Point Discord at it:** Developer Portal → General Information → Interactions Endpoint URL = `https://polysharp-discord.dreiss324.workers.dev/interactions`.
7. **Register the command:** `DISCORD_APPLICATION_ID=… DISCORD_BOT_TOKEN=… node discord-worker/register.mjs`.

## Data sources
- Positions (open and settled): `data-api.polymarket.com/v2/positions`
- Open book value: `data-api.polymarket.com/v2/value`
- Leaderboard: `data-api.polymarket.com/v2/leaderboard`
- Trades (roster discovery): `data-api.polymarket.com/v2/trades`
- Sport tagging: `gamma-api.polymarket.com/events`

Not betting advice. Big P&L can come from market-making or a single lucky hit — do your own homework.
