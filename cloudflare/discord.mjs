import {command,validateOptions} from './scanner.mjs';
export const APPLICATION_ID='1566896795152416808';
export const PUBLIC_KEY='75bc1b110835a39b8f77a6bb0416124159860b7a2e6e64b61fc74b8b599e3cec';
const encoder=new TextEncoder();
export async function verifyDiscord(request,body,key=PUBLIC_KEY,now=Date.now()){
 const signature=request.headers.get('x-signature-ed25519'),timestamp=request.headers.get('x-signature-timestamp');
 if(!/^[0-9a-f]{128}$/i.test(signature||'')||!/^\d+$/.test(timestamp||'')||Math.abs(now/1000-Number(timestamp))>300||!/^[0-9a-f]{64}$/i.test(key))return false;
 try{const bytes=s=>Uint8Array.from(s.match(/../g),x=>parseInt(x,16));const k=await crypto.subtle.importKey('raw',bytes(key),{name:'Ed25519'},false,['verify']);return await crypto.subtle.verify('Ed25519',k,bytes(signature),encoder.encode(timestamp+body));}catch{return false;}
}
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const ephemeral=content=>json({type:4,data:{content,flags:64,allowed_mentions:{parse:[]}}});
export async function handle(request,env){
 const url=new URL(request.url);
 if(request.method==='GET'&&url.pathname==='/health')return json({ok:true,command:'polysharp',ready:Boolean(env.SCANS&&env.CACHE)});
 if(request.method!=='POST'||url.pathname!=='/interactions')return new Response('Not found',{status:404});
 if(Number(request.headers.get('Content-Length'))>65536)return new Response('Too large',{status:413});
 const body=await request.text();if(encoder.encode(body).length>65536)return new Response('Too large',{status:413});
 if(!await verifyDiscord(request,body,env.DISCORD_PUBLIC_KEY||PUBLIC_KEY))return new Response('Invalid signature',{status:401});
 let interaction;try{interaction=JSON.parse(body);}catch{return new Response('Invalid JSON',{status:400});}
 if(interaction.type===1)return json({type:1});
 if(interaction.application_id!==(env.DISCORD_APPLICATION_ID||APPLICATION_ID))return new Response('Wrong application',{status:403});
 if(interaction.type!==2||interaction.data?.name!=='polysharp')return ephemeral('This endpoint handles /polysharp.');
 if(!/^\d{16,22}$/.test(interaction.id||'')||!interaction.token||!/^\d{16,22}$/.test(interaction.guild_id||''))return ephemeral('Use /polysharp in a server where the app is installed.');
 const allowed=String(env.ALLOWED_GUILD_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);if(allowed.length&&!allowed.includes(interaction.guild_id))return ephemeral('This server is not enabled for /polysharp.');
 let options;try{options=validateOptions(interaction.data.options||[]);}catch{return ephemeral('Invalid options. Use the choices and numeric ranges shown by Discord.');}
 if(!env.SCANS||!env.CACHE)return ephemeral('Polysharp is being configured. The background scanner is not ready yet.');
 const receivedAt=Date.now(),id=`scan-${interaction.guild_id}-${Math.floor(receivedAt/60000)}`;
 try{
  await env.SCANS.create({id,params:{applicationId:interaction.application_id,token:interaction.token,interactionId:interaction.id,guildId:interaction.guild_id,receivedAt,options}});
  // Public deferred response; the workflow edits this same message, without extra channel posts.
  return json({type:5});
 }catch{
  try{const previous=await env.SCANS.get(id);const status=await previous.status();if(status.status)return ephemeral('A scan was already requested in this server during this minute. Please try again in a minute.');}catch{}
  return ephemeral('The background scan could not be queued. Please try again shortly.');
 }
}
const safe=x=>String(x??'').replace(/([\\`*_{}\[\]()<>~|])/g,'\\$1').replace(/@/g,'@\u200b').slice(0,180);
const percent=x=>Number.isFinite(x)?(100*x).toFixed(1)+'%':'unknown';
export function report({bets=[],warnings=[],positionCount=0,rosterCount=0,scannedWallets=rosterCount,candidateCount=0,historyCount=0,historyPending=0,options,complete=true,now=Date.now()}){
 const description=complete?(bets.length?'Qualifying **model candidates**, ranked by conservative expected return after fees.':'**No bets passed the configured filters.** No fallback picks were promoted.'):'**Scan incomplete — no qualifying picks published.** Missing wallet or market data prevents a reliable support/opposition check.';
 const embeds=[{title:'☘ Luck Society · /polysharp',color:0xd4b259,description:description+`\n${positionCount} positions loaded · ${scannedWallets}/${rosterCount} wallets scanned · ${candidateCount} upcoming candidates\nSport: ${safe(options.sport)} · Budget: $${options.settings.budget.toFixed(0)} · Min edge: ${(options.settings.minEdge*100).toFixed(1)}¢ · Min estimated win: ${percent(options.settings.minWin)}`,
  fields:[{name:'History coverage',value:`${historyCount} modeled observations available.${historyPending?' '+historyPending+' wallet histories are building or refreshing in the background.':''}`.slice(0,1000)},{name:'Method',value:'Polymarket-only historical model, not independent sportsbook odds. Historical trader entries use an assumed fee scenario; they do not prove copy-fill profitability. Current quotes include market fees and depth.'}],timestamp:new Date(now).toISOString()}];
 if(complete)for(const [i,a]of bets.slice(0,options.limit).entries()){
  const p=a.p,cl=a.cons;
  embeds.push({title:`${i+1}. ${safe(p.title)}`.slice(0,240),url:'https://polymarket.com/event/'+encodeURIComponent(p.eventSlug),color:0x24844b,
   description:`**${safe(p.outcome)}** · ${safe(p.sport)}\nAll-in entry **${(a.ex.allIn*100).toFixed(2)}¢** · conservative edge **${(a.edge*100).toFixed(2)}¢**\nEstimated win: **${percent(a.b.fair)}**; conservative: **${percent(a.b.low)}**\nModeled return on cost: **${percent(a.roi)}**\nQualified support / opposition: **${cl.qualified} / ${cl.opposingQualified}**\nRepresentative: ${safe(p.trader)} · ${a.b.games} prior games in price bucket\nStarts <t:${Math.floor(p.game/1000)}:f> · Quote <t:${Math.floor(a.quoteAt/1000)}:R>`,footer:{text:'Estimate, not a guaranteed winner. Quotes can change immediately.'}});
 }
 if(warnings.length)embeds[0].fields.push({name:'Data notes',value:warnings.slice(0,5).map(x=>safe(x)).join('\n').slice(0,1000)});
 const size=()=>embeds.reduce((n,e)=>n+(e.title?.length||0)+(e.description?.length||0)+(e.footer?.text?.length||0)+(e.fields||[]).reduce((s,f)=>s+f.name.length+f.value.length,0),0);
 while(size()>5800&&embeds.length>1)embeds.pop();
 return {content:'',embeds,allowed_mentions:{parse:[]}};
}
export async function editReply(job,payload,fetcher=fetch){
 const url=`https://discord.com/api/v10/webhooks/${job.applicationId}/${encodeURIComponent(job.token)}/messages/@original`;
 const r=await fetcher(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 if(!r.ok){await r.body?.cancel();throw Error('Discord response HTTP '+r.status);}await r.body?.cancel();return {delivered:true};
}
export async function register(token,fetcher=fetch){
 const r=await fetcher(`https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`,{method:'POST',headers:{Authorization:'Bot '+token,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(20000)});
 if(!r.ok){await r.body?.cancel();throw Error('Command registration HTTP '+r.status);}const result=await r.json();return {id:result.id,name:result.name,application_id:result.application_id};
}
