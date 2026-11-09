import {gameKey} from './journal.mjs';
const safe=x=>String(x??'').replace(/([\\`*_{}\[\]()<>~|])/g,'\\$1').replace(/@/g,'@\u200b').slice(0,150);
const cents=x=>Number.isFinite(x)?(100*x).toFixed(1)+'¢':'unavailable';
const size=es=>es.reduce((n,e)=>n+(e.title?.length||0)+(e.description?.length||0)+(e.fields||[]).reduce((s,f)=>s+f.name.length+f.value.length,0),0);
export function scanReport({bets=[],watchlist=[],scan,rosterCount,historyCount=0,historyPending=0,options,assessments=[],quotes=new Map(),now=Date.now()}){
 const candidates=scan.complete?bets.slice(0,options.limit):[];
 const summary={title:'☘ Luck Society · Sports scanner',color:0xd4b259,description:`${scan.scannedWallets}/${rosterCount} wallets scanned · ${scan.positions.length.toLocaleString()} positions · ${safe(options.sport)}\n${scan.complete?'Complete roster scan.':'Partial scan: no candidates qualify.'}\nPaper testing: historical model estimates have not established forward profitability.`,fields:[{name:'Evidence',value:`${historyCount} modeled historical observations available; ${historyPending} wallet histories requested; existing jobs may be reused. A winning lifetime account does not qualify every sport.`}]};
 const qualified={title:'Qualified model candidates · paper testing',color:0x24844b,fields:[]};
 for(const [i,a] of candidates.entries()){const p=a.p;qualified.fields.push({name:`${i+1}. ${safe(p.title).slice(0,100)}`,value:`**${safe(p.outcome)} · ${safe(p.sport)}**\nAll-in **${cents(a.ex.allIn)}** · lower-model edge **${cents(a.edge)}**\n${safe(p.trader)} · ${a.q.games} prior games in this sport\nQualified support / opposition: ${a.cons.qualified} / ${a.cons.opposingQualified}\nStarts <t:${Math.floor(p.game/1000)}:f>`});}
 if(!qualified.fields.length)qualified.description='No bets passed the evidence, recent-buy, price and exposure checks. No fallback recommendations.'+(historyCount===0?' Complete historical model evidence is not available yet.':'');
 const watched={title:'Watched positions · not recommendations',color:0x777777,description:'One position per game, ranked by open-book concentration. This percentage measures portfolio concentration, not win probability.',fields:[]};
 const candidateGames=new Set(candidates.map(a=>gameKey(a.p)));let displayed=watchlist.filter(p=>!candidateGames.has(gameKey(p))).slice(0,options.limit);
 for(const [i,p] of displayed.entries()){const a=assessments.find(a=>a.p.wallet===p.wallet&&a.p.asset===p.asset);const q=quotes.get(p.asset),price=a?.ex?.known?a.ex.allIn:null;const material=scan.positions.filter(x=>x.conditionId===p.conditionId&&x.netShares>0&&(x.currentValue||0)>=(options.settings?.minValue||1000)&&x.conv>=(options.settings?.minCostShare||.04));const support=new Set(material.filter(x=>x.outcomeIndex===p.outcomeIndex).map(x=>x.wallet)).size,opposition=new Set(material.filter(x=>x.outcomeIndex!==p.outcomeIndex).map(x=>x.wallet)).size;
  watched.fields.push({name:`${i+1}. ${safe(p.title).slice(0,100)}`,value:`**${safe(p.outcome)} · ${safe(p.sport)}** · ${safe(p.trader)}\n${(100*p.conv).toFixed(1)}% of open book · Indicative ${cents(p.curPrice)}\n${price!==null?`Quoted all-in ${cents(price)}${q?.quoteAt?' · <t:'+Math.floor(q.quoteAt/1000)+':R>':''}`:'Executable entry unavailable'}\nVisible same-market support / opposition: ${support} / ${opposition}\n${safe(a?.reasons?.slice(0,2).join('; ')||'Watchlist only; no recommendation')}\nStarts <t:${Math.floor(p.game/1000)}:f>`});
 }
 if(!watched.fields.length)watched.description+='\nNo additional watched positions match the filters.';
 const embeds=[summary,qualified,watched];
 while(size(embeds)>5700&&watched.fields.length){watched.fields.pop();displayed.pop();}
 while(size(embeds)>5700&&qualified.fields.length){qualified.fields.pop();candidates.pop();}
 return{payload:{content:'[Open the Luck Society dashboard](https://lucksociety.github.io/polymarket-sharp-scanner/)',embeds,allowed_mentions:{parse:[]}},candidates,watchlist:displayed};
}
