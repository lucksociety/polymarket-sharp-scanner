import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compactWalletPage,pool,validateOptions,rankUnique,assessOne,CORE,roster,collect} from './scanner.mjs';
import E from '../engine.js';
import {convictionReport} from './discord.mjs';
import {scanReport} from './scan-report.mjs';
import {selectWatchlist,freezeRun,putPrepared,journalKey,publicationKey,settlementKey,closeKey} from './journal.mjs';
const source=(await readFile(new URL('./worker.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default {fetch:handle};','').replace('export class PolysharpWorkflow','class PolysharpWorkflow');
function harness(readPublic,fetchWallet=async()=>({positions:[],activity:[]}),deps={}){
 const values=new Map(),created=[],sleeps=[];
 const env={CACHE:{get:async k=>values.has(k)?values.get(k):null,put:async(k,v)=>values.set(k,JSON.parse(v))},SCANS:{create:async x=>{created.push(x);return{};},createBatch:async x=>{created.push(...x);for(const j of x)if(j.params?.kind==='wallet')values.set('result/'+j.id,{ok:true,value:{positions:[],activity:[]}});return[];}}};
 const step={do:async(_n,options,fn)=>(fn||options)(),sleep:async(n,d)=>{sleeps.push([n,d]);},sleepUntil:async(n,d)=>{sleeps.push([n,d]);}};
 deps={rankUnique,assessOne,scanReport,selectWatchlist,freezeRun,putPrepared,journalKey,publicationKey,settlementKey,closeKey,...deps};
 const funcs=new Function('WorkflowEntrypoint','readPublic','fetchWallet','compactWalletPage','deps','const {E,roster,collect,pool,convictionReport,editReply,rankUnique,assessOne,scanReport,selectWatchlist,freezeRun,putPrepared,journalKey,publicationKey,settlementKey,closeKey}=deps;'+source+';return {historyGet,launchBatch,result,PolysharpWorkflow,observeMarket,finishScan};')(class{},readPublic,fetchWallet,compactWalletPage,deps);
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
