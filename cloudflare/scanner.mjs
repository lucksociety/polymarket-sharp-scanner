import E from '../engine.js';
import History from '../history.js';
import {CORE,SPORTS,classify} from './roster.mjs';
export {CORE,SPORTS};
export const DATA='https://data-api.polymarket.com',GAMMA='https://gamma-api.polymarket.com',CLOB='https://clob.polymarket.com';
export const DEFAULTS={budget:100,minEdge:.02,minWin:0,buffer:.02,minSharps:2,maxOpposition:0,minGames:100,freshMinutes:120,maxSpread:.03,benchmarkMode:'polymarket',minCostShare:.04,minValue:1000};
export async function pool(items,n,fn){const result=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(next<items.length){const i=next++;result[i]=await fn(items[i],i);}}));return result;}
export function validateOptions(options=[]){
 const out={sport:'All',limit:10,ranking:'conviction',settings:{...DEFAULTS}},seen=new Set();
 const rules={sport:[3,v=>SPORTS.includes(v)],limit:[4,v=>Number.isInteger(v)&&v>=1&&v<=5],budget:[10,v=>Number.isFinite(v)&&v>=1&&v<=10000],min_edge:[10,v=>Number.isFinite(v)&&v>=0&&v<=20],min_win:[10,v=>Number.isFinite(v)&&v>=0&&v<=99]};
 if(!Array.isArray(options))throw Error('Invalid command options');
 for(const o of options){if(!rules[o.name]||seen.has(o.name))throw Error('Unknown or repeated option');seen.add(o.name);if(o.name==='min_edge'||o.name==='min_win')out.ranking='edge';const [type,valid]=rules[o.name];if(o.type!==type||!valid(o.value))throw Error('Invalid '+o.name);if(o.name==='sport'||o.name==='limit')out[o.name]=o.value;else out.settings[{budget:'budget',min_edge:'minEdge',min_win:'minWin'}[o.name]]=o.name==='budget'?o.value:o.value/100;}
 if(out.ranking==='edge'&&!seen.has('limit'))out.limit=3;
 return out;
}
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(x,k)).map(k=>[k,x[k]]));
export function compact(url,json,conditionIds){
 const path=new URL(url).pathname;
 if(path==='/v2/activity')return {...json,data:json.data?.map(x=>pick(x,['token_id','condition_id','event_slug','type','side','price','size','timestamp','outcome_index','transaction_hash','is_combo']))};
 if(path==='/v2/positions')return {...json,data:json.data?.map(x=>pick(x,['token_id','condition_id','current_size','avg_price','entry_cost_usdc','total_cost_usdc','current_price','current_value','event_slug','outcome','outcome_index','end_date','first_entry_at','last_event_at','opposite_token_id','redeemable','title']))};
 if(path==='/events')return json.map(x=>({slug:x.slug,title:x.title,tags:x.tags?.map(t=>({slug:t.slug})),markets:x.markets?.filter(m=>m.gameStartTime&&(!conditionIds||conditionIds.has(m.conditionId))).map(m=>pick(m,['conditionId','gameStartTime']))}));
 if(path.startsWith('/clob-markets/'))return pick(json,['t','fd','mos','ao']);
 return json;
}
export async function readPublic(url,conditionIds){
 const u=new URL(url);if(![DATA,GAMMA,CLOB].includes(u.origin)||u.username||u.password)throw Error('Unapproved data origin');
 const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json','User-Agent':'LuckSociety-Polysharp/1.0'},credentials:'omit'});
 if(!response.ok)throw Error('Public data HTTP '+response.status);
 const value=compact(url,await response.json(),conditionIds);
 if(new TextEncoder().encode(JSON.stringify(value)).length>900000)throw Error('API page exceeds safe Workflow result size');
 if(!Array.isArray(value)&&value&&typeof value==='object')value._fetchedAt=Date.now();
 return value;
}
export async function roster(get,warnings){
 const traders=CORE.map(t=>({...t})),known=new Set(traders.map(t=>t.wallet.toLowerCase()));
 for(const [category,limit]of [['sports',25],['esports',10]]){
  try{const r=await get(`${DATA}/v2/leaderboard?category=${category}&time_period=month&sort_by=PNL&limit=${limit}`);if(!Array.isArray(r.data))throw Error('Invalid leaderboard');for(const x of r.data){const wallet=x.user_id?.toLowerCase();if(!/^0x[0-9a-f]{40}$/.test(wallet)||known.has(wallet))continue;known.add(wallet);traders.push({wallet,name:String(x.user_name||wallet.slice(0,8)).slice(0,60),spec:'Monthly discovery',hot:true});}}
  catch{warnings.push('Monthly '+category+' roster unavailable');}
 }
 return traders;
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
 const positions=E.exposure(raw.filter(p=>!p.redeemable)).filter(p=>p.curPrice>.002&&p.curPrice<.998&&p.currentValue>=1).map(p=>({...p,wallet:t.wallet,trader:t.name,spec:t.spec,scanAt:asOf}));
 const assets=new Set(positions.map(p=>p.asset));
 return {positions,activity:activity.filter(a=>assets.has(a.token_id)).map(a=>pick(a,['token_id','type','side','size','timestamp','price']))};
}
export async function collect(get,traders,options,onWallet=async fn=>fn()){
 const warnings=[],asOf=options.asOf||Date.now(),activities={};let scannedWallets=0;
 const lists=await pool(traders,3,async t=>{try{const value=await onWallet(()=>fetchWallet(t,get,asOf),t);activities[t.wallet]=value.activity;scannedWallets++;return value.positions;}catch{warnings.push(t.name+': complete positions/activity unavailable');return [];}});
 const positions=lists.flat();
 // Only potential recommendations need game metadata. The full positions array still supplies every supporter and opponent.
 const metadataRows=positions.filter(p=>p.netShares>0&&p.outcomeIndex!==999&&p.currentValue>=options.settings.minValue&&p.conv>=options.settings.minCostShare);
 const slugs=[...new Set(metadataRows.map(p=>p.eventSlug).filter(Boolean))],events=new Map();
 const chunks=[];for(let i=0;i<slugs.length;i+=20)chunks.push(slugs.slice(i,i+20));
 await pool(chunks,2,async chunk=>{try{const es=await get(`${GAMMA}/events?${chunk.map(s=>'slug='+encodeURIComponent(s)).join('&')}&limit=100`,new Set(positions.map(p=>p.conditionId)));for(const e of es)events.set(e.slug,e);}catch{warnings.push('Game metadata unavailable');}});
 for(const p of positions){const ev=events.get(p.eventSlug),m=ev?.markets?.find(m=>m.conditionId===p.conditionId);p.sport=ev?classify((ev.tags||[]).map(t=>t.slug),ev.slug):classify([],p.eventSlug);p.game=m?.gameStartTime?Date.parse(m.gameStartTime):NaN;p.isGame=Number.isFinite(p.game);}
 const candidates=positions.filter(p=>p.isGame&&p.game>Date.now()&&p.netShares>0&&p.outcomeIndex!==999&&p.currentValue>=options.settings.minValue&&p.conv>=options.settings.minCostShare&&(options.sport==='All'?p.sport!=='Non-sports':p.sport===options.sport));
 return {positions,activities,candidates,warnings,asOf,scannedWallets,complete:warnings.length===0};
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
 return [...best.values()].sort((a,b)=>b.roi-a.roi||b.edge-a.edge);
}
export async function buildHistory(t,get,maxPages=30,asOf=Date.now()){
 return History.build({traders:[t],get,pool,data:DATA,gamma:GAMMA,feeRate:.05,maxPages,asOf,classifySport:classify});
}
export const command={name:'polysharp',description:'Scan Polymarket sharp wallets and report qualifying sports bets.',type:1,integration_types:[0],contexts:[0],options:[
 {name:'sport',description:'Sport to scan (default: all)',type:3,choices:SPORTS.map(x=>({name:x,value:x}))},
 {name:'limit',description:'Maximum qualifying bets to post (1–5)',type:4,min_value:1,max_value:5},
 {name:'budget',description:'Cash budget per bet for liquidity and fee calculations',type:10,min_value:1,max_value:10000},
 {name:'min_edge',description:'Minimum modeled edge in cents per share (default: 2)',type:10,min_value:0,max_value:20},
 {name:'min_win',description:'Minimum conservative estimated win percentage (default: 0)',type:10,min_value:0,max_value:99}
]};
