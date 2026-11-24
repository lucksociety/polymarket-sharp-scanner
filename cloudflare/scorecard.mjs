// Results of the cards the scanner has posted. Pure functions; the worker supplies KV reads and writes.
// Every figure is a paper result at the price shown when the card was posted. No real orders are placed.
// Rules in force for new cards (journal POLICY). Cards chosen under earlier rules stay in the record but are reported separately.
export const CURRENT='sharp-sport-v2';
export const LEDGER='ledger/v1/',RESULTS='scorecard/v1/results',LATEST='scorecard/v1/latest';
export const ledgerKey=at=>LEDGER+new Date(at).toISOString().slice(0,7);
export const alertKey=p=>'alerted/v1/'+p.wallet+'/'+p.asset;
const game=p=>(p.eventSlug||p.conditionId||p.asset).replace(/-more-markets$/,'');
const fee=p=>.05*p*(1-p);

/** Compact rows for the ledger from a frozen run: one per ranked-bettor card that was posted. */
export function ledgerEntries(record){
 return (record.entries||[]).filter(e=>e.kind==='watchlist'&&e.position?.sharp).map(e=>{const p=e.position,ex=e.assessment?.execution;return{
  runId:record.runId,at:record.preparedAt,policy:record.policy,source:record.source,wallet:p.wallet,trader:p.trader,rank:p.sharp.sports?.[p.sport]?.rank??p.sharp.rank??null,proven:!!(p.sharp.sports?p.sharp.sports[p.sport]?.proven:p.sharp.proven),
  sport:p.sport,sportFit:p.sportFit||null,title:String(p.title||'').slice(0,120),outcome:String(p.outcome||'').slice(0,60),asset:p.asset,conditionId:p.conditionId,outcomeIndex:p.outcomeIndex,
  game:p.game,gameKey:game(p),paid:Number.isFinite(p.avgPrice)?p.avgPrice:null,indicative:Number.isFinite(e.indicativePrice)?e.indicativePrice:null,
  allIn:ex?.known&&ex.filled&&Number.isFinite(ex.allIn)?ex.allIn:null,sizeMultiple:Number.isFinite(p.sizeMultiple)?+p.sizeMultiple.toFixed(2):null,trust:p.trust?.tier||null,estWin:p.trust?.estWin??null};});
}
export function appendLedger(existing,entries){
 const rows=Array.isArray(existing)?existing:[],seen=new Set(rows.map(r=>r.runId+'|'+r.asset));
 return [...rows,...entries.filter(e=>!seen.has(e.runId+'|'+e.asset))];
}
/** The first time each game was posted. Later posts of the same game are repeats, not new bets. */
export function firstPerGame(entries){
 const first=new Map();
 for(const e of [...entries].sort((a,b)=>a.at-b.at))if(e.game>e.at&&!first.has(e.gameKey))first.set(e.gameKey,e);
 return [...first.values()];
}
const blank=()=>({bets:0,wins:0,losses:0,pending:0,profit:0});
function add(g,e,payout,cost){
 if(payout===null){g.pending++;return;}
 g.bets++;if(payout===1)g.wins++;else g.losses++;g.profit+=100*(payout/cost-1);
}
const finish=g=>({bets:g.bets,wins:g.wins,losses:g.losses,pending:g.pending,winRate:g.bets?g.wins/g.bets:null,profitPer100:g.bets?+(g.profit/g.bets).toFixed(2):null});
/** results: {conditionId: payouts[]} for resolved markets. */
export function summarize(entries,results={},now=Date.now()){
 const overall=blank(),groups={rules:{},trust:{},tier:{},sport:{},size:{},price:{},source:{},bettor:{}},recent=[];let approx=0,skipped=0;
 const bump=(kind,name,e,payout,cost)=>add(groups[kind][name]||=blank(),e,payout,cost);
 const cards=firstPerGame(entries);
 for(const e of cards){
  const cost=e.allIn??(Number.isFinite(e.indicative)&&e.indicative>0&&e.indicative<1?e.indicative+fee(e.indicative):null);
  if(!(cost>0&&cost<1.05)){skipped++;continue;}
  const pay=results[e.conditionId]?.[e.outcomeIndex],settled=pay===0||pay===1e6;
  if(results[e.conditionId]&&!settled){skipped++;continue;}                 // void or split result: neither a win nor a loss
  const payout=settled?pay/1e6:null;
  if(e.allIn==null)approx++;
  add(overall,e,payout,cost);
  // Results are kept apart by the rules that chose the card, so a rule change can be judged on its own bets.
  bump('rules',e.policy===CURRENT?'Current rules':'Earlier rules',e,payout,cost);
  bump('bettor',String(e.trader||'Unknown').slice(0,40),e,payout,cost);
  bump('trust',e.trust==='High'?'High trust':e.trust==='Solid'?'Solid':e.trust==='Lean'?'Lean':'Before trust ratings',e,payout,cost);
  bump('tier',e.proven?'Proven ✓':e.policy===CURRENT?'Listed, not proven':'Leading',e,payout,cost);
  bump('sport',e.sport||'Unknown',e,payout,cost);
  bump('size',e.sizeMultiple>=5?'5× or more':e.sizeMultiple>=3?'3–5×':e.sizeMultiple>=2?'2–3×':'Under 2×',e,payout,cost);
  const move=Number.isFinite(e.indicative)&&Number.isFinite(e.paid)?e.indicative-e.paid:null;
  bump('price',move===null?'Unknown':move>.0201?'Price had moved up':move<-.0201?'Cheaper than they paid':'Near their price',e,payout,cost);
  bump('source',e.source==='alert'?'Alerts':'Scans',e,payout,cost);
  if(payout!==null)recent.push({game:e.game,title:e.title,outcome:e.outcome,trader:e.trader,rank:e.rank,sport:e.sport,won:payout===1,cost:+cost.toFixed(3)});
 }
 const tidy=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,finish(v)]).sort((a,b)=>b[1].bets-a[1].bets));
 return{version:1,generatedAt:new Date(now).toISOString(),since:cards.length?new Date(Math.min(...cards.map(e=>e.at))).toISOString():null,overall:finish(overall),
  byRules:tidy(groups.rules),byBettor:tidy(groups.bettor),byTrust:tidy(groups.trust),byTier:tidy(groups.tier),bySport:tidy(groups.sport),bySize:tidy(groups.size),byPrice:tidy(groups.price),bySource:tidy(groups.source),
  recent:recent.sort((a,b)=>b.game-a.game).slice(0,10),approxPriced:approx,skipped,
  note:'Paper results: $100 on the first card posted for each game, at the price shown when it was posted, held to the result. Not real bets.'};
}
const usd=x=>(x>=0?'+$':'−$')+Math.abs(x).toFixed(2);
const day=iso=>new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/New_York'});
const line=g=>g.bets?`${g.wins}-${g.losses} · ${usd(g.profitPer100)} per $100${g.pending?` · ${g.pending} pending`:''}`:`no results yet${g.pending?` · ${g.pending} pending`:''}`;
/** One line for the scan report, or null when nothing has been posted yet. */
export function scoreLine(s){
 if(!s?.overall||!(s.overall.bets+s.overall.pending>0)||!s.since)return null;
 const cur=s.byRules?.['Current rules'],old=s.byRules?.['Earlier rules'];
 if(cur&&old&&cur.bets+cur.pending>0)return `Paper record under the current rules: ${line(cur)} · earlier rules: ${line(old)}`;
 return `Paper record since ${day(s.since)}: ${line(s.overall)}`;
}
const safe=x=>String(x??'').replace(/([\\`*_{}\[\]()<>~|])/g,'\\$1').replace(/@/g,'@\u200b').slice(0,90);
export function scorecardPayload(s){
 const block=o=>Object.entries(o||{}).slice(0,8).map(([k,g])=>`**${safe(k)}:** ${line(g)}`).join('\n')||'—';
 const fields=[...(s.byRules&&Object.keys(s.byRules).length>1?[{name:'By rules',value:block(s.byRules)}]:[]),{name:'By trust rating',value:block(s.byTrust)},{name:'By bettor tier',value:block(s.byTier)},{name:'By sport',value:block(s.bySport)},{name:'By bet size',value:block(s.bySize)},{name:'By price when posted',value:block(s.byPrice)},...(s.byBettor?[{name:'By bettor (most cards first)',value:block(s.byBettor)}]:[])];
 if(s.recent?.length)fields.push({name:'Latest results',value:s.recent.slice(0,8).map(r=>`${r.won?'✅':'❌'} ${safe(r.outcome)} (${(100*r.cost).toFixed(0)}¢) · #${r.rank} ${safe(r.trader)}`).join('\n').slice(0,1020)});
 return{content:'[Open the Luck Society dashboard](https://lucksociety.github.io/polymarket-sharp-scanner/)',embeds:[{title:'📊 PolySharp scorecard',color:0xd4b259,
  description:`${s.since?`Since ${day(s.since)}: `:''}**${line(s.overall)}**\n${s.note}`,fields:fields.map(f=>({...f,value:f.value.slice(0,1020)}))}],allowed_mentions:{parse:[]}};
}
