import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compactWalletPage} from './scanner.mjs';
const source=(await readFile(new URL('./worker.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default {fetch:handle};','').replace('export class PolysharpWorkflow','class PolysharpWorkflow');
function harness(readPublic,fetchWallet=async()=>({positions:[],activity:[]})){
 const values=new Map(),created=[],sleeps=[];
 const env={CACHE:{get:async k=>values.has(k)?values.get(k):null,put:async(k,v)=>values.set(k,JSON.parse(v))},SCANS:{create:async x=>{created.push(x);return{};},createBatch:async x=>{created.push(...x);return[];}}};
 const step={do:async(_n,options,fn)=>(fn||options)(),sleep:async(n,d)=>{sleeps.push([n,d]);}};
 const funcs=new Function('WorkflowEntrypoint','readPublic','fetchWallet','compactWalletPage',source+';return {historyGet,launchBatch,result,PolysharpWorkflow};')(class{},readPublic,fetchWallet,compactWalletPage);
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
