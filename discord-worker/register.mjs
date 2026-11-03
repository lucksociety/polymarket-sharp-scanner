// Registers the /polysharp slash command on your Discord application (run once).
//   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... node discord-worker/register.mjs
const app = process.env.DISCORD_APPLICATION_ID, token = process.env.DISCORD_BOT_TOKEN;
if (!app || !token) throw new Error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN');
const r = await fetch(`https://discord.com/api/v10/applications/${app}/commands`, {
  method: 'PUT',
  headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify([{ name: 'polysharp', type: 1, description: 'Top 10 conviction bets from the most profitable Polymarket sports wallets' }]),
});
console.log(r.status, await r.text());
