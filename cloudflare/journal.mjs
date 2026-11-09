// Private, append-only paper observations. Never persist interaction tokens or webhooks.
export const POLICY='sport-price-v1';
export const PREFIX='signals/v1/';
const copy=(x,keys)=>Object.fromEntries(keys.filter(k=>x?.[k]!==undefined).map(k=>[k,x[k]]));
export const gameKey=p=>(p.eventSlug||p.conditionId||p.asset).replace(/-more-markets$/,'');
export function selectWatchlist(rows,{now=Date.now(),limit=10}={}){
 const sorted=rows.filter(p=>p.isGame&&p.game>now&&p.netShares>0&&p.costKnown!==false&&p.costBook>=25000).sort((a,b)=>b.conv-a.conv);
 const seen=new Set();return sorted.filter(p=>{const k=gameKey(p);if(seen.has(k))return false;seen.add(k);return true}).slice(0,limit);
}
export const journalKey=(runId,at)=>PREFIX+new Date(at).toISOString().slice(0,10)+'/'+runId;
export const publicationKey=key=>key+'/publication';
export const settlementKey=condition=>'settlements/v1/'+condition;
export const closeKey=(asset,game)=>'closes/v1/'+asset+'/'+game;
function freezeQuote(q,ex){
 if(!q)return null;
 const sorted=(q.book.asks||[]).filter(a=>Number(a.price)>0&&Number(a.size)>0).sort((a,b)=>Number(a.price)-Number(b.price));
 let shares=0;const asks=[];
 for(const a of sorted){asks.push(a);shares+=Number(a.size);if(ex?.known?shares>=ex.shares-1e-7:asks.length>=10)break;}
 const bids=[...(q.book.bids||[])].sort((a,b)=>Number(b.price)-Number(a.price)).slice(0,1);
 return{quoteAt:q.quoteAt,book:{...copy(q.book,['asset_id','market','timestamp','_fetchedAt']),asks,bids},info:copy(q.info,['fd','mos','ao','t'])};
}
const positionKeys=['wallet','trader','sport','asset','conditionId','outcomeIndex','outcome','eventSlug','title','game','isGame','conv','remainingCost','costBook','costKnown','netShares','scanAt','avgPrice'];
export function freezeRun({runId,job,scan,watchlist,candidates,assessments,quotes,evidenceManifest=[],payload,now=Date.now()}){
 const assessmentMap=new Map(assessments.map(a=>[a.p.wallet+'|'+a.p.asset,a]));
 const freeze=(p,kind)=>{const a=assessmentMap.get(p.wallet+'|'+p.asset),q=quotes.get(p.asset);return{kind,position:copy(p,positionKeys),indicativePrice:p.curPrice??null,quote:freezeQuote(q,a?.ex),assessment:a?{quality:a.q,flow:a.flow,benchmark:a.b,execution:a.ex,consensus:a.cons,edge:a.edge,roi:a.roi,reasons:a.reasons,eligible:a.eligible}:null}};
 return{version:1,policy:POLICY,stage:job.source==='verification'?'verification':'paper',runId,preparedAt:now,scanAsOf:scan.asOf,source:job.source==='verification'?'verification':job.source==='dashboard'?'dashboard':'discord',guildId:job.guildId||null,channelId:job.channelId||null,settings:job.options.settings,sport:job.options.sport,scanComplete:scan.complete,scannedWallets:scan.scannedWallets,rosterCount:job.rosterCount,warnings:scan.warnings,evidenceManifest,entries:[...candidates.map(a=>freeze(a.p,'candidate')),...watchlist.map(p=>freeze(p,'watchlist'))],rejections:assessments.filter(a=>!a.eligible).map(a=>({wallet:a.p.wallet,asset:a.p.asset,conditionId:a.p.conditionId,reasons:a.reasons})),payload,assumptions:'Paper observations at quoted asks and modeled fees/depth; no actual orders or fills. Indicative prices are never used to calculate net paper returns. Model history is retrospective and is not out-of-sample proof. Closing observations use the scheduled game time frozen at detection; reschedules require separate review.'};
}
export async function putPrepared(cache,key,record){
 const previous=await cache.get(key,{type:'json'});
 if(previous){if(previous.runId!==record.runId||previous.policy!==record.policy)throw Error('Journal key conflict');return previous;}
 await cache.put(key,JSON.stringify(record));return record;
}
export function paperSummary({runs=[],publications={},settlements={},closes={}},asOf=Date.now()){
 const sets={candidate:new Map(),watchlist:new Map()},counts={runs:runs.filter(r=>r.stage==='paper').length,verification:runs.filter(r=>r.stage==='verification').length,unpublished:0,partial:0,missingQuote:0};
 for(const run of [...runs].sort((a,b)=>a.preparedAt-b.preparedAt)){
  if(run.stage!=='paper'||run.preparedAt>asOf)continue;
  const receipt=publications[run.runId];if(!receipt?.delivered||!Number.isFinite(receipt.observedAt)||receipt.observedAt<run.preparedAt||receipt.observedAt>asOf){counts.unpublished++;continue;}
  if(!run.scanComplete){counts.partial++;continue;}
  for(const e of run.entries||[]){const p=e.position,q=e.quote;if(!p?.conditionId||!p.asset||p.game<=run.preparedAt||!sets[e.kind])continue;
   const key=run.policy+'|'+gameKey(p);if(sets[e.kind].has(key))continue;
   const ex=e.assessment?.execution;
   if(!q||q.quoteAt>run.preparedAt||run.preparedAt-q.quoteAt>30000||!ex?.known||!ex.filled||!(ex.total>0)||!(ex.shares>0)){counts.missingQuote++;continue;}
   if(e.kind==='candidate'&&!e.assessment?.eligible)continue;
   const r=settlements[p.conditionId],settled=r?.status==='resolved'&&Date.parse(r.resolvedAt)>run.preparedAt&&Date.parse(r.resolvedAt)<=asOf&&Number.isFinite(r.observedAt)&&r.observedAt<=asOf,payout=settled?r.payouts?.[p.outcomeIndex]/1e6:null;
   const valid=settled&&Number.isFinite(payout)&&payout>=0&&payout<=1,close=closes[p.asset+'|'+p.game],point=close?.point;
   const validClose=point&&close.observedAt<=asOf&&point.timestamp*1000>=p.game-15*60000&&(point.timestamp+point.resolution_seconds)*1000<p.game;
   sets[e.kind].set(key,{policy:run.policy,runId:run.runId,preparedAt:run.preparedAt,wallet:p.wallet,sport:p.sport,event:gameKey(p),conditionId:p.conditionId,outcome:p.outcome,settled:valid,payout:valid?payout:null,cost:ex.total,pnl:valid?payout*ex.shares-ex.total:null,clv:validClose?point.price-ex.allIn:null});
  }
 }
 const summarize=rows=>{const done=rows.filter(r=>r.settled),cost=done.reduce((s,r)=>s+r.cost,0),pnl=done.reduce((s,r)=>s+r.pnl,0),clv=done.filter(r=>r.clv!==null);return{signals:rows.length,settled:done.length,cost,pnl,roi:cost?pnl/cost:null,wins:done.filter(r=>r.payout===1).length,closingCoverage:clv.length,meanClv:clv.length?clv.reduce((s,r)=>s+r.clv,0)/clv.length:null}};
 const rows=Object.fromEntries(Object.entries(sets).map(([k,v])=>[k,[...v.values()]]));
 return{asOf,warning:'Paper results, not actual user fills. First executable published observation per policy and game; watchlist baseline and qualified candidates are kept separate. Retrospective imports are excluded.',counts,candidate:summarize(rows.candidate),watchlist:summarize(rows.watchlist),byWallet:Object.fromEntries([...new Set(rows.candidate.map(r=>r.wallet))].map(w=>[w,summarize(rows.candidate.filter(r=>r.wallet===w))])),bySport:Object.fromEntries([...new Set(rows.candidate.map(r=>r.sport))].map(s=>[s,summarize(rows.candidate.filter(r=>r.sport===s))])),rows};
}
