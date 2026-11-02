# ☘ Luck Society · Sharp Money Scanner

Live open-position scanner for Polymarket's most profitable sports & esports traders.

Hit **SCAN** and the page pulls every open bet from the tracked roster straight from Polymarket's public API — no server, no keys.

## What it shows
- **By day:** Live Now → Today → Tomorrow → each day this week → Later → Futures & Season-Long, each collapsible
- **Conviction:** every bet's value as a % of that trader's open book — 🔥 Max (10%+), High (4–10%), Med (1–4%), Low (<1%). Accounts under $25K are capped at Med.
- **Biggest Conviction Plays:** the 8 upcoming-game bets that are the largest share of a trader's book
- **Sharp Consensus:** markets where 2+ tracked traders are on the same side
- **Hedge filter:** hides bets where a trader holds both sides of a market (usually market-making)
- **Sport tabs:** NFL, NBA, NHL, MLB, UFC, Soccer, Tennis, League of Legends, other sports
- **By trader** view, minimum conviction / bet size filters, search
- **+ This month's hot hands:** also scans the current top 25 Sports and top 10 Esports traders on Polymarket's monthly leaderboard

## Editing the roster
Open `index.html` and edit the `CORE` list near the top of the `<script>`:

```js
{ name:"BreakTheBank", wallet:"0xf0318c32136c2db7fec88b84869aee6a1106c80c", spec:"NFL · NBA" },
```

`wallet` is the trader's Polymarket proxy wallet (the address in their profile URL, `polymarket.com/profile/0x…`).

## Data sources
- Positions: `data-api.polymarket.com/positions`
- Leaderboard: `data-api.polymarket.com/v1/leaderboard`
- Sport tagging: `gamma-api.polymarket.com/events`

Not betting advice. Big P&L can come from market-making or a single lucky hit — do your own homework.
