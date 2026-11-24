import E from '../engine.js';
import History from '../history.js';
import {CORE,SPORTS,classify} from './roster.mjs';
export {CORE,SPORTS};
export const DATA='https://data-api.polymarket.com',GAMMA='https://gamma-api.polymarket.com',CLOB='https://clob.polymarket.com';
// Daily bettor leaderboard built by scripts/leaderboard.mjs (GitHub Actions) and committed to main.
export const LEADERBOARD='https://raw.githubusercontent.com/lucksociety/polymarket-sharp-scanner/main/data/leaderboard.json';
// A ranked bettor's bet counts when it is at least their usual size and worth $200 or more.
export const SHARP={minMultiple:1,minValue:200,minSmall:25,maxAgeDays:4,minListed:5,maxWallets:60,maxCredit:.08};
// A bettor's record in one sport, from the daily leaderboard. null when they are not listed in that sport.
export const sportRecord=(s,sport)=>s?.sports?.[sport]||null;
// Edge credited to a bettor in this sport. It comes from their record in that sport only, already marked down for luck by the
// leaderboard job. Outside the sports they are listed in, or once they have clearly lost since being listed, it is zero.
export function expectedEdge(s,sport){
 const r=sportRecord(s,sport);
 return r&&!r.cold&&Number.isFinite(r.credit)?Math.max(0,Math.min(SHARP.maxCredit,r.credit)):0;
}
/** Trust in one bet: the bettor's credited edge in this sport, raised for a bigger-than-usual bet and for other listed bettors in the
 *  sport on the same side, lowered for listed bettors on the other side and for any rise in price since the bettor bought.
 *  High   = a record too good to be luck, a bet at least their usual size, nobody listed against.
 *  Solid  = positive after all of the above, and either proven, at least twice their usual bet, or backed by another listed bettor.
 *  Lean   = anything else that is still positive. Lean bets are not posted. */
