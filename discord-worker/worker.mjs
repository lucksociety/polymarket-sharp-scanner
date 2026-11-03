// Luck Society · PolySharp Discord Worker
//   POST /interactions  Discord slash command /polysharp  -> runs the scan and replies in the channel it was used in
//   POST /scan          SCAN button on the dashboard       -> runs the scan and posts to the PolySharp channel webhook
// Both start .github/workflows/polysharp.yml; the workflow does the scan and the Discord delivery.
const SITE_ORIGIN = 'https://lucksociety.github.io';
const WORKFLOW = 'polysharp.yml';
const COOLDOWN_MS = 3 * 60 * 1000;   // the dashboard can trigger at most one post every 3 minutes

const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const cors = { 'access-control-allow-origin': SITE_ORIGIN, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'vary': 'origin' };

function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, { ...init, headers: {
    authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json',
    'user-agent': 'polysharp-discord', 'x-github-api-version': '2022-11-28', ...(init.headers || {}) } });
}
async function dispatch(env, inputs) {
  const r = await gh(env, `/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: env.GITHUB_REF || 'main', inputs }) });
  if (r.status !== 204) throw new Error(`GitHub dispatch HTTP ${r.status}`);
}
async function encryptRelay(env, interaction) {
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.RELAY_KEY));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const msg = { token: interaction.token, app: env.DISCORD_APPLICATION_ID || interaction.application_id, ts: Date.now() };
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(msg))));
  const bytes = new Uint8Array(iv.length + ct.length); bytes.set(iv); bytes.set(ct, iv.length);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function startFromCommand(env, interaction) {
  try {
    await dispatch(env, { source: 'command', relay: await encryptRelay(env, interaction) });
  } catch (e) {
    await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: `⚠️ Could not start the PolySharp scan: ${e.message}.`, allowed_mentions: { parse: [] } }) });
  }
}
async function verify(request, publicKey) {
  const sig = request.headers.get('X-Signature-Ed25519') || '', ts = request.headers.get('X-Signature-Timestamp') || '';
  const body = await request.text();
  if (!/^[a-f0-9]{128}$/i.test(sig) || !/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300 || !/^[a-f0-9]{64}$/i.test(publicKey || '')) return { ok: false, body };
  try {
    const bytes = hex => Uint8Array.from(hex.match(/../g), v => parseInt(v, 16));
    const key = await crypto.subtle.importKey('raw', bytes(publicKey), 'Ed25519', false, ['verify']);
    return { ok: await crypto.subtle.verify('Ed25519', key, bytes(sig), new TextEncoder().encode(ts + body)), body };
  } catch { return { ok: false, body }; }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const configured = env.GITHUB_TOKEN && env.RELAY_KEY && env.GITHUB_REPO && env.DISCORD_APPLICATION_ID;

    if (pathname === '/scan') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);
      if (request.headers.get('origin') !== SITE_ORIGIN) return json({ error: 'Forbidden' }, 403);
      if (!configured) return json({ error: 'PolySharp relay is not configured' }, 503, cors);
      // cooldown: skip if a dashboard run started in the last few minutes
      const runs = await gh(env, `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`).then(r => r.ok ? r.json() : { workflow_runs: [] }).catch(() => ({ workflow_runs: [] }));
      const last = (runs.workflow_runs || []).map(r => Date.parse(r.created_at)).filter(Number.isFinite).sort((a, b) => b - a)[0] || 0;
      const wait = COOLDOWN_MS - (Date.now() - last);
      if (wait > 0) return json({ ok: false, cooldown: Math.ceil(wait / 1000) }, 429, cors);
      try { await dispatch(env, { source: 'dashboard', relay: '' }); return json({ ok: true }, 202, cors); }
      catch (e) { return json({ ok: false, error: e.message }, 502, cors); }
    }

    if (!['/', '/interactions'].includes(pathname)) return new Response('Not found', { status: 404 });
    if (request.method === 'GET') return json({ service: 'polysharp-discord', transport: 'github-actions', configured: !!configured });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const checked = await verify(request, env.DISCORD_PUBLIC_KEY);
    if (!checked.ok) return new Response('Invalid signature', { status: 401 });
    let it; try { it = JSON.parse(checked.body); } catch { return new Response('Invalid JSON', { status: 400 }); }
    if (it.type === 1) return json({ type: 1 });                              // Discord PING
    if (it.application_id !== env.DISCORD_APPLICATION_ID) return new Response('Wrong application', { status: 401 });
    if (it.type !== 2 || it.data?.name !== 'polysharp') return json({ type: 4, data: { content: 'Unknown command.', flags: 64 } });
    if (!configured) return json({ type: 4, data: { content: 'PolySharp is not configured yet. Please contact the server administrator.', flags: 64 } });
    ctx.waitUntil(startFromCommand(env, it));
    return json({ type: 5 });                                                   // "PolySharp is thinking…" until the workflow replies
  },
};
