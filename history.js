/* Polymarket-only observational history. This is a hypothetical hold model,
   never an assertion about a wallet's actual account P&L or copier fills. */
const PolymarketHistory={
  async build({traders,get,pool,data,gamma,feeRate=.05,maxPages=100,asOf=Date.now(),classifySport=classify,onProgress=()=>{}}){
    const now=asOf,start=Math.floor(now/1000)-180*86400,end=Math.floor(now/1000);
    const warnings=[],counts={traders:0,activity:0,candidates:0,records:0,missingClose:0,failedWallets:0};
    const cohorts=await pool(traders,2,async t=>{
      try{
        const rows=await SharpEngine.pages(get,`${data}/v2/activity?user=${t.wallet}&type=TRADE&start=${start}&end=${end}&sort_direction=ASC&limit=1000`,{maxPages});
        counts.activity+=rows.length;
        const sides=new Map(),first=new Map();
        for(const a of rows){
          if(a.side!=='BUY'||a.is_combo||a.outcome_index===999||!a.condition_id||!(a.price>0&&a.price<1)||!(a.size>0))continue;
          const set=sides.get(a.condition_id)||new Set();set.add(a.token_id);sides.set(a.condition_id,set);
          const k=a.condition_id+'|'+a.token_id;if(!first.has(k)||first.get(k).timestamp>a.timestamp)first.set(k,a);
        }
        // Both-side purchasers are excluded, including hedges opened at different times.
        return [...first.values()].filter(a=>sides.get(a.condition_id).size===1).map(a=>({...a,wallet:t.wallet,trader:t.name}));
      }catch(e){counts.failedWallets++;warnings.push(`${t.name}: complete 180-day trade history unavailable (${e.message}); excluded`);return [];}
      finally{counts.traders++;onProgress(`History: ${counts.traders}/${traders.length} wallets · ${counts.activity} trade rows read`);}
    });
    const candidates=cohorts.flat();counts.candidates=candidates.length;
    const slugs=[...new Set(candidates.map(a=>a.event_slug).filter(Boolean))],events=new Map();
    const chunks=[];for(let i=0;i<slugs.length;i+=40)chunks.push(slugs.slice(i,i+40));
    await pool(chunks,2,async chunk=>{
      try{const es=await get(`${gamma}/events?${chunk.map(s=>'slug='+encodeURIComponent(s)).join('&')}&limit=100`);for(const e of es)events.set(e.slug,e);}
      catch(e){warnings.push('Historical event metadata unavailable: '+e.message);}
    });
    const valid=candidates.map(a=>{
      const event=events.get(a.event_slug),market=event?.markets?.find(m=>m.conditionId===a.condition_id);
      const game=market?.gameStartTime?Date.parse(market.gameStartTime):NaN;
      if(!Number.isFinite(game)||a.timestamp*1000>=game||game>=now)return null;
      const sport=classifySport((event.tags||[]).map(t=>t.slug),event.slug);
      if(sport==='Non-sports')return null;
      return {...a,game,sport};
    }).filter(Boolean);
    const conditions=[...new Set(valid.map(a=>a.condition_id))],resolutions=new Map();
    const condChunks=[];for(let i=0;i<conditions.length;i+=20)condChunks.push(conditions.slice(i,i+20));
    await pool(condChunks,2,async chunk=>{
      try{const result=await get(`${data}/v2/resolutions?condition=${chunk.join(',')}`);for(const r of result.data||[])if(r.status==='resolved'&&Array.isArray(r.payouts)&&r.resolved_at)resolutions.set(r.condition_id,r);}
      catch(e){warnings.push('Historical resolution request failed: '+e.message);}
    });
    const closeCache=new Map();
    const resolved=valid.filter(a=>{const r=resolutions.get(a.condition_id);return r&&Date.parse(r.resolved_at)<=now&&(r.payouts[a.outcome_index]===0||r.payouts[a.outcome_index]===1000000);});
    let done=0;
    const records=await pool(resolved,3,async a=>{
      try{
        const cacheKey=a.token_id+'|'+a.game;
        if(!closeCache.has(cacheKey))closeCache.set(cacheKey,(async()=>{
          const r=await get(`${data}/v2/prices-history?token_id=${a.token_id}&as_of=${Math.floor(a.game/1000)-1}`);
          return (r.data||[]).filter(x=>Number.isFinite(x.resolution_seconds)&&x.resolution_seconds>=0&&x.timestamp*1000>=a.game-15*60000&&
            (x.timestamp+x.resolution_seconds)*1000<a.game&&x.price>0&&x.price<1).sort((x,y)=>y.timestamp-x.timestamp)[0]||null;
        })());
        const close=await closeCache.get(cacheKey);if(!close){counts.missingClose++;return null;}
        const r=resolutions.get(a.condition_id),payout=r.payouts[a.outcome_index]/1e6;
        const entryAllIn=a.price+feeRate*a.price*(1-a.price);
        // Fixed $100 hypothetical entries prevent whale size from dominating performance.
        const stake=100,pnlNet=stake*(payout/entryAllIn-1);
        return {wallet:a.wallet,sport:a.sport,eventId:a.event_slug||a.condition_id,source:'Polymarket v2 observed buy + resolution + pregame price',
          entryAt:new Date(a.timestamp*1000).toISOString(),settledAt:r.resolved_at,stake,pnlNet,entryAllIn,closingProbability:close.price,costsIncluded:true,
          model:true,payout,entryPrice:a.price,feeAssumption:feeRate,gameAt:a.game,conditionId:a.condition_id,token:a.token_id,
          tradeHash:a.transaction_hash,closingPoint:close,resolution:r,
          assumptions:'First observed BUY within 180-day window; hold to resolution at trader price; hypothetical fixed $100; assumed fee curve rate p(1-p). Not actual wallet profit or a historical copier fill.'};
      }catch(e){warnings.push('Historical price unavailable for '+a.token_id+': '+e.message);return null;}
      finally{done++;onProgress(`History: pricing ${done}/${resolved.length} resolved pregame entries`);}
    });
    counts.records=records.filter(Boolean).length;
    if(counts.missingClose)warnings.push(`${counts.missingClose} entries excluded: no strictly pregame closing observation within 15 minutes. Older fine-grained prices may be outside retention.`);
    return {records:records.filter(Boolean),warnings,counts,builtAt:now,windowStart:start*1000,feeRate};
  }
};
if(typeof module!=='undefined')module.exports=PolymarketHistory;
