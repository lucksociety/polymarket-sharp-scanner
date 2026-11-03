/* Pure screening calculations. No credentials or order submission. */
(function(root) {
  'use strict';
  const number = x => x !== null && x !== '' && x !== undefined && Number.isFinite(Number(x));
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const median = xs => { const s=[...xs].sort((a,b)=>a-b),n=s.length; return n ? (s[Math.floor(n/2)]+s[Math.floor((n-1)/2)])/2 : null; };
  const key = p => `${p.conditionId}|${p.outcomeIndex}`;
  function position(p) {
    return {...p, asset:p.token_id, conditionId:p.condition_id, size:p.current_size,
      avgPrice:p.avg_price, curPrice:p.current_price, currentValue:p.current_value,
      entryCost:p.entry_cost_usdc, totalCost:p.total_cost_usdc, eventSlug:p.event_slug,
      outcomeIndex:p.outcome_index, endDate:p.end_date, firstEntry:p.first_entry_at,
      lastEvent:p.last_event_at, oppositeAsset:p.opposite_token_id};
  }
  async function pages(get,url,{maxPages=100}={}) {
    const rows=[],seen=new Set(); let cursor=null;
    for(let i=0;i<maxPages;i++) {
      const u=new URL(url); if(cursor) u.searchParams.set('cursor',cursor);
      const result=await get(u.href);
      if(!Array.isArray(result?.data) || !result.pagination || !Object.hasOwn(result.pagination,'next_cursor')) throw Error('Invalid v2 page envelope');
      rows.push(...result.data); cursor=result.pagination.next_cursor;
      if(cursor===null) return rows;
      if(typeof cursor!=='string'||!cursor||seen.has(cursor)) throw Error('Invalid/repeated pagination cursor');
      seen.add(cursor);
    }
    throw Error('Page limit reached; incomplete data excluded');
  }
  function exposure(rows) {
    const byAsset=new Map(rows.map(p=>[p.asset,p]));
    const costBook=rows.reduce((s,p)=>s+(number(p.entryCost)?+p.entryCost:0),0);
    const costKnown=rows.every(x=>number(x.entryCost)&&+x.entryCost>=0);
    return rows.map(p=>{
      const other=byAsset.get(p.oppositeAsset);
      const paired=other?Math.min(+p.size,+other.size):0;
      const netShares=Math.max(0,+p.size-paired);
      const remainingCost=number(p.entryCost)&&p.size>0 ? +p.entryCost*netShares/p.size : null;
      return {...p,paired,hedged:paired>0,netShares,remainingCost,costBook,
        costKnown,conv:costBook>0&&remainingCost!==null?remainingCost/costBook:0};
    });
  }
  function topConviction(rows,{now=Date.now(),limit=8,minBook=25000}={}) {
    const best=new Map();
    for(const p of rows){
      if(!p.isGame||!Number.isFinite(p.game)||p.game<=now||!(p.netShares>0)||p.costKnown===false||!(p.costBook>=minBook)||!Number.isFinite(p.conv))continue;
      const k=(p.wallet||p.trader)+'|'+p.conditionId;
      if(!best.has(k)||best.get(k).conv<p.conv)best.set(k,p);
    }
    return [...best.values()].sort((a,b)=>b.conv-a.conv).slice(0,limit);
  }
  function recentFlow(p,activity,now,minutes=120) {
    const from=now-minutes*60000;
    const rows=activity.filter(a=>a.token_id===p.asset&&a.type==='TRADE'&&a.timestamp*1000>=from&&a.timestamp*1000<=now);
    const buys=rows.filter(a=>a.side==='BUY');
    const buy=buys.reduce((s,a)=>s+(+a.size||0),0),sell=rows.filter(a=>a.side==='SELL').reduce((s,a)=>s+(+a.size||0),0);
    return {buy,sell,net:buy-sell,lastBuy:buys.length?Math.max(...buys.map(a=>a.timestamp*1000)):null,
      fresh:buy>sell&&buy>0,latestBuyPrice:buys.sort((a,b)=>b.timestamp-a.timestamp)[0]?.price??null};
  }
  function validateEvidence(input) {
    if(!input||input.version!==1) throw Error('Evidence must have version: 1');
    const odds=input.odds??[],history=input.history??[],clusters=input.clusters??{};
    if(!Array.isArray(odds)||!Array.isArray(history)||typeof clusters!=='object'||Array.isArray(clusters)||clusters===null) throw Error('Invalid evidence collections');
    if(odds.length>20000||history.length>100000) throw Error('Evidence file too large');
    const wallet=/^0x[0-9a-f]{40}$/i,condition=/^0x[0-9a-f]{64}$/i;
    for(const r of odds) {
      if(!condition.test(r.conditionId)||!r.source?.trim()||!Number.isFinite(Date.parse(r.asOf))||
        !Array.isArray(r.outcomes)||r.outcomes.length<2||!Array.isArray(r.decimalOdds)||r.outcomes.length!==r.decimalOdds.length||
        r.outcomes.some(x=>typeof x!=='string'||!x.trim())||new Set(r.outcomes.map(x=>x.toLowerCase())).size!==r.outcomes.length||
        r.decimalOdds.some(x=>!number(x)||+x<=1)||typeof r.rulesConfirmed!=='boolean'||!r.rules?.trim()) throw Error('Invalid odds row: require conditionId, source, asOf, outcomes, decimalOdds, rules, rulesConfirmed');
    }
    for(const r of history) {
      if(!wallet.test(r.wallet)||!r.sport?.trim()||!r.eventId?.trim()||!r.source?.trim()||r.costsIncluded!==true||
        !Number.isFinite(Date.parse(r.entryAt))||!Number.isFinite(Date.parse(r.settledAt))||Date.parse(r.entryAt)>=Date.parse(r.settledAt)||
        !number(r.stake)||+r.stake<=0||!number(r.pnlNet)||+r.pnlNet < -r.stake||
        !number(r.entryAllIn)||+r.entryAllIn<=0||+r.entryAllIn>=1||!number(r.closingProbability)||+r.closingProbability<=0||+r.closingProbability>=1)
        throw Error('Invalid history row: require sport, eventId, wallet, source, entryAt, settledAt, stake, pnlNet, entryAllIn, closingProbability, costsIncluded:true');
      if(r.model===true&&(!(r.payout===0||r.payout===1)||!number(r.feeAssumption)||r.feeAssumption<0||r.feeAssumption>.25))throw Error('Invalid modeled history assumptions');
    }
    for(const [w,c] of Object.entries(clusters)) if(!wallet.test(w)||typeof c!=='string'||!c.trim()) throw Error('Invalid wallet cluster');
    return {version:1,odds,history,clusters:Object.fromEntries(Object.entries(clusters).map(([w,c])=>[w.toLowerCase(),c.trim()]))};
  }
  function quality(wallet,sport,history,asOf,minGames=100) {
    // Only evidence settled before the signal can qualify that signal. Aggregate by game.
    const rs=history.filter(r=>r.wallet.toLowerCase()===wallet.toLowerCase()&&r.sport===sport&&Date.parse(r.settledAt)<asOf&&Date.parse(r.entryAt)<asOf&&r.costsIncluded);
    const games=new Map();
    for(const r of rs) {
      const g=games.get(r.eventId)||{stake:0,pnl:0,clv:0,first:Infinity,last:0};
      g.stake+=+r.stake;g.pnl+=+r.pnlNet;g.clv+=(r.closingProbability-r.entryAllIn)*r.stake;
      g.first=Math.min(g.first,Date.parse(r.entryAt));g.last=Math.max(g.last,Date.parse(r.settledAt));games.set(r.eventId,g);
    }
    const gs=[...games.values()],stake=gs.reduce((s,g)=>s+g.stake,0),pnl=gs.reduce((s,g)=>s+g.pnl,0);
    const clv=stake?gs.reduce((s,g)=>s+g.clv,0)/stake:null;
    const span=gs.length?(Math.max(...gs.map(g=>g.last))-Math.min(...gs.map(g=>g.first)))/864e5:0;
    const largestWin=gs.length?Math.max(0,...gs.map(g=>g.pnl)):0;
    const qualified=gs.length>=minGames&&span>=90&&pnl>0&&clv>0&&pnl-largestWin>0;
    const modeled=rs.some(r=>r.model===true);
    return {games:gs.length,stake,pnl,roi:stake?pnl/stake:null,clv,span,qualified,modeled,
      label:qualified?(modeled?'Model-qualified':'Evidence-qualified'):gs.length?'Insufficient evidence':'Unverified',weight:qualified?clamp(gs.length/200,.5,1):0};
  }
  function benchmark(p,odds,now,{maxAge=15*60000,buffer=.02,minBooks=2}={}) {
    const bySource=new Map();
    for(const r of odds) {
      const ts=Date.parse(r.asOf),i=r.outcomes.findIndex(o=>o.toLowerCase()===p.outcome.toLowerCase());
      if(r.conditionId!==p.conditionId||!r.rulesConfirmed||i<0||now-ts>maxAge||ts>now) continue;
      const source=r.source.trim().toLowerCase(),prev=bySource.get(source);
      if(!prev||Date.parse(prev.asOf)<ts) bySource.set(source,r);
    }
    const rs=[...bySource.values()];
    if(rs.length<minBooks)return {known:false,books:rs.length,reason:`Need ${minBooks} current, rules-matched books`};
    const probs=rs.map(r=>{const inv=r.decimalOdds.map(x=>1/x);return inv[r.outcomes.findIndex(o=>o.toLowerCase()===p.outcome.toLowerCase())]/inv.reduce((a,b)=>a+b,0);});
    const fair=median(probs),low=clamp(Math.min(...probs)-buffer,0,1);
    return {known:true,books:rs.length,fair,low,asOf:Math.min(...rs.map(r=>Date.parse(r.asOf))),sources:rs.map(r=>r.source)};
  }
  function feeParams(info) {
    if(number(info?.fd?.r)&&number(info?.fd?.e)&&+info.fd.r>=0&&+info.fd.e>=0) return {rate:+info.fd.r,exponent:+info.fd.e};
    // Never infer a fee-free market from missing fields or a category-wide default.
    return null;
  }
  function modelBenchmark(p,history,now,price,{buffer=.02,minGames=100}={}) {
    if(!number(price))return {known:false,books:0,reason:'Executable quote required for model price bucket'};
    const rows=history.filter(r=>r.model===true&&r.wallet.toLowerCase()===p.wallet.toLowerCase()&&r.sport===p.sport&&Date.parse(r.settledAt)<now&&Date.parse(r.entryAt)<now&&
      Math.abs(r.entryAllIn-price)<=.1&&(r.payout===0||r.payout===1));
    const games=new Map();for(const r of rows)if(!games.has(r.eventId))games.set(r.eventId,r);
    const rs=[...games.values()],n=rs.length;
    if(n<minGames)return {known:false,books:0,model:true,reason:`Polymarket model needs ${minGames} prior games within ±10¢ of this entry price (${n} available)`};
    const wins=rs.reduce((s,r)=>s+r.payout,0),fair=wins/n,z=1.96;
    const lower=(fair+z*z/(2*n)-z*Math.sqrt(fair*(1-fair)/n+z*z/(4*n*n)))/(1+z*z/n);
    return {known:true,model:true,books:0,games:n,fair,low:clamp(lower-buffer,0,1),asOf:Math.max(...rs.map(r=>Date.parse(r.settledAt))),sources:['Polymarket historical first-buy model']};
  }
  function execution(book,info,budget,now) {
    const fp=feeParams(info),stamp=Number(book?.timestamp);
    if(!fp)return {known:false,reason:'Market fee parameters unavailable'};
    if(!number(budget)||budget<=0)return {known:false,reason:'Invalid order budget'};
    // The timestamp is the last book update, not a heartbeat. Fetch time is checked by caller.
    if(!Number.isFinite(stamp)||stamp>now+5000)return {known:false,reason:'Invalid book timestamp'};
    const asks=(book.asks||[]).filter(x=>number(x.price)&&+x.price>0&&+x.price<1&&number(x.size)&&+x.size>0).sort((a,b)=>a.price-b.price);
    if(!asks.length)return {known:false,reason:'No executable asks'};
    const bids=(book.bids||[]).filter(x=>number(x.price)&&+x.price>0&&+x.price<1).map(x=>+x.price);
    if(bids.length&&Math.max(...bids)>=+asks[0].price)return {known:false,reason:'Crossed order book; refresh'};
    let remaining=+budget,cost=0,shares=0,fees=0,worst=0;
    for(const a of asks) {
      const price=+a.price,fee=fp.rate*Math.pow(price*(1-price),fp.exponent),unit=price+fee;
      const n=Math.min(+a.size,remaining/unit);
      if(n<=0)break;
      shares+=n;cost+=n*price;fees+=n*fee;remaining-=n*unit;worst=price;
      if(remaining<1e-8)break;
    }
    // Round fee upward at the documented five-decimal precision.
    fees=Math.ceil((fees-1e-10)*1e5)/1e5;
    // Fee rounding must not push a supposedly budget-sized fill over its cash cap.
    if(cost+fees>budget&&worst>0){const excess=cost+fees-budget;shares-=excess/worst;cost-=excess;}
    const filled=remaining<.0001, minOrder=number(info.mos)?+info.mos:null;
    if(minOrder===null)return {known:false,reason:'Minimum order size unavailable'};
    if(shares<minOrder)return {known:false,reason:`Below minimum ${minOrder} shares`};
    return {known:true,filled,shares,cost,fees,total:cost+fees,allIn:(cost+fees)/shares,
      bestAsk:+asks[0].price,worst,slippage:cost/shares-asks[0].price,
      spread:bids.length?+asks[0].price-Math.max(...bids):null,fee:fp,bookAt:stamp,reason:filled?'':'Insufficient depth for full budget'};
  }
  function consensus(rows,evidence,asOf,{minGames=100}={}) {
    const markets=new Map();
    for(const p of rows) {
      if(!p.conditionId||p.outcomeIndex===999||!p.costKnown||!(p.netShares>0))continue;
      const q=quality(p.wallet,p.sport,evidence.history,asOf,minGames);
      const cluster=evidence.clusters[p.wallet.toLowerCase()]||p.wallet.toLowerCase();
      const sides=markets.get(p.conditionId)||new Map(),side=sides.get(p.outcomeIndex)||new Map();
      const weight=q.weight*Math.min(.1,p.conv)/.1;
      const prev=side.get(cluster);
      if(!prev||prev.weight<weight)side.set(cluster,{wallet:p.wallet,trader:p.trader,weight,qualified:q.qualified,conv:p.conv});
      sides.set(p.outcomeIndex,side);markets.set(p.conditionId,sides);
    }
    const out=new Map();
    for(const [condition,sides] of markets)for(const [idx,side] of sides){
      const supporters=[...side.values()],opponents=[...sides].filter(([i])=>i!==idx).flatMap(([,m])=>[...m.values()]);
      const qualified=supporters.filter(x=>x.qualified),opposingQualified=opponents.filter(x=>x.qualified);
      const supportWeight=qualified.reduce((a,p)=>a+p.weight,0),opposeWeight=opposingQualified.reduce((a,p)=>a+p.weight,0);
      const conflict=new Set(opponents.map(p=>evidence.clusters[p.wallet.toLowerCase()]||p.wallet.toLowerCase()));
      const independent=qualified.filter(p=>!conflict.has(evidence.clusters[p.wallet.toLowerCase()]||p.wallet.toLowerCase()));
      out.set(`${condition}|${idx}`,{supporters,opponents,qualified:independent.length,opposingQualified:opposingQualified.length,supportWeight,opposeWeight,netWeight:supportWeight-opposeWeight});
    }
    return out;
  }
  function assess(p,{evidence,now,book,info,quoteAt,activity,settings,cons}) {
    const q=quality(p.wallet,p.sport,evidence.history,now,settings.minGames);
    const flow=recentFlow(p,activity||[],now,settings.freshMinutes);
    const ex=execution(book,info,settings.budget,now),reasons=[];
    const b=settings.benchmarkMode==='polymarket'?modelBenchmark(p,evidence.history,now,ex.known?ex.allIn:null,{buffer:settings.buffer,minGames:settings.minGames}):benchmark(p,evidence.odds,now,{buffer:settings.buffer});
    if(!p.isGame||p.game<=now)reasons.push('Upcoming games only');
    if(!p.costKnown||!(p.netShares>0))reasons.push('No verified net directional exposure');
    if(!q.qualified)reasons.push(q.label);
    if(!flow.fresh)reasons.push('No recent net buying');
    if(!cons||cons.qualified<settings.minSharps||cons.netWeight<=0)reasons.push('Insufficient net qualified support');
    if(cons?.opposingQualified>settings.maxOpposition)reasons.push('Qualified opposition exceeds limit');
    if(!b.known)reasons.push(b.reason);
    if(!ex.known)reasons.push(ex.reason);
    else if(!ex.filled)reasons.push(ex.reason);
    if(!quoteAt||now-quoteAt>30000||quoteAt>now)reasons.push('Refresh executable quote');
    if(!p.scanAt||now-p.scanAt>5*60000)reasons.push('Rescan positions and activity');
    const edge=b.known&&ex.known?b.low-ex.allIn:null,roi=edge!==null?edge/ex.allIn:null;
    if(edge!==null&&edge<settings.minEdge)reasons.push('Conservative edge below minimum');
    if(b.known&&b.low<settings.minWin)reasons.push('Estimated win probability below minimum');
    if(ex.known&&(!number(ex.spread)||ex.spread>settings.maxSpread))reasons.push('Spread too wide or bid missing');
    return {p,b,q,flow,ex,cons,edge,roi,reasons,eligible:reasons.length===0};
  }
  const api={number,median,key,position,pages,exposure,topConviction,recentFlow,validateEvidence,quality,benchmark,modelBenchmark,feeParams,execution,consensus,assess};
  root.SharpEngine=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis==='undefined'?this:globalThis);
