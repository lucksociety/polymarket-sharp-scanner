// Luck Society · PolySharp relay
// Scans every wallet in roster.json, ranks the top 10 conviction bets on upcoming games,
// and delivers them to Discord.
//
//   node scripts/polysharp.mjs scan            -> writes out/top10.json + out/discord.json
//   node scripts/polysharp.mjs decrypt         -> decrypts the /polysharp interaction (RELAY_PAYLOAD, RELAY_KEY)
//   node scripts/polysharp.mjs post            -> posts out/discord.json to the /polysharp reply, or to DISCORD_WEBHOOK_URL
//   node scripts/polysharp.mjs fail            -> tells the /polysharp caller the run failed
//
// Conviction = bet value ÷ the trader's total open book (Polymarket /v2/value). Same rule as the dashboard.
import fs from 'node:fs/promises';
import { scan, discordMessages } from './polysharp-core.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function deliver(messages) {
  const app = process.env.DISCORD_APPLICATION_ID, token = process.env.INTERACTION_TOKEN, hook = process.env.DISCORD_WEBHOOK_URL;
  if (!(app && token) && !hook) throw new Error('No delivery route: need the /polysharp interaction or DISCORD_WEBHOOK_URL');
  for (let i = 0; i < messages.length; i++) {
    const url = app && token ? `https://discord.com/api/v10/webhooks/${app}/${token}${i ? '' : '/messages/@original'}` : hook;
    const method = app && token && !i ? 'PATCH' : 'POST';
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...messages[i], allowed_mentions: { parse: [] } }) });
      if (r.ok) break;
      if (r.status !== 429 || attempt === 3) throw new Error(`Discord delivery HTTP ${r.status}`);
      const j = await r.json().catch(() => ({})); await sleep(Math.min(10000, 1000 * (j.retry_after || 1) + 100));
    }
  }
}

async function decrypt() {
  const raw = Buffer.from(process.env.RELAY_PAYLOAD || '', 'base64url');
  if (!process.env.RELAY_KEY || raw.length < 29) throw new Error('Missing relay configuration');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(process.env.RELAY_KEY));
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt']);
  const msg = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12))));
  if (!Number.isFinite(msg.ts) || Date.now() - msg.ts > 14 * 60000 || msg.ts > Date.now() + 60000) throw new Error('Interaction relay expired');
  if (!/^[A-Za-z0-9_.-]+$/.test(msg.token) || !/^\d+$/.test(msg.app)) throw new Error('Invalid relay context');
  console.log(`::add-mask::${msg.token}`);
  await fs.appendFile(process.env.GITHUB_ENV, `INTERACTION_TOKEN=${msg.token}\nDISCORD_APPLICATION_ID=${msg.app}\n`);
}

const mode = process.argv[2];
if (mode === 'scan') {
  const roster = JSON.parse(await fs.readFile(new URL('../roster.json', import.meta.url), 'utf8'));
  const result = await scan(roster);
  await fs.mkdir('out', { recursive: true });
  await fs.writeFile('out/top10.json', JSON.stringify(result, null, 2));
  await fs.writeFile('out/discord.json', JSON.stringify(discordMessages(result, process.env.SOURCE || 'command')));
  console.log(`Scanned ${result.wallets} wallets (${result.withBets} with open bets, ${result.errors.length} errors); ${result.candidates} qualifying bets.`);
  result.top.forEach((b, i) => console.log(`${i + 1}. ${pct(b.conv)} ${b.trader} ${b.sport} ${b.outcome} @ ${cents(b.price)} — ${b.market}`));
} else if (mode === 'decrypt') {
  await decrypt();
} else if (mode === 'post') {
  await deliver(JSON.parse(await fs.readFile('out/discord.json', 'utf8')));
} else if (mode === 'fail') {
  await deliver([{ content: `⚠️ PolySharp scan failed. See ${process.env.RUN_URL}` }]);
} else if (mode) {
  throw new Error(`Unknown mode ${mode}`);
}
