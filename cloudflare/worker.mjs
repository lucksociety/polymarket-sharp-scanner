import {WorkflowEntrypoint} from 'cloudflare:workers';
import E from '../engine.js';
import {handle,report,editReply} from './discord.mjs';
import {CORE,roster,collect,quote,assessOne,rankUnique,readPublic,buildHistory,pool,fetchWallet} from './scanner.mjs';

export default {fetch:handle};
const opts={retries:{limit:2,delay:'10 seconds',backoff:'exponential'},timeout:'45 seconds'};
async function digest(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);}
function durableGet(step,phase,deadline=Infinity,budget={used:0,limit:40}){
 const maxCalls=phase==='scan'?25:phase==='final-quote'?20:40;let calls=0,failed=false;const conditions=new Set();
 const get=async (url,conditionIds)=>{
  if(Date.now()>deadline||++calls>maxCalls){failed=true;throw Error('Public query budget exceeded');}
  try{const name=phase+'-'+await digest(url);const selected=conditionIds||(phase==='history'&&new URL(url).hostname==='gamma-api.polymarket.com'?new Set(conditions):undefined);
   await step.sleep(name+'-pace','1 second');
   const value=await step.do(name,opts,()=>{if(++budget.used>budget.limit)throw Error('Invocation request budget exhausted');return readPublic(url,selected);});
   for(const row of value?.data||[])if(row.condition_id)conditions.add(row.condition_id);
   return value;
  }catch(e){failed=true;throw e;}
 };get.failed=()=>failed;get.exhausted=()=>calls>maxCalls;return get;
}
async function launchBatch(step,env,name,jobs){
 if(!jobs.length)return;
 await step.do(name,opts,async()=>{await env.SCANS.createBatch(jobs);return true;});
}
async function result(step,env,id,deadline=Infinity){
 for(let i=0;i<100;i++){
  if(Date.now()>deadline)throw Error('Scan deadline reached');
  const value=await step.do('read-'+id+'-'+i,()=>env.CACHE.get('result/'+id,{type:'json',cacheTtl:30}));
  if(value){if(!value.ok)throw Error('Complete child scan unavailable');return value.value;}
  await step.sleep('wait-'+id+'-'+i,'5 seconds');
 }throw Error('Child scan timed out');
}
function historyGet(step,env,job){
 let requests=0,exhausted=false,failed=false;const conditions=new Set();
 const get=async url=>{
  const hash=await digest(job.trader.wallet+'|'+job.asOf+'|'+url),key='history-page/'+hash;
  const cached=await step.do('cached-'+hash,()=>env.CACHE.get(key,{type:'json',cacheTtl:30}));
  let value=cached;
  if(value===null){
   if(requests>=20){exhausted=true;throw Error('Continue history in next bounded job');}
   requests++;
   try{
    await step.sleep('pace-'+hash,'2 seconds');
    value=await step.do('public-'+hash,{...opts,retries:{limit:1,delay:'15 seconds',backoff:'exponential'}},()=>readPublic(url,new URL(url).hostname==='gamma-api.polymarket.com'?new Set(conditions):undefined));
    await step.do('cache-'+hash,()=>env.CACHE.put(key,JSON.stringify(value),{expirationTtl:86400}));
   }catch(e){failed=true;throw e;}
  }
  for(const row of value?.data||[])if(row.condition_id)conditions.add(row.condition_id);
  return value;
 };get.exhausted=()=>exhausted;get.failed=()=>failed;return get;
}
const historyKey=w=>'history/'+w.toLowerCase();
async function loadEvidence(step,env,traders,asOf){
 const rows=await pool(traders,3,t=>step.do('history-cache-'+t.wallet,()=>env.CACHE.get(historyKey(t.wallet),'json')));
 const history=[],missing=[];
 for(let i=0;i<traders.length;i++){
  const r=rows[i];
  if(r&&r.builtAt<=asOf&&asOf-r.builtAt<48*3600000&&Array.isArray(r.records))history.push(...r.records);
  if(!r||asOf-r.builtAt>24*3600000)missing.push(traders[i]);
 }
 return {evidence:{version:1,odds:[],history,clusters:{}},missing};
}
async function warmHistory(step,env,traders,asOf){
 const day=new Date(asOf).toISOString().slice(0,10);
 const jobs=traders.map((t,i)=>({id:`history-v5-${day}-${t.wallet}`,params:{kind:'history',trader:t,asOf,delay:720000+i*20000}}));
 try{await launchBatch(step,env,'warm-histories',jobs);return jobs.length;}catch{return 0;}
}
export class PolysharpWorkflow extends WorkflowEntrypoint{
 async run(event,step){
  const job=event.payload;
  if(job.kind==='wallet'||job.kind==='quote'){
   if(job.delay)await step.sleep('stagger-start',job.delay);
   let output;
   try{
    const get=job.kind==='wallet'?historyGet(step,this.env,job):durableGet(step,'child');
    let value;
    try{value=job.kind==='wallet'?await fetchWallet(job.trader,get,job.asOf):await quote(job.position,get);}
    catch(error){
     if(job.kind==='wallet'&&get.exhausted()&&!get.failed()&&(job.sequence||0)<10){
      const sequence=(job.sequence||0)+1,id='wallet-more-'+await digest((job.resultId||event.instanceId)+'|'+sequence);
      await step.do('continue-wallet',()=>this.env.SCANS.create({id,params:{...job,sequence,resultId:job.resultId||event.instanceId,delay:1000}}).then(()=>true));
      return {continuing:true,sequence};
     }throw error;
    }
    output={ok:true,value};
   }catch{output={ok:false};}
   await step.do('save-child-result',()=>this.env.CACHE.put('result/'+(job.resultId||event.instanceId),JSON.stringify(output),{expirationTtl:900}));
   return {ok:output.ok};
  }
  if(job.kind==='history'){
   await step.sleep('defer-history',job.delay||'12 minutes');
   const get=historyGet(step,this.env,job);
   try{
    const result=await buildHistory(job.trader,get,Math.max(1,Math.min(100,Number(this.env.HISTORY_MAX_PAGES)||30)),job.asOf);
    if(get.exhausted()&&!get.failed()&&(job.sequence||0)<30){
     const sequence=(job.sequence||0)+1,id='history-more-'+await digest(job.trader.wallet+'|'+job.asOf+'|'+sequence);
     await step.do('continue-history',()=>this.env.SCANS.create({id,params:{...job,sequence,delay:'5 seconds'}}).then(()=>true));
     return {continuing:true,sequence};
    }
    if(get.exhausted()||get.failed()||result.counts.failedWallets)throw Error('Complete wallet history could not be analyzed');
    await step.do('save-history',()=>this.env.CACHE.put(historyKey(job.trader.wallet),JSON.stringify(result),{expirationTtl:3*86400}));
    return {records:result.records.length,missingClosing:result.counts.missingClose};
   }catch{
    await step.do('save-history-failure',()=>this.env.CACHE.put('history-error/'+job.trader.wallet,JSON.stringify({at:job.asOf,reason:'Incomplete or unavailable public history; previous complete cache retained'}),{expirationTtl:86400}));
    return {records:0,incomplete:true};
   }
  }
  const deadline=job.receivedAt+10*60000,publicBudget={used:0,limit:40},get=durableGet(step,'scan',deadline,publicBudget),warnings=[];
  try{
   const traders=await roster(get,warnings);
   await step.do('show-progress',opts,()=>editReply(job,{content:`☘ Scanning ${traders.length} sharp wallets and current Polymarket prices. Large wallets can take several minutes; this message will update with the result.`,embeds:[],allowed_mentions:{parse:[]}}));
   const {evidence,missing}=await loadEvidence(step,this.env,traders,job.receivedAt);
   const historyPending=await warmHistory(step,this.env,missing,job.receivedAt);
   const walletJobs=traders.map((t,i)=>({id:'wallet-'+event.instanceId+'-'+t.wallet,params:{kind:'wallet',trader:t,asOf:job.receivedAt,delay:1000+i*2500}}));
   await launchBatch(step,this.env,'launch-wallets',walletJobs);
   const walletData=new Map(),retry=[];
   await pool(traders,3,async t=>{try{walletData.set(t.wallet,await result(step,this.env,'wallet-'+event.instanceId+'-'+t.wallet,deadline));}catch{retry.push(t);}});
   const retryJobs=retry.map((t,i)=>({id:'retry-'+event.instanceId+'-'+t.wallet,params:{kind:'wallet',trader:t,asOf:job.receivedAt,delay:1000+i*3000}}));
   await launchBatch(step,this.env,'retry-missing-wallets',retryJobs);
   await pool(retry,3,async t=>{try{walletData.set(t.wallet,await result(step,this.env,'retry-'+event.instanceId+'-'+t.wallet,deadline));}catch{}});
   const scan=await collect(get,traders,{...job.options,asOf:job.receivedAt},(_fn,t)=>{if(!walletData.has(t.wallet))throw Error('Wallet unavailable after retry');return walletData.get(t.wallet);});
   if(warnings.length)scan.complete=false;warnings.push(...scan.warnings);
   if(missing.length>historyPending)warnings.push(`${missing.length-historyPending} wallet histories are unavailable or exceeded the background budget.`);
   if(evidence.history.length===0)warnings.push('Trader history has not warmed yet. No wallet can qualify without sufficient prior observations.');
   const assessments=[];
   // Assess every representative within the first 60 distinct outcome candidates, like the dashboard quote batch.
   const keys=[...new Set(scan.candidates.sort((a,b)=>b.conv-a.conv).map(E.key))].slice(0,60),selected=new Set(keys);
   const candidates=scan.candidates.filter(p=>selected.has(E.key(p)));
   const quoteCache=new Map();
   const unique=[...new Map(candidates.map(p=>[p.asset,p])).values()];
   const quoteIds=new Map();
   const quoteJobs=await Promise.all(unique.map(async (p,i)=>{const id='quote-'+await digest(event.instanceId+'|'+p.asset);quoteIds.set(p.asset,id);return {id,params:{kind:'quote',position:p,delay:1000+i*1000}};}));
   await launchBatch(step,this.env,'launch-quotes',quoteJobs);
   for(const p of candidates){
    if(Date.now()>deadline)throw Error('Scan timed out');
    try{
     if(!quoteCache.has(p.asset))quoteCache.set(p.asset,await result(step,this.env,quoteIds.get(p.asset),deadline));
     const q=quoteCache.get(p.asset);
     const a=await step.do('assess-'+p.wallet+'-'+p.asset.slice(-30),()=>({...assessOne(p,scan,evidence,job.options,q),quoteAt:q.quoteAt}));
     assessments.push(a);
    }catch{warnings.push('One candidate could not be priced or assessed.');}
   }
   // Reprice the leading eligible candidates immediately before sending a public recommendation.
   const final=[],refreshGet=durableGet(step,'final-quote',deadline,publicBudget);
   for(const a of rankUnique(assessments).slice(0,10)){
    try{const q=await quote(a.p,refreshGet),fresh=await step.do('final-assess-'+a.p.asset.slice(-30),()=>({...assessOne(a.p,scan,evidence,job.options,q),quoteAt:q.quoteAt}));if(fresh.eligible)final.push(fresh);}catch{warnings.push('A leading candidate failed final quote validation.');}
   }
   const bets=rankUnique(final).filter(a=>Date.now()-a.quoteAt<=30000&&a.p.game>Date.now()).slice(0,job.options.limit);
   const payload=report({bets,warnings:[...new Set(warnings)],positionCount:scan.positions.length,scannedWallets:scan.scannedWallets,rosterCount:traders.length,candidateCount:keys.length,historyCount:evidence.history.length,historyPending,options:job.options,complete:scan.complete});
   await step.do('send-result',opts,()=>editReply(job,payload));
   return {published:bets.length,complete:scan.complete,positions:scan.positions.length,wallets:scan.scannedWallets,roster:traders.length,candidates:keys.length};
  }catch{
   await step.do('send-failure',opts,()=>editReply(job,{content:'☘ /polysharp could not finish a complete scan. No picks were promoted. Please try again shortly; public API failures or platform limits may have interrupted this run.',embeds:[],allowed_mentions:{parse:[]}}));
   return {published:0,incomplete:true};
  }
 }
}
