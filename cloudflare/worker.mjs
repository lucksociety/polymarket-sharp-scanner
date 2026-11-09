import {WorkflowEntrypoint} from 'cloudflare:workers';
import E from '../engine.js';
import {scanReport} from './scan-report.mjs';
import {selectWatchlist,freezeRun,putPrepared,journalKey,publicationKey,settlementKey,closeKey} from './journal.mjs';
import {handle,report,convictionReport,predictionsReport,editReply} from './discord.mjs';
import {CORE,roster,collect,quote,assessOne,rankUnique,readPublic,buildHistory,pool,fetchWallet,compactWalletPage} from './scanner.mjs';

import {predictionsRoster,fetchPredictionsWallet,rankPredictions} from './predictions.mjs';

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
 await step.sleep(name+'-admission-pace','1 second');
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
  const slim=value=>job.kind==='wallet'&&new URL(url).pathname==='/v2/positions'&&value?compactWalletPage(value):value;
  const cached=await step.do('cached-'+hash,async()=>slim(await env.CACHE.get(key,{type:'json',cacheTtl:30})));
  let value=cached;
  if(value===null){
   if(requests>=20){exhausted=true;throw Error('Continue history in next bounded job');}
   requests++;
   try{
    await step.sleep('pace-'+hash,job.kind==='wallet'?'1 second':'2 seconds');
    value=await step.do('public-'+hash,{...opts,retries:{limit:1,delay:'15 seconds',backoff:'exponential'}},async()=>slim(await readPublic(url,new URL(url).hostname==='gamma-api.polymarket.com'?new Set(conditions):undefined)));
    await step.do('cache-'+hash,()=>env.CACHE.put(key,JSON.stringify(value),{expirationTtl:86400}));
   }catch(e){failed=true;throw e;}
  }
  for(const row of value?.data||[])if(row.condition_id)conditions.add(row.condition_id);
  return value;
 };get.exhausted=()=>exhausted;get.failed=()=>failed;return get;
}
const historyKey=w=>'history-v6/'+w.toLowerCase();
async function loadEvidence(step,env,traders,asOf){
 const rows=await pool(traders,3,t=>step.do('history-cache-'+t.wallet,()=>env.CACHE.get(historyKey(t.wallet),'json')));
 const history=[],missing=[],manifest=[];
 for(let i=0;i<traders.length;i++){
  const r=rows[i];
  if(r?.ready===true&&r.builtAt<=asOf&&asOf-r.builtAt<24*3600000&&Array.isArray(r.records)){history.push(...r.records);manifest.push({wallet:traders[i].wallet,builtAt:r.builtAt,key:'evidence/v1/'+traders[i].wallet.toLowerCase()+'/'+r.builtAt,records:r.records.length});}
  if(!r||r.ready!==true||!Array.isArray(r.records)||r.builtAt>asOf||asOf-r.builtAt>24*3600000)missing.push(traders[i]);
 }
 return {evidence:{version:1,odds:[],history,clusters:{}},missing,manifest};
}
async function warmHistory(step,env,traders,asOf){
 const day=new Date(asOf).toISOString().slice(0,10);
 const jobs=traders.map((t,i)=>({id:`history-v6-${day}-${t.wallet}`,params:{kind:'history',trader:t,asOf,delay:720000+i*20000}}));
 try{await launchBatch(step,env,'warm-histories',jobs);return jobs.length;}catch{return 0;}
}
export class PolysharpWorkflow extends WorkflowEntrypoint{
 async run(event,step){
  const job=event.payload;
  if(job.kind==='close'||job.kind==='settlement')return observeMarket(job,step,this.env);
  if(job.kind==='wallet'||job.kind==='quote'){
   if(job.delay)await step.sleep('stagger-start',job.delay);
   let output;
   try{
    const get=job.kind==='wallet'?historyGet(step,this.env,job):durableGet(step,'child');
    let value;
    try{value=job.kind==='wallet'?await (job.predictions?fetchPredictionsWallet:fetchWallet)(job.trader,get,job.asOf):await quote(job.position,get);}
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
    await step.do('save-history',async()=>{const body=JSON.stringify(result);await this.env.CACHE.put('evidence/v1/'+job.trader.wallet.toLowerCase()+'/'+result.builtAt,body);await this.env.CACHE.put(historyKey(job.trader.wallet),body,{expirationTtl:3*86400});return true;});
    return {records:result.records.length,missingClosing:result.counts.missingClose};
   }catch{
    await step.do('save-history-failure',()=>this.env.CACHE.put('history-error/'+job.trader.wallet,JSON.stringify({at:job.asOf,reason:'Incomplete or unavailable public history; previous complete cache retained'}),{expirationTtl:86400}));
    return {records:0,incomplete:true};
   }
  }
  const deadline=job.receivedAt+10*60000,publicBudget={used:0,limit:40},get=durableGet(step,'scan',deadline,publicBudget),warnings=[];
  try{
   const predictions=job.options.ranking==='predictions';
   const traders=await (predictions?predictionsRoster:roster)(get,warnings);
   if(job.source!=='dashboard'&&job.source!=='verification')await step.do('show-progress',opts,()=>editReply(job,{content:`☘ Scanning ${traders.length} ${predictions?'smart money':'tracked sports'} wallets and current Polymarket prices. Large wallets can take several minutes; this message will update with the result.`,embeds:[],allowed_mentions:{parse:[]}}));
   const {evidence,missing,manifest}=predictions?{evidence:{history:[],clusters:{}},missing:[],manifest:[]}:await loadEvidence(step,this.env,traders,job.receivedAt);
   const historyPending=!predictions?await warmHistory(step,this.env,missing,job.receivedAt):0;
   const walletJobs=traders.map((t,i)=>({id:'wallet-'+event.instanceId+'-'+t.wallet,params:{kind:'wallet',predictions,trader:t,asOf:job.receivedAt,delay:1000+i*2500}}));
   await launchBatch(step,this.env,'launch-wallets',walletJobs);
   const walletData=new Map(),retry=[];
   await pool(traders,3,async t=>{try{walletData.set(t.wallet,await result(step,this.env,'wallet-'+event.instanceId+'-'+t.wallet,deadline));}catch{retry.push(t);}});
   const retryJobs=retry.map((t,i)=>({id:'retry-'+event.instanceId+'-'+t.wallet,params:{kind:'wallet',predictions,trader:t,asOf:job.receivedAt,delay:1000+i*3000}}));
   await launchBatch(step,this.env,'retry-missing-wallets',retryJobs);
   await pool(retry,3,async t=>{try{walletData.set(t.wallet,await result(step,this.env,'retry-'+event.instanceId+'-'+t.wallet,deadline));}catch{}});
   if(predictions){
    if(walletData.size<traders.length)warnings.push('Some wallets could not be loaded');
    const loaded=[...walletData.values()];
    const plays=await rankPredictions(get,loaded.flatMap(wallet=>wallet.positions),warnings);
    const count=loaded.reduce((total,wallet)=>total+wallet.count,0);
    await step.do('send-predictions-result',opts,()=>editReply(job,predictionsReport(plays,loaded.length,traders.length,count,warnings)));
    return {mode:'predictions',published:plays.length,complete:!warnings.length};
   }
   const scan=await collect(get,traders,{...job.options,asOf:job.receivedAt},(_fn,t)=>{if(!walletData.has(t.wallet))throw Error('Wallet unavailable after retry');return walletData.get(t.wallet);});
   if(warnings.length)scan.complete=false;warnings.push(...scan.warnings);
   const watchlist=selectWatchlist(scan.candidates,{now:Date.now(),limit:job.options.limit});
   if(missing.length>historyPending)warnings.push(`${missing.length-historyPending} wallet histories are unavailable or exceeded the background budget.`);
   if(evidence.history.length===0)warnings.push('Trader history has not warmed yet. No wallet can qualify without sufficient prior observations.');
   const assessments=[];
   // Price up to 40 evidence-qualified outcome groups plus the separate observed watchlist.
   const keys=[...new Set(scan.candidates.filter(p=>E.quality(p.wallet,p.sport,evidence.history,job.receivedAt,job.options.settings.minGames).qualified).sort((a,b)=>b.conv-a.conv).map(E.key))].slice(0,40),selected=new Set(keys);
   const candidates=[...new Map([...scan.candidates.filter(p=>selected.has(E.key(p))),...watchlist].map(p=>[p.wallet+'|'+p.asset,p])).values()];
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
   // Refresh every displayed entry immediately before freezing its paper observation.
   const leading=rankUnique(assessments).slice(0,job.options.limit),refreshPositions=[...new Map([...leading.map(a=>a.p),...watchlist].map(p=>[p.asset,p])).values()],refreshIds=new Map();
   const refreshJobs=await Promise.all(refreshPositions.map(async(p,i)=>{const id='refresh-'+await digest(event.instanceId+'|'+p.asset);refreshIds.set(p.asset,id);return{id,params:{kind:'quote',position:p,delay:1000+i*500}}}));
   await launchBatch(step,this.env,'refresh-displayed-quotes',refreshJobs);
   const freshAssessments=[];
   await pool(candidates,3,async p=>{if(!refreshIds.has(p.asset))return;try{const q=await result(step,this.env,refreshIds.get(p.asset),deadline);quoteCache.set(p.asset,q);const a=await step.do('refresh-assess-'+p.wallet+'-'+p.asset.slice(-30),()=>({...assessOne(p,scan,evidence,job.options,q),quoteAt:q.quoteAt}));freshAssessments.push(a);}catch{quoteCache.delete(p.asset);freshAssessments.push({p,eligible:false,reasons:['Executable quote unavailable']});}});
   const bets=rankUnique(freshAssessments).filter(a=>Date.now()-a.quoteAt<=30000&&a.p.game>Date.now()).slice(0,job.options.limit);
   return await finishScan({step,env:this.env,job,runId:event.instanceId,scan,traders,watchlist,bets,assessments:[...new Map([...assessments,...freshAssessments].map(a=>[a.p.wallet+'|'+a.p.asset,a])).values()],quotes:quoteCache,evidenceManifest:manifest,historyCount:evidence.history.length,historyPending,warnings});
  }catch{
   if(job.source==='verification')return{published:0,incomplete:true,verification:true};
   await step.do('send-failure',opts,()=>editReply(job,{content:`☘ /${job.options.ranking==='predictions'?'predictions':'polysharp'} could not finish a complete scan. No picks were promoted. Please try again shortly; public API failures or platform limits may have interrupted this run.`,embeds:[],allowed_mentions:{parse:[]}}));
   return {published:0,incomplete:true};
  }
 }
}

