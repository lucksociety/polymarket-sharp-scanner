import {gameKey} from './journal.mjs';
import {scoreLine} from './scorecard.mjs';
const safe=x=>String(x??'').replace(/([\\`*_{}\[\]()<>~|])/g,'\\$1').replace(/@/g,'@\u200b').slice(0,150);
const cents=x=>Number.isFinite(x)?(100*x).toFixed(1)+'¢':'unavailable';
const size=es=>es.reduce((n,e)=>n+(e.title?.length||0)+(e.description?.length||0)+(e.fields||[]).reduce((s,f)=>s+f.name.length+f.value.length,0),0);
const money=x=>'$'+(x>=10000?Math.round(x/1000)+'K':Math.round(x).toLocaleString('en-US'));
const pct=x=>(100*x).toFixed(0)+'%';
// One line of record for a ranked bettor: overall, plus this sport when there is enough of it.
export function recordLine(p){
 const s=p.sharp;if(!s)return null;
 const sport=s.bySport?.[p.sport];
 return `#${s.rank} ${safe(p.trader)}${s.proven?' ✓':''} · ${s.wins}-${s.losses} (${pct(s.winRate)}) at avg ${cents(s.avgPrice)} · ${s.edge>=0?'+':''}${(100*s.edge).toFixed(1)} pts vs price\n`+
  (sport?`${safe(p.sport)} only: ${sport.wins}-${sport.games-sport.wins} (${pct(sport.winRate)}) · ${sport.edge>=0?'+':''}${(100*sport.edge).toFixed(1)} pts`:`Few ${safe(p.sport)} bets on record`);
}
const TIER={High:'🟢 High trust',Solid:'🟡 Solid',Lean:'⚪ Lean'};
export const trustLine=p=>p.trust?`**${TIER[p.trust.tier]||'Unrated'}**${p.trust.estWin!=null?` · est. win chance ${pct(p.trust.estWin)} (price ${cents(p.curPrice)})`:''}`:'Unrated';
export const sizeLine=p=>{const m=p.sizeMultiple;return !Number.isFinite(m)?'Bet size unknown':m>=1.5?`**${m>=10?Math.round(m):m.toFixed(1)}× their usual bet**`:m>=.75?'About their usual bet size':'Smaller than their usual bet';};
// Plain-language note on how the price compares with what the bettor paid.
export function priceNote(p){
 const move=Number.isFinite(p.curPrice)&&Number.isFinite(p.avgPrice)&&p.avgPrice>0?p.curPrice-p.avgPrice:null;
 if(move===null)return 'Price move unknown';
 const c=Math.abs(100*move).toFixed(1)+'¢';
 return move>.0201?`⚠️ Up ${c} since they bought`:move<-.0201?`Now ${c} cheaper than they paid`:'✅ Still near their price';
}
export function scanReport({bets=[],watchlist=[],scan,rosterCount,historyCount=0,historyPending=0,options,assessments=[],quotes=new Map(),ranked=watchlist.some(p=>p.sharp)||scan.positions?.some(p=>p.sharp)||false,scorecard=null,alert=false,now=Date.now()}){
 const candidates=scan.complete?bets.slice(0,options.limit):[];
 const summary={title:'☘ Luck Society · PolySharp',color:0xd4b259,description:(ranked?`Top ${rosterCount} bettors by win rate above the price they paid (last 180 days, pre-game sports bets).`:`Bettor leaderboard unavailable, so this scan used the fixed ${rosterCount}-wallet roster without rankings.`)+`\n${scan.scannedWallets}/${rosterCount} wallets scanned · ${scan.positions.length.toLocaleString()} open positions · ${safe(options.sport)}${scan.complete?'':'\nPartial scan: some wallets could not be loaded.'}${scoreLine(scorecard)?'\n'+scoreLine(scorecard):''}`,fields:[]};
 const qualified={title:'Model-qualified candidates · paper testing',color:0x24844b,fields:[]};
 for(const [i,a] of candidates.entries()){const p=a.p;qualified.fields.push({name:`${i+1}. ${safe(p.title).slice(0,100)}`,value:`**${safe(p.outcome)} · ${safe(p.sport)}**\nAll-in **${cents(a.ex.allIn)}** · lower-model edge **${cents(a.edge)}**\n${safe(p.trader)} · ${a.q.games} prior games in this sport\nQualified support / opposition: ${a.cons.qualified} / ${a.cons.opposingQualified}\nStarts <t:${Math.floor(p.game/1000)}:f>`});}
 const watched=ranked
  ?{title:alert?'🔔 New high-trust bet from a top bettor':'Most trusted bets from the top bettors',color:0x24844b,description:alert?'Just spotted. Win chance is a rough estimate. Past records do not guarantee these win.':`Upcoming games, one bet per game, most trusted first. Trust weighs the bettor's record in that sport, how big the bet is for them, whether other top bettors agree or disagree, and whether the price has moved. Win chance is a rough estimate: the current price plus the edge these bettors have shown. ✓ = record holds up after allowing for luck. Nothing here is guaranteed.`,fields:[]}
  :{title:'Watched positions · not recommendations',color:0x777777,description:'One position per game, ranked by open-book concentration. This percentage measures portfolio concentration, not win probability.',fields:[]};
 const candidateGames=new Set(candidates.map(a=>gameKey(a.p)));let displayed=watchlist.filter(p=>!candidateGames.has(gameKey(p))).slice(0,options.limit);
 for(const [i,p] of displayed.entries()){const a=assessments.find(a=>a.p.wallet===p.wallet&&a.p.asset===p.asset);const q=quotes.get(p.asset),price=a?.ex?.known?a.ex.allIn:null;
  const material=scan.positions.filter(x=>x.conditionId===p.conditionId&&x.netShares>0&&(x.currentValue||0)>=(options.settings?.minValue||1000)&&(x.sharp||x.conv>=(options.settings?.minCostShare||.04)));
  const support=new Set(material.filter(x=>x.outcomeIndex===p.outcomeIndex&&x.wallet!==p.wallet).map(x=>x.wallet)).size,opposition=new Set(material.filter(x=>x.outcomeIndex!==p.outcomeIndex).map(x=>x.wallet)).size;
  const quoted=price!==null?`Buy now about ${cents(price)} all-in${q?.quoteAt?' · <t:'+Math.floor(q.quoteAt/1000)+':R>':''}`:`Now ${cents(p.curPrice)} (indicative)`;
  const value=p.sharp
   ?`**${safe(p.outcome)}** · ${safe(p.sport)}\n${trustLine(p)}\n${recordLine(p)}\n${sizeLine(p)} · ${money(p.remainingCost)} in at ${cents(p.avgPrice)}\n${quoted} · ${priceNote(p)}\nOther top bettors: ${support} with · ${opposition} against\nStarts <t:${Math.floor(p.game/1000)}:f>`
   :`**${safe(p.outcome)} · ${safe(p.sport)}** · ${safe(p.trader)}\n${(100*p.conv).toFixed(1)}% of open book · Indicative ${cents(p.curPrice)}\n${price!==null?`Quoted all-in ${cents(price)}${q?.quoteAt?' · <t:'+Math.floor(q.quoteAt/1000)+':R>':''}`:'Executable entry unavailable'}\nVisible same-market support / opposition: ${support} / ${opposition}\n${safe(a?.reasons?.slice(0,2).join('; ')||'Watchlist only; no recommendation')}\nStarts <t:${Math.floor(p.game/1000)}:f>`;
  watched.fields.push({name:`${i+1}. ${safe(p.title).slice(0,100)}`,value:value.slice(0,1020)});
 }
 if(!watched.fields.length)watched.description+=ranked?'\n\nNone of the top bettors has a bet on an upcoming game that passes the checks right now.':'\nNo additional watched positions match the filters.';
 // Unranked fallback keeps the original three-part layout; ranked scans lead with the bettors' bets.
 if(!ranked&&!qualified.fields.length)qualified.description='No bets passed the evidence, recent-buy, price and exposure checks. No fallback recommendations.'+(historyCount===0?' Complete historical model evidence is not available yet.':'');
 const embeds=alert?[watched]:ranked?[summary,watched,...(qualified.fields.length?[qualified]:[])]:[summary,qualified,watched];
 while(size(embeds)>5700&&watched.fields.length){watched.fields.pop();displayed.pop();}
 while(size(embeds)>5700&&qualified.fields.length){qualified.fields.pop();candidates.pop();}
 return{payload:{content:'[Open the Luck Society dashboard](https://lucksociety.github.io/polymarket-sharp-scanner/)',embeds,allowed_mentions:{parse:[]}},candidates,watchlist:displayed};
}
