import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compactWalletPage,pool,validateOptions,rankUnique,assessOne,CORE,roster,collect,postable} from './scanner.mjs';
import E from '../engine.js';
import {convictionReport} from './discord.mjs';
import {scanReport} from './scan-report.mjs';
import {selectWatchlist,freezeRun,putPrepared,journalKey,publicationKey,settlementKey,closeKey} from './journal.mjs';
import * as Scorecard from './scorecard.mjs';
const source=(await readFile(new URL('./worker.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default {fetch:handle,scheduled};','').replace('export class PolysharpWorkflow','class PolysharpWorkflow');
function harness(readPublic,fetchWallet=async()=>({positions:[],activity:[]}),deps={}){
 const values=new Map(),created=[],sleeps=[];
 const env={CACHE:{get:async k=>values.has(k)?values.get(k):null,put:async(k,v)=>values.set(k,JSON.parse(v))},SCANS:{create:async x=>{created.push(x);return{};},createBatch:async x=>{created.push(...x);for(const j of x)if(j.params?.kind==='wallet')values.set('result/'+j.id,{ok:true,value:{positions:[],activity:[]}});return[];}}};
 const step={do:async(_n,options,fn)=>(fn||options)(),sleep:async(n,d)=>{sleeps.push([n,d]);},sleepUntil:async(n,d)=>{sleeps.push([n,d]);}};
 deps={rankUnique,assessOne,scanReport,selectWatchlist,postable,freezeRun,putPrepared,journalKey,publicationKey,settlementKey,closeKey,...Scorecard,...deps};
 const funcs=new Function('WorkflowEntrypoint','readPublic','fetchWallet','compactWalletPage','deps','const {E,roster,collect,pool,convictionReport,editReply,postable,rankUnique,assessOne,scanReport,selectWatchlist,freezeRun,putPrepared,journalKey,publicationKey,settlementKey,closeKey,LATEST,RESULTS,LEDGER,ledgerKey,alertKey,ledgerEntries,appendLedger,firstPerGame,summarize,scorecardPayload}=deps;'+source+';return {historyGet,launchBatch,result,PolysharpWorkflow,observeMarket,finishScan,scorecardJob,scheduled};')(class{},readPublic,fetchWallet,compactWalletPage,deps);
 return{...funcs,env,step,values,created,sleeps};
}
test('history resumes beyond one Free-plan request budget without publishing a truncated cohort',async()=>{
 let requests=0;const h=harness(async()=>{requests++;return{data:[]};}),job={trader:{wallet:'wallet'},asOf:123};
 const first=h.historyGet(h.step,h.env,job);
 for(let i=0;i<20;i++)await first('https://data-api.polymarket.com/v2/activity?page='+i);
 await assert.rejects(first('https://data-api.polymarket.com/v2/activity?page=20'),/Continue history/);
 assert.equal(first.exhausted(),true);assert.equal(first.failed(),false);assert.equal(requests,20);
 const next=h.historyGet(h.step,h.env,job);
 for(let i=0;i<25;i++)await next('https://data-api.polymarket.com/v2/activity?page='+i);
 assert.equal(requests,25);assert.equal(next.exhausted(),false);
});
test('history network errors remain failures and cannot be masked as an exhausted budget',async()=>{
 const h=harness(async()=>{throw Error('HTTP 429');}),get=h.historyGet(h.step,h.env,{trader:{wallet:'wallet'},asOf:123});
 await assert.rejects(get('https://data-api.polymarket.com/v2/activity'),/429/);
 assert.equal(get.failed(),true);assert.equal(get.exhausted(),false);assert.equal(h.values.size,0);
});
test('wallet work uses one batch call and failed child results fail closed',async()=>{
 const h=harness(async()=>({}));await h.launchBatch(h.step,h.env,'launch',[{id:'a'},{id:'b'}]);assert.equal(h.created.length,2);
 h.values.set('result/a',{ok:false});await assert.rejects(h.result(h.step,h.env,'a'),/unavailable/);
 h.values.set('result/b',{ok:true,value:{positions:[1]}});assert.deepEqual(await h.result(h.step,h.env,'b'),{positions:[1]});
});

test('large wallets continue across jobs and publish only the completed result',async()=>{
 let requests=0;
 const h=harness(async()=>{requests++;return{data:[]};},async(_t,get)=>{for(let i=0;i<25;i++)await get('https://data-api.polymarket.com/v2/positions?page='+i);return{positions:[{asset:'one'}],activity:[]};});
 const w=new h.PolysharpWorkflow();w.env=h.env;
 const first=await w.run({instanceId:'original',payload:{kind:'wallet',trader:{wallet:'w'},asOf:123}},h.step);
 assert.equal(first.continuing,true);assert.equal(h.values.has('result/original'),false);assert.equal(h.created.length,1);
 const next=h.created[0];await w.run({instanceId:next.id,payload:next.params},h.step);
 assert.deepEqual(h.values.get('result/original'),{ok:true,value:{positions:[{asset:'one'}],activity:[]}});
 assert.equal(requests,25);
});

test('default Workflow journals watched positions without promoting unverified wallets',async()=>{
 const now=Date.now(),p={wallet:'a',trader:'A',conditionId:'market',outcomeIndex:0,outcome:'Yes',title:'Test game',eventSlug:'test',sport:'NBA',isGame:true,game:now+3600000,netShares:10000,costKnown:true,costBook:100000,conv:.25,remainingCost:25000,currentValue:10000,curPrice:.5};
 const rows=[p,{...p,wallet:'b',trader:'B',conv:.3,remainingCost:30000}],sent=[];
 const h=harness(async()=>{throw Error('Default should not need historical/quote calls');},undefined,{E,pool,convictionReport,roster:async()=>rows.map(p=>({wallet:p.wallet,name:p.trader})),collect:async()=>({positions:rows,candidates:rows,scannedWallets:2,complete:true,warnings:[]}),editReply:async(_job,payload)=>{sent.push(payload);return{delivered:true};}});
 const w=new h.PolysharpWorkflow();w.env=h.env;const result=await w.run({instanceId:'test-scan',payload:{receivedAt:now,options:validateOptions([])}},h.step);
 assert.equal(result.mode,'paper');assert.equal(result.published,0);assert.equal(result.watched,1);assert.ok(h.created.filter(j=>j.params.kind==='wallet').length===2);assert.match(sent.at(-1).embeds[2].fields[0].value,/30.0%/);assert.ok([...h.values.keys()].some(k=>k.startsWith('signals/v1/')));
});

test('dashboard-triggered Workflow sends one paper report and saves its audit receipt',async()=>{
 const now=Date.now(),p={wallet:'a',trader:'A',conditionId:'market',outcomeIndex:0,outcome:'Yes',title:'Test game',eventSlug:'test',sport:'NHL',isGame:true,game:now+3600000,netShares:10000,costKnown:true,costBook:100000,conv:.25,remainingCost:25000,currentValue:10000,curPrice:.5};
 const sent=[];const h=harness(async()=>{throw Error('no public calls expected');},undefined,{E,pool,convictionReport,roster:async()=>[{wallet:'a',name:'A'}],collect:async()=>({positions:[p],candidates:[p],scannedWallets:1,complete:true,warnings:[]}),editReply:async(job,payload)=>{sent.push([job.source,payload]);return{delivered:true};}});
 const w=new h.PolysharpWorkflow();w.env=h.env;const result=await w.run({instanceId:'dash-1',payload:{source:'dashboard',webhook:'https://discord.com/api/webhooks/1/x',receivedAt:now,options:validateOptions([])}},h.step);
 assert.equal(result.mode,'paper');assert.equal(sent.length,1);assert.equal(sent[0][0],'dashboard');assert.match(sent[0][1].embeds[2].title,/not recommendations/);assert.equal(result.receiptSaved,true);
});

test('resolution polling uses fresh durable step names and never treats a pending result as a loss',async()=>{
 let calls=0;const now=Date.now(),h=harness(async()=>{calls++;return{data:[{condition_id:'c',status:calls===1?'pending':'resolved',resolved_at:new Date(now-1000).toISOString(),payouts:[0,1000000]}]};});
 const output=await h.observeMarket({kind:'settlement',conditionId:'c',game:now-4*3600000},h.step,h.env);
 assert.equal(output.settled,true);assert.equal(calls,2);assert.deepEqual(h.values.get('settlements/v1/c').payouts,[0,1000000]);assert.ok(h.sleeps.some(([,d])=>d==='12 hours'));
});
test('closing observation rejects bars extending into or after the scheduled game',async()=>{
 const game=Date.now()-3600000,h=harness(async()=>({data:[{timestamp:game/1000-60,resolution_seconds:120,price:.8},{timestamp:game/1000-180,resolution_seconds:60,price:.55}]}));
 await h.observeMarket({kind:'close',asset:'token',game},h.step,h.env);assert.equal(h.values.get(closeKey('token',game)).point.price,.55);
});
test('paper journal is written before Discord publication and a missing receipt does not overwrite the delivered result',async()=>{
 const now=Date.now(),sent=[],h=harness(async()=>({}));const scan={positions:[],candidates:[],scannedWallets:75,complete:true,warnings:[],asOf:now};
 const deps={E,pool,roster:async()=>[],collect:async()=>scan,editReply:async()=>({delivered:true})};
 // The caller supplies the rendering and journal dependencies; capture the ordering directly.
 const full=harness(async()=>({}),undefined,{...deps,editReply:async()=>{sent.push('send');assert.ok([...full.values.keys()].some(k=>k.startsWith('signals/v1/')));return{delivered:true};}});
 const original=full.env.CACHE.put;full.env.CACHE.put=async(k,v)=>{if(k.endsWith('/publication'))throw Error('receipt store unavailable');return original(k,v);};
 const result=await full.finishScan({step:full.step,env:full.env,job:{receivedAt:now,options:validateOptions([])},runId:'ordered',scan,traders:[],watchlist:[],bets:[],assessments:[],quotes:new Map(),evidenceManifest:[],historyCount:0,historyPending:0,warnings:[]});
 assert.equal(result.receiptSaved,false);assert.deepEqual(sent,['send']);
});
test('default scan queues every wallet in the full production roster and reports its exact completeness',async()=>{
 const now=Date.now(),sent=[],h=harness(async()=>{throw Error('No public metadata needed for empty holdings')},undefined,{E,pool,roster,collect,editReply:async(_job,payload)=>{sent.push(payload);return{delivered:true};}});const w=new h.PolysharpWorkflow();w.env=h.env;
 const output=await w.run({instanceId:'full-roster',payload:{receivedAt:now,options:validateOptions([])}},h.step),jobs=h.created.filter(j=>j.params.kind==='wallet');
 assert.equal(jobs.length,CORE.length);assert.equal(new Set(jobs.map(j=>j.params.trader.wallet)).size,CORE.length);assert.equal(output.wallets,CORE.length);assert.equal(output.complete,true);assert.equal(output.published,0);assert.match(sent.at(-1).embeds[0].description,new RegExp(CORE.length+'/'+CORE.length+' wallets scanned'));
});
test('failed prepared storage prevents publication of the paper report',async()=>{
 const now=Date.now(),sent=[],h=harness(async()=>({}),undefined,{E,pool,roster:async()=>[],collect:async()=>({asOf:now,positions:[],candidates:[],activities:{},scannedWallets:0,complete:true,warnings:[]}),editReply:async(_job,payload)=>{sent.push(payload);return{delivered:true};}});h.env.CACHE.put=async()=>{throw Error('Storage unavailable')};const w=new h.PolysharpWorkflow();w.env=h.env;const output=await w.run({instanceId:'no-store',payload:{source:'dashboard',receivedAt:now,options:validateOptions([])}},h.step);assert.equal(output.incomplete,true);assert.equal(sent.length,1);assert.equal(sent[0].embeds.length,0);
});
test('administrator verification runs the full scan path without sending any Discord message or scheduling paper outcomes',async()=>{
 const now=Date.now(),sent=[],h=harness(async()=>({}),undefined,{E,pool,roster:async()=>[],collect:async()=>({asOf:now,positions:[],candidates:[],scannedWallets:0,complete:true,warnings:[]}),editReply:async()=>{sent.push('unexpected');return{delivered:true};}});const w=new h.PolysharpWorkflow();w.env=h.env;
 const out=await w.run({instanceId:'verify',payload:{source:'verification',receivedAt:now,options:validateOptions([])}},h.step);assert.equal(out.verification,true);assert.equal(out.complete,true);assert.deepEqual(sent,[]);const frozen=[...h.values.values()].find(v=>v.runId==='verify'&&v.stage);assert.equal(frozen.stage,'verification');const receipt=[...h.values.values()].find(v=>v.runId==='verify'&&'delivered'in v);assert.equal(receipt.delivered,false);assert.ok(!h.created.some(j=>j.params.kind==='settlement'||j.params.kind==='close'));
});
test('Cloudflare-generated long parent IDs never exceed child instance ID limits or skip roster wallets',async()=>{
 const now=Date.now(),h=harness(async()=>({}),undefined,{E,pool,roster,collect,editReply:async()=>({delivered:true})}),w=new h.PolysharpWorkflow();w.env=h.env;const output=await w.run({instanceId:'cf_'+'a'.repeat(64),payload:{source:'verification',receivedAt:now,options:validateOptions([])}},h.step);const jobs=h.created.filter(j=>j.params.kind==='wallet');assert.equal(output.complete,true);assert.equal(jobs.length,CORE.length);assert.ok(jobs.every(j=>j.id.length<=100));assert.equal(new Set(jobs.map(j=>j.id)).size,CORE.length);
});

const sharpRow=(i,o={})=>({rank:i,name:'S'+i,wallet:'0x'+String(i).padStart(40,'0'),proven:true,games:100,wins:60,losses:40,winRate:.6,avgPrice:.5,edge:.09,medianStake:500,bySport:{NBA:{games:40,wins:26,winRate:.65,edge:.1}},...o});
const sharpPos=(i,o={})=>({wallet:'0x'+String(i).padStart(40,'0'),trader:'S'+i,asset:'asset'+i,conditionId:'0x'+'c'.repeat(63)+i,outcomeIndex:0,outcome:'Yes',title:'Game '+i,eventSlug:'nba-game-'+i,sport:'NBA',sportFit:'strong',isGame:true,game:Date.now()+3600000,netShares:1000,costKnown:true,costBook:1e6,conv:.01,remainingCost:2500,currentValue:2600,curPrice:.52,avgPrice:.5,sizeMultiple:5,sharp:sharpRow(i),trust:{score:.1,estWin:.62,tier:'High',with:0,against:0,alert:true},lastEvent:Math.floor(Date.now()/1000)-600,...o});
const alertHarness=(rows,sent)=>harness(async()=>{throw Error('no public calls expected');},undefined,{E,pool,convictionReport,roster:async()=>rows.map(p=>({wallet:p.wallet,name:p.trader,sharp:p.sharp})),collect:async()=>({positions:rows,candidates:rows,scannedWallets:rows.length,complete:true,warnings:[]}),editReply:async(job,payload)=>{sent.push([job.source,payload]);return{delivered:true};}});
const alertJob=now=>({source:'alert',webhook:'https://discord.com/api/webhooks/1/x',receivedAt:now,options:{...validateOptions([]),limit:10}});

test('alert scan posts only new, recently traded cards, records them in the ledger and never repeats them',async()=>{
 const now=Date.now(),rows=[sharpPos(1),sharpPos(2,{lastEvent:Math.floor(now/1000)-9*3600})],sent=[];
 const h=alertHarness(rows,sent);
 const w=new h.PolysharpWorkflow();w.env=h.env;
 const first=await w.run({instanceId:'alert-1',payload:alertJob(now)},h.step);
 assert.equal(first.watched,1);assert.equal(sent.length,1);assert.equal(sent[0][0],'alert');
 assert.equal(sent[0][1].embeds.length,1);assert.match(sent[0][1].embeds[0].title,/New high-trust bet/);assert.match(sent[0][1].embeds[0].fields[0].value,/5\.0× their usual bet/);assert.match(sent[0][1].embeds[0].fields[0].value,/Still near their price/);
 assert.ok(h.values.has(Scorecard.alertKey(rows[0])));assert.equal(h.values.has(Scorecard.alertKey(rows[1])),false);
 const ledger=h.values.get(Scorecard.ledgerKey(now));assert.equal(ledger.length,1);assert.equal(ledger[0].source,'alert');assert.equal(ledger[0].rank,1);assert.equal(ledger[0].sizeMultiple,5);assert.equal(ledger[0].trust,'High');assert.equal(ledger[0].estWin,.62);
 const again=await w.run({instanceId:'alert-2',payload:alertJob(now+1000)},h.step);
 assert.equal(again.mode,'alert');assert.equal(again.published,0);assert.equal(sent.length,1);
});

test('alert scan ignores cards that are not high trust',async()=>{
 const now=Date.now(),sent=[],rows=[sharpPos(1,{trust:{score:.01,estWin:.53,tier:'Lean',alert:false}})];const h=alertHarness(rows,sent);
 const w=new h.PolysharpWorkflow();w.env=h.env;assert.equal((await w.run({instanceId:'alert-lean',payload:alertJob(now)},h.step)).published,0);assert.equal(sent.length,0);
});

test('alert scan stays silent when the roster scan is incomplete or the scan fails',async()=>{
 const now=Date.now(),sent=[],rows=[sharpPos(1)];
 const partial=harness(async()=>{throw Error('x');},undefined,{E,pool,convictionReport,roster:async()=>[{wallet:rows[0].wallet,name:'S1',sharp:rows[0].sharp}],collect:async()=>({positions:rows,candidates:rows,scannedWallets:0,complete:false,warnings:['down']}),editReply:async(j,p)=>{sent.push(p);return{delivered:true};}});
 let w=new partial.PolysharpWorkflow();w.env=partial.env;assert.equal((await w.run({instanceId:'alert-3',payload:alertJob(now)},partial.step)).published,0);
 const broken=harness(async()=>{throw Error('x');},undefined,{E,pool,convictionReport,roster:async()=>{throw Error('roster down');},collect:async()=>{throw Error('no');},editReply:async(j,p)=>{sent.push(p);return{delivered:true};}});
 w=new broken.PolysharpWorkflow();w.env=broken.env;assert.equal((await w.run({instanceId:'alert-4',payload:alertJob(now)},broken.step)).published,0);
 assert.equal(sent.length,0);
});

test('ordinary scans also feed the ledger and show the running paper record',async()=>{
 const now=Date.now(),rows=[sharpPos(1)],sent=[];const h=alertHarness(rows,sent);
 h.values.set(Scorecard.LATEST,{since:new Date(now-5*864e5).toISOString(),overall:{bets:10,wins:6,losses:4,pending:2,profitPer100:7.5}});
 const w=new h.PolysharpWorkflow();w.env=h.env;
 await w.run({instanceId:'scan-1',payload:{applicationId:'1',token:'t',receivedAt:now,options:validateOptions([])}},h.step);
 assert.match(sent.at(-1)[1].embeds[0].description,/Paper record since .*: 6-4 · \+\$7\.50 per \$100 · 2 pending/);
 assert.equal(h.values.get(Scorecard.ledgerKey(now)).length,1);assert.equal(h.values.has(Scorecard.alertKey(rows[0])),false);
});

test('scorecard job settles posted cards from saved results, stores the summary and posts it only when asked',async()=>{
 const now=Date.now(),sent=[];const h=harness(async()=>{throw Error('no public calls');},undefined,{E,pool,convictionReport,editReply:async(job,payload)=>{sent.push([job,payload]);return{delivered:true};}});
 h.env.DASHBOARD_WEBHOOK_URL='https://discord.com/api/webhooks/1/abc';
 const row=(i,o={})=>({runId:'r'+i,at:now-3*864e5,policy:'sharp-size-v1',source:'discord',wallet:'w'+i,trader:'T'+i,rank:i,proven:i<2,sport:'NBA',title:'G'+i,outcome:'Yes',asset:'a'+i,conditionId:'0x'+String(i).padStart(64,'0'),outcomeIndex:0,game:now-2*864e5,gameKey:'g'+i,paid:.5,indicative:.5,allIn:.5,sizeMultiple:3,...o});
 h.values.set(Scorecard.ledgerKey(now),[row(1),row(2),row(3,{game:now+864e5}),row(4,{gameKey:'g1',runId:'later',at:now-2.5*864e5})]);
 h.values.set(settlementKey(row(1).conditionId),{status:'resolved',payouts:[1000000,0]});
 h.values.set(settlementKey(row(2).conditionId),{status:'resolved',payouts:[0,1000000]});
 const quiet=await h.scorecardJob({kind:'scorecard',post:false},h.step,h.env);
 assert.deepEqual([quiet.settled,quiet.cards,quiet.posted],[2,3,false]);assert.equal(sent.length,0);
 const s=h.values.get(Scorecard.LATEST);assert.equal(s.overall.wins,1);assert.equal(s.overall.losses,1);assert.equal(s.overall.pending,1);assert.equal(s.overall.profitPer100,0);
 assert.equal(s.byTier['Proven ✓'].wins,1);assert.equal(Object.keys(h.values.get(Scorecard.RESULTS)).length,2);
 const loud=await h.scorecardJob({kind:'scorecard',post:true},h.step,h.env);assert.equal(loud.posted,true);assert.equal(sent.length,1);
 assert.match(sent[0][1].embeds[0].description,/1-1 · \+\$0\.00 per \$100 · 1 pending/);assert.equal(JSON.stringify(sent[0][1]).includes('webhooks'),false);
 const created=[];await h.scheduled({scheduledTime:Date.UTC(2026,10,23,13,23)},{SCANS:{create:async x=>created.push(x)}});
 assert.equal(created[0].id,'scorecard-2026-11-23');assert.equal(created[0].params.post,true);
 await h.scheduled({scheduledTime:Date.UTC(2026,10,24,13,23)},{SCANS:{create:async x=>created.push(x)}});assert.equal(created[1].params.post,false);
});
