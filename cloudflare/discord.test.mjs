import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyDiscord,handle,report,register,editReply,APPLICATION_ID} from './discord.mjs';
import {validateOptions,compact,DEFAULTS,rankUnique,command} from './scanner.mjs';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const key=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
const make=(value,time=Math.floor(Date.now()/1000))=>{const body=JSON.stringify(value),timestamp=String(time);return new Request('https://test.example/interactions',{method:'POST',headers:{'x-signature-timestamp':timestamp,'x-signature-ed25519':sign(null,Buffer.from(timestamp+body),privateKey).toString('hex')},body});};
const input=()=>({type:2,application_id:APPLICATION_ID,id:'1566896795152416999',guild_id:'1566896795152416998',token:'SYNTHETIC-INTERACTION-TOKEN',data:{name:'polysharp',options:[]}});
test('signature authenticates exact raw bytes and rejects expiry and malformed signatures',async()=>{const r=make(input());const b=await r.text();assert.equal(await verifyDiscord(r,b,key),true);assert.equal(await verifyDiscord(r,b+' ',key),false);const old=make(input(),Math.floor(Date.now()/1000)-301);assert.equal(await verifyDiscord(old,await old.text(),key),false);assert.equal(await verifyDiscord(new Request('https://example.com'),b,key),false);});
test('Discord ping responds without background bindings',async()=>{assert.deepEqual(await (await handle(make({type:1}),{DISCORD_PUBLIC_KEY:key})).json(),{type:1});});
test('untrusted requests never queue scans',async()=>{let calls=0;const r=new Request('https://test.example/interactions',{method:'POST',body:JSON.stringify(input())});const response=await handle(r,{DISCORD_PUBLIC_KEY:key,SCANS:{create(){calls++;}}});assert.equal(response.status,401);assert.equal(calls,0);});
test('valid slash command immediately defers publicly and queues one job with options',async()=>{let queued;const response=await handle(make(input()),{DISCORD_PUBLIC_KEY:key,CACHE:{},SCANS:{async create(value){queued=value;}}});assert.deepEqual(await response.json(),{type:5});assert.equal(queued.params.options.limit,10);assert.equal(queued.params.applicationId,APPLICATION_ID);assert.equal(queued.params.token,'SYNTHETIC-INTERACTION-TOKEN');});
test('commands in unauthorized guilds, wrong applications and DMs are rejected',async()=>{let calls=0;const env={DISCORD_PUBLIC_KEY:key,ALLOWED_GUILD_IDS:'123456789012345678',CACHE:{},SCANS:{create(){calls++;}}};assert.equal((await (await handle(make(input()),env)).json()).data.flags,64);const wrong=input();wrong.application_id='999999999999999999';assert.equal((await handle(make(wrong),env)).status,403);const dm=input();delete dm.guild_id;assert.equal((await (await handle(make(dm),env)).json()).data.flags,64);assert.equal(calls,0);});
test('one server-minute workflow ID coalesces duplicate scans without extra channel posts',async()=>{const r=await handle(make(input()),{DISCORD_PUBLIC_KEY:key,CACHE:{},SCANS:{async create(){throw Error('exists');},async get(){return {async status(){return {status:'running'};}};}}});const body=await r.json();assert.equal(body.type,4);assert.equal(body.data.flags,64);assert.match(body.data.content,/minute/);});
test('missing bindings report setup state instead of pretending scan ran',async()=>{const r=await handle(make(input()),{DISCORD_PUBLIC_KEY:key});assert.match((await r.json()).data.content,/not ready/);});
test('option validation enforces declared Discord ranges and percent conversions',()=>{const o=validateOptions([{name:'sport',type:3,value:'NBA'},{name:'min_edge',type:10,value:3},{name:'min_win',type:10,value:60},{name:'budget',type:10,value:250}]);assert.equal(o.settings.minEdge,.03);assert.equal(o.settings.minWin,.6);assert.equal(o.settings.budget,250);assert.throws(()=>validateOptions([{name:'limit',type:4,value:6}]));assert.throws(()=>validateOptions([{name:'sport',type:3,value:'anything'}]));assert.throws(()=>validateOptions([{name:'budget',type:10,value:Infinity}]));assert.throws(()=>validateOptions([{name:'min_edge',type:10,value:-1}]));});
test('API compaction preserves cursor, timestamps and all fields needed for exposure/freshness',()=>{const r=compact('https://data-api.polymarket.com/v2/activity',{data:[{side:'BUY',timestamp:123,size:100,token_id:'42',profile_image:'irrelevant'}],pagination:{next_cursor:'opaque'}});assert.equal(r.pagination.next_cursor,'opaque');assert.equal(r.data[0].timestamp,123);assert.equal(r.data[0].profile_image,undefined);});
const options={sport:'NBA',limit:5,settings:{...DEFAULTS}};
const bet=(n=0)=>({eligible:true,roi:.2,edge:.04,p:{asset:String(n),conditionId:String(n),outcomeIndex:0,title:'Test game '+n,outcome:'Yes',sport:'NBA',eventSlug:'test-game',trader:'Trader',game:Date.now()+3600000},ex:{allIn:.5},b:{fair:.6,low:.54,games:150},cons:{qualified:3,opposingQualified:0},quoteAt:Date.now()});
test('report separates incomplete scans, empty qualified results and history warmup',()=>{const empty=report({options,historyPending:12});assert.match(empty.embeds[0].description,/No bets passed/);assert.match(empty.embeds[0].fields[0].value,/building/);assert.equal(empty.embeds.length,1);const incomplete=report({options,complete:false,bets:[bet()]});assert.match(incomplete.embeds[0].description,/incomplete/);assert.equal(incomplete.embeds.length,1);});
test('reports contain executable entry, edge, win estimate and opposition without mentioning users',()=>{const value=report({options,bets:[bet()]});assert.match(value.embeds[1].description,/50.00/);assert.match(value.embeds[1].description,/4.00/);assert.match(value.embeds[1].description,/60.0%/);assert.deepEqual(value.allowed_mentions,{parse:[]});});
test('Discord aggregate embed length stays below 6000 with long malicious market text',()=>{const bets=Array.from({length:5},(_,i)=>({...bet(i),p:{...bet(i).p,title:'@everyone **'.repeat(200),outcome:'@everyone **'.repeat(200),trader:'@everyone **'.repeat(200)}}));const r=report({options,bets,warnings:['@everyone **'.repeat(200)]});const size=r.embeds.reduce((n,e)=>n+(e.title?.length||0)+(e.description?.length||0)+(e.footer?.text?.length||0)+(e.fields||[]).reduce((s,f)=>s+f.name.length+f.value.length,0),0);assert.ok(size<6000);assert.deepEqual(r.allowed_mentions,{parse:[]});});
test('ranking never promotes rejected candidates or counts same outcome twice',()=>{const a=bet(),b={...a,roi:.3},bad={...bet(2),eligible:false,roi:10};assert.equal(rankUnique([a,b,bad]).length,1);assert.equal(rankUnique([a,b,bad])[0].roi,.3);});
test('command registration upserts only polysharp and preserves other application commands',async()=>{let request;const result=await register('SYNTHETIC',async(url,options)=>{request={url,...options};return Response.json({id:'123',name:'polysharp',application_id:APPLICATION_ID});});assert.equal(request.method,'POST');assert.equal(JSON.parse(request.body).name,'polysharp');assert.equal(result.name,'polysharp');assert.equal(command.contexts[0],0);});
test('interaction replies edit the deferred message, never post an unrelated channel message',async()=>{let url;await editReply({applicationId:APPLICATION_ID,token:'SYNTHETIC'},report({options}),async(u,o)=>{url=u;assert.equal(o.method,'PATCH');return new Response(null,{status:204});});assert.match(url,/webhooks\/.*\/messages\/@original$/);});

