import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compactWalletPage,pool,validateOptions} from './scanner.mjs';
import E from '../engine.js';
import {convictionReport} from './discord.mjs';
const source=(await readFile(new URL('./worker.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default {fetch:handle};','').replace('export class PolysharpWorkflow','class PolysharpWorkflow');
function harness(readPublic,fetchWallet=async()=>({positions:[],activity:[]}),deps={}){
 const values=new Map(),created=[],sleeps=[];
 const env={CACHE:{get:async k=>values.has(k)?values.get(k):null,put:async(k,v)=>values.set(k,JSON.parse(v))},SCANS:{create:async x=>{created.push(x);return{};},createBatch:async x=>{created.push(...x);for(const j of x)if(j.params?.kind==='wallet')values.set('result/'+j.id,{ok:true,value:{positions:[],activity:[]}});return[];}}};
 const step={do:async(_n,options,fn)=>(fn||options)(),sleep:async(n,d)=>{sleeps.push([n,d]);}};
 const funcs=new Function('WorkflowEntrypoint','readPublic','fetchWallet','compactWalletPage','deps','const {E,roster,collect,pool,convictionReport,editReply}=deps;'+source+';return {historyGet,launchBatch,result,PolysharpWorkflow};')(class{},readPublic,fetchWallet,compactWalletPage,deps);
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

test('default Workflow publishes dashboard conviction cards with no historical or quote gates',async()=>{
 const now=Date.now(),p={wallet:'a',trader:'A',conditionId:'market',outcomeIndex:0,outcome:'Yes',title:'Test game',eventSlug:'test',sport:'NBA',isGame:true,game:now+3600000,netShares:10000,costKnown:true,costBook:100000,conv:.25,remainingCost:25000,currentValue:10000,curPrice:.5};
 const rows=[p,{...p,wallet:'b',trader:'B',conv:.3,remainingCost:30000}],sent=[];
 const h=harness(async()=>{throw Error('Default should not need historical/quote calls');},undefined,{E,pool,convictionReport,roster:async()=>rows.map(p=>({wallet:p.wallet,name:p.trader})),collect:async()=>({positions:rows,candidates:rows,scannedWallets:2,complete:true,warnings:[]}),editReply:async(_job,payload)=>{sent.push(payload);return{delivered:true};}});
 const w=new h.PolysharpWorkflow();w.env=h.env;const result=await w.run({instanceId:'test-scan',payload:{receivedAt:now,options:validateOptions([])}},h.step);
 assert.equal(result.mode,'conviction');assert.equal(result.published,2);assert.deepEqual(result.top.map(p=>p.wallet),['b','a']);assert.ok(h.created.every(j=>j.params.kind==='wallet'));assert.match(sent.at(-1).embeds[0].fields[1].value,/30.0%/);
});

test('dashboard-triggered Workflow skips the progress message and sends only the final conviction card',async()=>{
 const now=Date.now(),p={wallet:'a',trader:'A',conditionId:'market',outcomeIndex:0,outcome:'Yes',title:'Test game',eventSlug:'test',sport:'NHL',isGame:true,game:now+3600000,netShares:10000,costKnown:true,costBook:100000,conv:.25,remainingCost:25000,currentValue:10000,curPrice:.5};
 const sent=[];const h=harness(async()=>{throw Error('no public calls expected');},undefined,{E,pool,convictionReport,roster:async()=>[{wallet:'a',name:'A'}],collect:async()=>({positions:[p],candidates:[p],scannedWallets:1,complete:true,warnings:[]}),editReply:async(job,payload)=>{sent.push([job.source,payload]);return{delivered:true};}});
 const w=new h.PolysharpWorkflow();w.env=h.env;const result=await w.run({instanceId:'dash-1',payload:{source:'dashboard',webhook:'https://discord.com/api/webhooks/1/x',receivedAt:now,options:validateOptions([])}},h.step);
 assert.equal(result.mode,'conviction');assert.equal(sent.length,1);assert.equal(sent[0][0],'dashboard');assert.match(sent[0][1].embeds[0].title,/Highest Conviction/);
});