async function finishScan({step,env,job,runId,scan,traders,watchlist,bets,assessments,quotes,evidenceManifest,historyCount,historyPending,warnings}){
 const snapshotAt=await step.do('paper-snapshot-time',()=>Date.now());
 const rendered=scanReport({bets:bets.filter(a=>a.p.game>snapshotAt),watchlist:watchlist.filter(p=>p.game>snapshotAt),scan,rosterCount:traders.length,historyCount,historyPending,options:job.options,assessments,quotes,now:snapshotAt});
 const key=journalKey(runId,job.receivedAt),record=freezeRun({runId,job:{...job,rosterCount:traders.length},scan,watchlist:rendered.watchlist,candidates:rendered.candidates,assessments,quotes,evidenceManifest,payload:rendered.payload,now:snapshotAt});
 const prepared=await step.do('freeze-paper-signal',opts,async()=>{if(new TextEncoder().encode(JSON.stringify(record)).length>850000)throw Error('Frozen signal exceeds safe storage size');const saved=await putPrepared(env.CACHE,key,record);return{payload:saved.payload,preparedAt:saved.preparedAt,entries:saved.entries.map(e=>({kind:e.kind,asset:e.position.asset,conditionId:e.position.conditionId,game:e.position.game,quoteAt:e.quote?.quoteAt}))};});
 const settled=new Map(),closes=new Map();
 for(const e of prepared.entries){settled.set(e.conditionId,{id:'settle-v1-'+e.conditionId.slice(2),params:{kind:'settlement',conditionId:e.conditionId,game:e.game}});closes.set(e.asset,{id:'close-v1-'+await digest(e.asset+'|'+e.game),params:{kind:'close',asset:e.asset,game:e.game}});}
 const verification=job.source==='verification';let trackingQueued=!verification;if(!verification)try{await launchBatch(step,env,'schedule-paper-observations',[...settled.values(),...closes.values()]);}catch{trackingQueued=false;}
 const receipt=await step.do('send-result',opts,()=>{if(verification)return{delivered:false,verification:true};if(prepared.entries.some(e=>e.kind==='candidate'&&(!e.quoteAt||Date.now()-e.quoteAt>30000)))throw Error('Candidate quote expired before publication');return editReply(job,prepared.payload);});
 let receiptSaved=true;
 try{await step.do('record-publication',opts,()=>env.CACHE.put(publicationKey(key),JSON.stringify({runId,delivered:receipt.delivered===true,verification,observedAt:Date.now(),trackingQueued,messageId:receipt.messageId||null,channelId:receipt.channelId||job.channelId||null})));}catch{receiptSaved=false;}
 return{mode:'paper',verification,published:prepared.entries.filter(e=>e.kind==='candidate').length,watched:prepared.entries.filter(e=>e.kind==='watchlist').length,complete:scan.complete,positions:scan.positions.length,wallets:scan.scannedWallets,roster:traders.length,journal:key,receiptSaved,trackingQueued};
}
async function observeMarket(job,step,env){
 if(job.kind==='close'){
  await step.sleepUntil('wait-for-pregame-close',job.game+60000);
  const get=durableGet(step,'closing-observation');let point=null,error=null;
  try{const j=await get(`https://data-api.polymarket.com/v2/prices-history?token_id=${job.asset}&as_of=${Math.floor(job.game/1000)-1}`);point=(j.data||[]).filter(p=>Number.isFinite(p.resolution_seconds)&&p.resolution_seconds>=0&&p.timestamp*1000>=job.game-15*60000&&(p.timestamp+p.resolution_seconds)*1000<job.game&&p.price>0&&p.price<1).sort((a,b)=>b.timestamp-a.timestamp)[0]||null;}catch{error='Pregame closing observation unavailable';}
  await step.do('save-pregame-close',()=>env.CACHE.put(closeKey(job.asset,job.game),JSON.stringify({asset:job.asset,game:job.game,observedAt:Date.now(),point,error,source:'Polymarket v2 strictly pregame price bucket'})));return{observed:Boolean(point)};
 }
 await step.sleepUntil('wait-for-game-result',job.game+3*3600000);
 for(let attempt=0;attempt<16;attempt++){
  const get=durableGet(step,'settlement-observation-'+attempt);let resolution;
  try{const j=await get('https://data-api.polymarket.com/v2/resolutions?condition='+job.conditionId);resolution=j.data?.find(r=>r.condition_id===job.conditionId&&r.status==='resolved'&&Number.isFinite(Date.parse(r.resolved_at))&&Date.parse(r.resolved_at)<=Date.now()&&Array.isArray(r.payouts)&&r.payouts.length>=2&&r.payouts.every(x=>Number.isFinite(x)&&x>=0&&x<=1e6)&&r.payouts.reduce((s,x)=>s+x,0)===1e6);}catch{}
  if(resolution){await step.do('save-market-settlement',()=>env.CACHE.put(settlementKey(job.conditionId),JSON.stringify({conditionId:job.conditionId,status:'resolved',resolvedAt:resolution.resolved_at,payouts:resolution.payouts,observedAt:Date.now(),source:'Polymarket v2 resolution'})));return{settled:true};}
  if(attempt<15)await step.sleep('wait-for-resolution-'+attempt,'12 hours');
 }
 return{settled:false,reason:'Resolution unavailable after bounded retries; paper return remains unknown'};
}