test('default slash command uses dashboard conviction and explicit edge options remain opt-in',()=>{
 assert.equal(validateOptions([]).ranking,'conviction');assert.equal(validateOptions([{name:'sport',type:3,value:'NBA'}]).ranking,'conviction');assert.equal(validateOptions([{name:'min_edge',type:10,value:2}]).ranking,'edge');
});
test('conviction reports show observed bets without requiring modeled qualification and label partial scans',async()=>{
 const {convictionReport}=await import('./discord.mjs');const p={...bet().p,wallet:'w',conv:.25,costBook:100000,remainingCost:25000,currentValue:30000,curPrice:.6,netShares:50000};
 const r=convictionReport({plays:Array(10).fill(p),positions:[p],options:{...options,limit:10},rosterCount:2,scannedWallets:1,complete:false});assert.equal(r.embeds.length,1);assert.equal(r.embeds[0].fields.length,11);assert.match(r.embeds[0].fields[10].name,/^10\./);assert.match(r.content,/https:\/\/lucksociety\.github\.io\/polymarket-sharp-scanner\//);assert.match(r.embeds[0].description,/Partial scan/);assert.match(r.embeds[0].fields[1].value,/25.0%/);assert.match(r.embeds[0].fields[1].value,/MAX conviction/);assert.match(r.embeds[0].fields[1].value,/Price: 60\.0¢/);assert.match(r.embeds[0].fields[0].value,/not a verified edge/);assert.deepEqual(r.allowed_mentions,{parse:[]});
});

const HOOK='https://discord.com/api/webhooks/123456789012345678/SYNTHETIC_webhook-token';
const dash=(method='POST',origin='https://lucksociety.github.io')=>new Request('https://test.example/scan',{method,headers:origin?{Origin:origin}:{}});
test('dashboard /scan only accepts the dashboard origin and requires a configured webhook',async()=>{
 let calls=0;const env={DASHBOARD_WEBHOOK_URL:HOOK,CACHE:{},SCANS:{async create(){calls++;}}};
 assert.equal((await handle(dash('POST','https://evil.example'),env)).status,403);
 assert.equal((await handle(dash('POST',null),env)).status,403);
 assert.equal((await handle(dash(),{...env,DASHBOARD_WEBHOOK_URL:'https://example.com/hook'})).status,503);
 assert.equal((await handle(dash('GET'),env)).status,405);
 const pre=await handle(dash('OPTIONS'),env);assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),'https://lucksociety.github.io');
 assert.equal(calls,0);
});
test('dashboard /scan queues one default conviction scan per 3-minute window',async()=>{
 let queued;const env={DASHBOARD_WEBHOOK_URL:HOOK,CACHE:{},SCANS:{async create(v){queued=v;}}};
 const r=await handle(dash(),env);assert.equal(r.status,202);assert.equal(r.headers.get('access-control-allow-origin'),'https://lucksociety.github.io');
 assert.match(queued.id,/^dash-\d+$/);assert.equal(queued.params.source,'dashboard');assert.equal(queued.params.webhook,HOOK);assert.equal(queued.params.options.ranking,'conviction');assert.equal(queued.params.options.limit,10);assert.equal(queued.params.token,undefined);
 const busy=await handle(dash(),{...env,SCANS:{async create(){throw Error('exists');}}});assert.equal(busy.status,429);const b=await busy.json();assert.ok(b.cooldown>0&&b.cooldown<=180);
});
test('dashboard-triggered results post one new webhook message without mentions',async()=>{
 let req;await editReply({source:'dashboard',webhook:HOOK},report({options}),async(u,o)=>{req={u,...o};return new Response(null,{status:200});});
 assert.equal(req.method,'POST');assert.equal(req.u,HOOK+'?wait=true');const body=JSON.parse(req.body);assert.deepEqual(body.allowed_mentions,{parse:[]});assert.match(body.content,/dashboard/);
 await assert.rejects(editReply({source:'dashboard',webhook:HOOK},report({options}),async()=>new Response(null,{status:404})),/webhook HTTP 404/);
});