export function trust(p,rows,settings={}){
 if(!p.sharp)return null;
 const seen=new Set([p.wallet]);let withE=0,againstE=0,withN=0,againstN=0;
 for(const x of rows){
  if(x.conditionId!==p.conditionId||!x.sharp||!(x.netShares>0)||!((x.currentValue||0)>=sharpFloor(x,settings))||seen.has(x.wallet))continue;
  const e=expectedEdge(x.sharp,p.sport);if(!(e>0))continue;seen.add(x.wallet);                  // only bettors listed in this sport count
  if(x.outcomeIndex===p.outcomeIndex){withE+=.5*e;withN++;}else{againstE+=e;againstN++;}
 }
 const r=sportRecord(p.sharp,p.sport),proven=!!r?.proven&&!r.cold;
 const m=p.sizeMultiple,size=m>=1?1+.15*Math.min(Math.log2(m),3):.85,move=Math.max(0,priceMove(p)??0);
 const score=expectedEdge(p.sharp,p.sport)*size+withE-againstE-move;
 const tier=!(score>0)?'None':proven&&m>=1&&score>=.02&&againstN===0?'High':proven||m>=2||withN>=1?'Solid':'Lean';
 return{score:+score.toFixed(4),estWin:Number.isFinite(p.curPrice)?+Math.max(.01,Math.min(.99,p.curPrice+score)).toFixed(3):null,tier,with:withN,against:againstN,
  alert:tier==='High'||(tier==='Solid'&&m>=2)};
}
export const postable=p=>!p.sharp||p.trust?.tier==='High'||p.trust?.tier==='Solid';
// Where a bet sits against the bettor's record: 'strong' (listed in this sport), 'cold' (listed, but clearly behind since) or 'outside'.
export const sportFit=p=>{if(!p.sharp)return null;const r=sportRecord(p.sharp,p.sport);return !r?'outside':r.cold?'cold':'strong';};
// How far the price has moved since the bettor bought (positive = more expensive now). null when either price is unknown.
export const priceMove=p=>Number.isFinite(p.curPrice)&&Number.isFinite(p.avgPrice)&&p.avgPrice>0?p.curPrice-p.avgPrice:null;
// A ranked bettor's bet is shown only inside a sport they are listed in, and only while the price has not run away from their entry.
export const showable=(p,settings)=>!p.sharp||(p.sportFit==='strong'&&!(priceMove(p)>(settings.maxLate??.06)));
export const DEFAULTS={budget:100,minEdge:.02,minWin:0,buffer:.02,minSharps:2,maxOpposition:0,minGames:100,freshMinutes:120,maxSpread:.03,benchmarkMode:'polymarket',minCostShare:.04,minValue:1000,minRecentGames:20,maxChase:.02,minNetBuyUsd:500,minAdditionFraction:.05,requireUnopposed:true,maxLate:.06};
export async function pool(items,n,fn){const result=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(next<items.length){const i=next++;result[i]=await fn(items[i],i);}}));return result;}
export function validateOptions(options=[]){
 const out={sport:'All',limit:10,ranking:'edge',settings:{...DEFAULTS}},seen=new Set();
 const rules={sport:[3,v=>SPORTS.includes(v)],limit:[4,v=>Number.isInteger(v)&&v>=1&&v<=10],budget:[10,v=>Number.isFinite(v)&&v>=1&&v<=10000],min_edge:[10,v=>Number.isFinite(v)&&v>=0&&v<=20],min_win:[10,v=>Number.isFinite(v)&&v>=0&&v<=99]};
 if(!Array.isArray(options))throw Error('Invalid command options');
 for(const o of options){if(!rules[o.name]||seen.has(o.name))throw Error('Unknown or repeated option');seen.add(o.name);if(o.name==='min_edge'||o.name==='min_win')out.ranking='edge';const [type,valid]=rules[o.name];if(o.type!==type||!valid(o.value))throw Error('Invalid '+o.name);if(o.name==='sport'||o.name==='limit')out[o.name]=o.value;else out.settings[{budget:'budget',min_edge:'minEdge',min_win:'minWin'}[o.name]]=o.name==='budget'?o.value:o.value/100;}
 return out;
}
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(x,k)).map(k=>[k,x[k]]));
export function compact(url,json,conditionIds){
 const path=new URL(url).pathname;
 if(path==='/v2/activity')return {...json,data:json.data?.map(x=>pick(x,['token_id','condition_id','event_slug','type','side','price','size','timestamp','outcome_index','transaction_hash','is_combo']))};
 if(path==='/v2/positions')return {...json,data:json.data?.map(x=>pick(x,['token_id','condition_id','current_size','avg_price','entry_cost_usdc','total_cost_usdc','current_price','current_value','event_slug','outcome','outcome_index','end_date','first_entry_at','last_event_at','opposite_token_id','redeemable','title']))};
 if(path==='/events')return json.map(x=>({slug:x.slug,title:x.title,endDate:x.endDate,tags:x.tags?.map(t=>({slug:t.slug})),markets:x.markets?.filter(m=>m.gameStartTime&&(!conditionIds||conditionIds.has(m.conditionId))).map(m=>pick(m,['conditionId','gameStartTime']))}));
 if(path.startsWith('/clob-markets/'))return pick(json,['t','fd','mos','ao']);
 if(url===LEADERBOARD){
  const sportKeys=['rank','games','wins','winRate','avgPrice','edge','adj','credit','proven','cold'],own=['name','wallet','games','wins','losses','winRate','avgPrice','edge','medianStake'];
  const base={generatedAt:json.generatedAt,policy:json.policy};
  if(Array.isArray(json.specialists))return {...base,specialists:json.specialists.slice(0,SHARP.maxWallets).map(x=>({...pick(x,own),sports:Object.fromEntries(Object.entries(x.sports||{}).map(([k,v])=>[k,{...pick(v,sportKeys),since:pick(v.since||{},['games','wins'])}]))}))};
  return {...base,sharps:(json.sharps||[]).slice(0,40).map(x=>({...pick(x,[...own,'rank','proven']),bySport:Object.fromEntries(Object.entries(x.bySport||{}).map(([k,v])=>[k,pick(v,['games','wins','winRate','avgPrice','edge'])]))}))};
 }
 return json;
}
export async function readPublic(url,conditionIds){
 const u=new URL(url);if((url!==LEADERBOARD&&![DATA,GAMMA,CLOB].includes(u.origin))||u.username||u.password)throw Error('Unapproved data origin');
 const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json','User-Agent':'LuckSociety-Polysharp/1.0'},credentials:'omit'});
 if(!response.ok)throw Error('Public data HTTP '+response.status);
 const value=compact(url,await response.json(),conditionIds);
 if(new TextEncoder().encode(JSON.stringify(value)).length>900000)throw Error('API page exceeds safe Workflow result size');
 if(!Array.isArray(value)&&value&&typeof value==='object')value._fetchedAt=Date.now();
 return value;
}
// Older leaderboard files list bettors overall, without the per-sport, luck-adjusted figures. Until the daily job has written the
// new format, give each of them a heavily discounted credit in the sports where they have 20+ bets and are ahead; never "proven".
export function fromOverall(sharps){
 return (sharps||[]).map(x=>({...x,sports:Object.fromEntries(Object.entries(x.bySport||{}).filter(([,v])=>v.games>=20&&v.edge>0).map(([k,v])=>[k,{rank:x.rank,games:v.games,wins:v.wins,winRate:v.winRate,avgPrice:v.avgPrice,edge:v.edge,
  adj:v.edge*v.games/(v.games+800),credit:Math.min(.03,v.edge*v.games/(v.games+800)),proven:false,cold:false,since:{games:0,wins:0}}]))})).filter(x=>Object.keys(x.sports).length);
}
export const bestSport=s=>Object.entries(s?.sports||{}).sort((a,b)=>(b[1].proven===true)-(a[1].proven===true)||b[1].credit-a[1].credit)[0]||null;
export async function roster(get,warnings){
 // Scan the sport specialists from the daily leaderboard. If it is missing, stale or too short, fall back to the fixed roster
 // (those wallets carry no record, so their cards are labelled as unranked).
 try{
  const lb=await get(LEADERBOARD),age=Date.now()-Date.parse(lb?.generatedAt);
  const ok=x=>/^0x[0-9a-f]{40}$/.test(x?.wallet||'')&&x.medianStake>0&&x.sports&&Object.values(x.sports).some(v=>Number.isFinite(v?.credit)&&Number.isInteger(v.rank));
  const sharps=(Array.isArray(lb?.specialists)?lb.specialists:fromOverall(lb?.sharps)).filter(ok).slice(0,SHARP.maxWallets);
  if(sharps.length>=SHARP.minListed&&age>=0&&age<SHARP.maxAgeDays*864e5)return sharps.map(x=>{const [sport,r]=bestSport(x);return{name:String(x.name).slice(0,40),wallet:x.wallet,spec:`${sport} #${r.rank} · ${r.wins}-${r.games-r.wins} · +${(100*r.credit).toFixed(1)} pts after luck${r.proven?' ✓':''}`,sharp:x};});
 }catch{}
 return CORE.map(t=>({...t}));
}
export function compactWalletPage(page){
 if(!Array.isArray(page?.data))return page;
 return {...page,data:page.data.filter(p=>!p.redeemable).map(p=>p.current_price>.002&&p.current_price<.998&&p.current_value>=1?p:pick(p,['token_id','current_size','entry_cost_usdc','redeemable','current_price','current_value','opposite_token_id']))};
}
export async function fetchWallet(t,get,asOf){
 const raw=await E.pages(async url=>{
  const page=await get(url);
  if(!Array.isArray(page?.data))return page;
  return {...page,data:page.data.map(row=>{
   const p=E.position(row);
   if(!p.redeemable&&p.curPrice>.002&&p.curPrice<.998&&p.currentValue>=1)return p;
   // Preserve every holding's size and cost for hedge netting and the full-book denominator.
   // Discard descriptive fields only for rows that cannot survive the existing display floor.
   return {asset:p.asset,size:p.size,entryCost:p.entryCost,redeemable:p.redeemable,curPrice:p.curPrice,currentValue:p.currentValue,oppositeAsset:p.oppositeAsset};
  })};
 },`${DATA}/v2/positions?user=${t.wallet}&status=OPEN&limit=1000&filter_type=TOKENS&filter_amount=0&sort_by=CURRENT_VALUE`,{maxPages:200});
 const activity=await E.pages(get,`${DATA}/v2/activity?user=${t.wallet}&type=TRADE&start=${Math.floor(asOf/1000)-DEFAULTS.freshMinutes*60}&end=${Math.floor(asOf/1000)}&sort_direction=DESC&limit=1000`,{maxPages:20});
 const positions=E.exposure(raw.filter(p=>!p.redeemable)).filter(p=>p.curPrice>.002&&p.curPrice<.998&&p.currentValue>=1).map(p=>({...p,wallet:t.wallet,trader:t.name,spec:t.spec,scanAt:asOf,...(t.sharp?{sharp:t.sharp,sizeMultiple:Number.isFinite(p.remainingCost)?p.remainingCost/t.sharp.medianStake:null}:{})}));
 const assets=new Set(positions.map(p=>p.asset));
 return {positions,activity:activity.filter(a=>assets.has(a.token_id)).map(a=>pick(a,['token_id','type','side','size','timestamp','price']))};
}
// Ranked bettors: a bet at least their usual size counts (how much bigger feeds the trust score). Unranked wallets keep the open-book share.
export const convinced=(p,settings)=>p.sharp?p.sizeMultiple>=(settings.minMultiple??SHARP.minMultiple):p.conv>=settings.minCostShare;
// A ranked bettor's bet has to be a real bet for them: at least their usual size (see convinced) and worth their usual bet in dollars,
// between $25 and $200. Many of the best records belong to small bettors, so a flat $200 floor would hide nearly all their bets.
// Unranked wallets keep the $1,000 floor.
export const sharpFloor=(p,settings)=>settings.minSharpValue??Math.max(SHARP.minSmall,Math.min(SHARP.minValue,p.sharp?.medianStake||SHARP.minValue));
export const bigEnough=(p,settings)=>p.currentValue>=(p.sharp?sharpFloor(p,settings):settings.minValue);
export async function collect(get,traders,options,onWallet=async fn=>fn()){
 const warnings=[],asOf=options.asOf||Date.now(),activities={};let scannedWallets=0;
 const lists=await pool(traders,3,async t=>{try{const value=await onWallet(()=>fetchWallet(t,get,asOf),t);activities[t.wallet]=value.activity;scannedWallets++;return value.positions;}catch{warnings.push(t.name+': complete positions/activity unavailable');return [];}});
 const positions=lists.flat();
 // Only potential recommendations need game metadata. The full positions array still supplies every supporter and opponent.
 const metadataRows=positions.filter(p=>p.netShares>0&&p.outcomeIndex!==999&&bigEnough(p,options.settings)&&convinced(p,options.settings));
 const slugs=[...new Set(metadataRows.map(p=>p.eventSlug).filter(Boolean))],events=new Map();
 const chunks=[];for(let i=0;i<slugs.length;i+=20)chunks.push(slugs.slice(i,i+20));
 await pool(chunks,2,async chunk=>{try{const es=await get(`${GAMMA}/events?${chunk.map(s=>'slug='+encodeURIComponent(s)).join('&')}&limit=100`,new Set(positions.map(p=>p.conditionId)));for(const e of es)events.set(e.slug,e);}catch{warnings.push('Game metadata unavailable');}});
 for(const p of positions){const ev=events.get(p.eventSlug),m=ev?.markets?.find(m=>m.conditionId===p.conditionId);p.sport=ev?classify((ev.tags||[]).map(t=>t.slug),ev.slug):classify([],p.eventSlug);p.game=m?.gameStartTime?Date.parse(m.gameStartTime):NaN;p.isGame=Number.isFinite(p.game);p.sportFit=sportFit(p);}
 const candidates=positions.filter(p=>p.isGame&&p.game>Date.now()&&p.netShares>0&&p.outcomeIndex!==999&&bigEnough(p,options.settings)&&convinced(p,options.settings)&&showable(p,options.settings)&&(options.sport==='All'?p.sport!=='Non-sports':p.sport===options.sport));
 for(const p of candidates)if(p.sharp)p.trust=trust(p,positions,options.settings);
 return {positions,activities,candidates:candidates.filter(p=>!p.sharp||p.trust.score>0),warnings,asOf,scannedWallets,complete:warnings.length===0};
}
export async function quote(p,get){
 const [book,info]=await Promise.all([get(`${CLOB}/book?token_id=${p.asset}`),get(`${CLOB}/clob-markets/${p.conditionId}`)]);
 if(book.asset_id!==p.asset||book.market!==p.conditionId||!info.t?.some(t=>t.t===p.asset)||info.ao===false)throw Error('Unavailable or mismatched market');
 return {book,info,quoteAt:book._fetchedAt??Date.now()};
}
export function assessOne(p,scan,evidence,options,q,now=Date.now()){
 const consensus=E.consensus(scan.positions.filter(x=>x.conditionId===p.conditionId),evidence,now,options.settings).get(E.key(p));
 const a=E.assess(p,{evidence,now,...q,settings:options.settings,cons:consensus,activity:scan.activities[p.wallet]||[]});
 if(!scan.complete)a.reasons.push('Incomplete roster scan');a.eligible=a.reasons.length===0;return a;
}
export function rankUnique(assessments){
 const best=new Map();for(const a of assessments){const k=E.key(a.p),prev=best.get(k);if(a.eligible&&(!prev||a.roi>prev.roi))best.set(k,a);}
 const games=new Set();return [...best.values()].sort((a,b)=>b.roi-a.roi||b.edge-a.edge).filter(a=>{const k=(a.p.eventSlug||a.p.conditionId).replace(/-more-markets$/,'');if(games.has(k))return false;games.add(k);return true;});
}
export async function buildHistory(t,get,maxPages=30,asOf=Date.now()){
 return History.build({traders:[t],get,pool,data:DATA,gamma:GAMMA,feeRate:.05,maxPages,asOf,classifySport:classify});
}
export const command={name:'polysharp',description:'Most trusted upcoming bets from the best-ranked Polymarket sports bettors.',type:1,integration_types:[0],contexts:[0],options:[
 {name:'sport',description:'Sport to scan (default: all)',type:3,choices:SPORTS.map(x=>({name:x,value:x}))},
 {name:'limit',description:'Maximum candidates or watched games to show (1–10)',type:4,min_value:1,max_value:10},
 {name:'budget',description:'Cash budget per bet for liquidity and fee calculations',type:10,min_value:1,max_value:10000},
 {name:'min_edge',description:'Minimum modeled edge in cents per share (default: 2)',type:10,min_value:0,max_value:20},
 {name:'min_win',description:'Minimum conservative estimated win percentage (default: 0)',type:10,min_value:0,max_value:99}
]};
