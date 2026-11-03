import E from '../engine.js';
import {DATA,GAMMA,pool} from './scanner.mjs';

export const predictionsCommand={name:'predictions',description:'Scan Polymarket smart money and show the top non-sports conviction plays.',type:1,integration_types:[0],contexts:[0]};

// Core roster and category rules from the Smart Money Scanner dashboard.
const CORE = [
  { name:"GCottrell93",          wallet:"0x94a428cfa4f84b264e01f70d93d02bc96cb36356", spec:"Politics" },
  { name:"aenews2",              wallet:"0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1", spec:"Politics · Culture" },
  { name:"denizz",               wallet:"0xbaa2bcb5439e985ce4ccf815b4700027d1b92c73", spec:"Politics" },
  { name:"0xf705…3ca7",          wallet:"0xf705fa045201391d9632b7f3cde06a5e24453ca7", spec:"Crypto" },
  { name:"tdrhrhhd",             wallet:"0xd7f85d0eb0fe0732ca38d9107ad0d4d01b1289e4", spec:"Politics" },
  { name:"elmcap2",              wallet:"0xed107a85a4585a381e48c7f7ca4144909e7dd2e5", spec:"Economics · Politics" },
  { name:"ImJustKen",            wallet:"0x9d84ce0306f8551e02efef1680475fc0f1dc1344", spec:"Politics · Culture" },
  { name:"justdance",            wallet:"0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82", spec:"Crypto" },
  { name:"gopfan2",              wallet:"0xf2f6af4f27ec2dcf4072095ab804016e14cd5817", spec:"Politics · Weather" },
  { name:"TheReturnOfDarthMaul", wallet:"0x3a8aa345d5db7ec5138298c8c4f4540259be7699", spec:"Economics" },
  { name:"foodenjoyer",          wallet:"0x7b02b2bac2a30ed5e40b7094e734f4c3dc2a4991", spec:"Economics · Politics" },
  { name:"coinman2",             wallet:"0x55be7aa03ecfbe37aa5460db791205f7ac9ddca3", spec:"Crypto" },
  { name:"Wickier",              wallet:"0x1cc16713196d456f86fa9c7387dd326a7f73b8df", spec:"Politics" },
  { name:"ArmageddonRewardsBilly",wallet:"0xc8ab97a9089a9ff7e6ef0688e6e591a066946418", spec:"Economics" },
  { name:"e46m3",                wallet:"0x4f1d5ae26fc31472966e951af3183308736d8de2", spec:"Politics" },
  { name:"Abkha",                wallet:"0x7c75be8139d0e333e7c8c2e17b53575ef0804d1d", spec:"Politics" },
  { name:"Bertapotamous",        wallet:"0x134a63b764ac7b008356e8db1857db94e6b09e42", spec:"Politics · Economics" },
  { name:"eventalpha26",         wallet:"0x2e7bf3e7b8ba0351b737897197fd5cc34fbfbd8c", spec:"Politics" },
  { name:"dromedaryy",           wallet:"0x6575759174ad221bba9947bc3f18750ec769b198", spec:"Politics · Finance" },
  { name:"Tokor",                wallet:"0xa19cbababc312f9df185e49d7004c249ed1ade6b", spec:"Crypto" },
  { name:"pako",                 wallet:"0x71edffd0d70a1da823ff07a3c6fc81457294d338", spec:"Economics" },
  { name:"boyau",                wallet:"0xe734e7bf7cfb9e464681f71822f6c2f6be514f0c", spec:"Finance" },
  { name:"bin8888",              wallet:"0xa80e3fe5e7a445fa047fe6de1e27f9a15217b94b", spec:"Finance · Politics" },
  { name:"anoin123",             wallet:"0x96489abcb9f583d6835c8ef95ffc923d05a86825", spec:"Economics · Finance" },
  { name:"MotherTheresa",        wallet:"0x42a6ddf7cf7032972b0bfe32775e8109c5171b64", spec:"Tech · Crypto" },
  { name:"noovd",                wallet:"0x063aeee10fbfd55b6def10da28e87a601e7deb4b", spec:"Culture" },
  { name:"getbipped",            wallet:"0x252d7bae5ec87553dcafb23e275c202ac0d3c456", spec:"Crypto" },
  { name:"CamelUp",              wallet:"0x17559efac103ac7f361be37ec0b93888d4c55aac", spec:"Finance" },
  { name:"CryptoVagabond",       wallet:"0x6979b1a23c14e5cf0c6d29310080841d19d4c2a3", spec:"Culture" },
  { name:"xtxpleasecallme",      wallet:"0xad5353afe30c2da57709e2704ef3ccdcf67eef24", spec:"Politics" },
  { name:"ColdMath",             wallet:"0x594edb9112f526fa6a80b8f858a6379c8a2c1c11", spec:"Weather" },
  { name:"0xb0e7…39D2",          wallet:"0xb0e74df9430a089aa102e2207af5fde1967439d2", spec:"Politics" },
];

function classify(tags, slug){
  const t = new Set(tags); const s = slug||""; const any = (...k) => k.some(x => t.has(x));
  if (any("sports","esports","games","soccer","nfl","nba","nhl","mlb","tennis","ufc") || /^(nfl|nba|nhl|mlb|ufc|atp|wta|lol|cs2|epl|ucl)-/.test(s)) return "Sports";
  if (any("mentions")) return "Mentions";
  if (any("weather","climate","climate-science","temperature","hurricanes")) return "Weather";
  if (any("crypto","crypto-prices","bitcoin","ethereum","solana","token-launch","airdrops","stablecoins")) return "Crypto";
  if (any("economy","economics","fed","fed-rates","fomc","inflation","cpi","jobs-report","recession","interest-rates","macro","gdp","tariffs")) return "Economy";
  if (any("elections","midterms","us-presidential-election","global-elections","world-elections","house-elections","senate-elections","primaries","main-election")) return "Elections";
  if (any("geopolitics","world","middle-east","foreign-policy","ukraine","israel","iran","china","russia","gaza","venezuela","diplomacy-ceasefire")) return "Geopolitics";
  if (any("politics","trump","trump-presidency","congress","courts","scotus","us-politics")) return "Politics";
  if (any("tech","ai","openai","big-tech","apple","google","nvidia","spacex","elon-musk")) return "Tech";
  if (any("finance","business","ipos","ipo","stocks","earnings","pre-market","oil","commodities","gold","companies")) return "Finance";
  if (any("pop-culture","culture","movies","awards","oscars","music","celebrities","tv","grammys","youtube","twitter")) return "Culture";
  return "Other";
}

export async function predictionsRoster(get,warnings){
 const traders=[...CORE],known=new Set(traders.map(t=>t.wallet));
 const categories=[['politics',10],['crypto',6],['economics',5],['finance',5],['tech',3],['culture',3],['weather',3],['mentions',3]];
 for(const [category,limit] of categories){
  try{
   const response=await get(`${DATA}/v2/leaderboard?category=${category}&time_period=month&sort_by=PNL&limit=${limit}`);
   if(!Array.isArray(response.data))throw Error('Invalid leaderboard');
   for(const row of response.data){
    const wallet=row.user_id?.toLowerCase();
    if(!/^0x[0-9a-f]{40}$/.test(wallet)||known.has(wallet))continue;
    known.add(wallet);
    traders.push({wallet,name:String(row.user_name||wallet.slice(0,8)).slice(0,60)});
   }
  }catch{warnings.push(`Monthly ${category} roster unavailable`);}
 }
 return traders;
}

export async function fetchPredictionsWallet(trader,get){
 const rows=await E.pages(get,`${DATA}/v2/positions?user=${trader.wallet}&status=OPEN&limit=1000&filter_type=TOKENS&filter_amount=0&sort_by=CURRENT_VALUE`,{maxPages:200});
 const positions=rows.map(E.position);
 const holdings=positions.reduce((total,p)=>total+(p.currentValue||0),0);
 let book=holdings;
 try{
  const value=Number((await get(`${DATA}/v2/value?user=${trader.wallet}`)).data?.value);
  if(Number.isFinite(value))book=Math.max(book,value);
 }catch{/* Use the complete holdings total when the value endpoint is unavailable. */}
 const open=positions.filter(p=>!p.redeemable&&p.curPrice>.002&&p.curPrice<.998&&p.currentValue>=1);
 const outcomes=new Map(),hedged=new Set();
 for(const p of open){
  if(outcomes.has(p.conditionId)&&outcomes.get(p.conditionId)!==p.outcomeIndex)hedged.add(p.conditionId);
  outcomes.set(p.conditionId,p.outcomeIndex);
 }
 return {count:open.length,positions:book<25000?[]:open.filter(p=>p.currentValue>=1000&&p.currentValue/book>=.01&&!hedged.has(p.conditionId))
  .map(p=>({title:p.title,outcome:p.outcome,eventSlug:p.eventSlug,endDate:p.endDate,conditionId:p.conditionId,currentValue:p.currentValue,curPrice:p.curPrice,conv:Math.min(1,p.currentValue/book),trader:trader.name,wallet:trader.wallet}))};
}

export async function rankPredictions(get,positions,warnings,now=Date.now()){
 const slugs=[...new Set(positions.map(p=>p.eventSlug).filter(Boolean))];
 const chunks=[];
 for(let i=0;i<slugs.length;i+=40)chunks.push(slugs.slice(i,i+40));
 const events=new Map();
 await pool(chunks,2,async chunk=>{
  try{
   const rows=await get(`${GAMMA}/events?${chunk.map(s=>'slug='+encodeURIComponent(s)).join('&')}&limit=100`);
   for(const row of rows)events.set(row.slug,row);
  }catch{if(!warnings.includes('Some market metadata was unavailable'))warnings.push('Some market metadata was unavailable');}
 });
 const best=new Map();
 for(const p of positions){
  const event=events.get(p.eventSlug);
  if(!event)continue;
  const category=classify((event.tags||[]).map(t=>t.slug),p.eventSlug);
  if(category==='Sports')continue;
  const parse=value=>Date.parse(String(value||'').replace(' ','T').replace(/\\+00$/,'Z'));
  const end=parse(event.endDate)||parse(p.endDate);
  if(!(end>now&&end<now+30*864e5))continue;
  const key=p.wallet+'|'+p.conditionId;
  if(!best.has(key)||best.get(key).conv<p.conv)best.set(key,{...p,category,end});
 }
 if(slugs.some(slug=>!events.has(slug))&&!warnings.includes('Some market metadata was unavailable'))warnings.push('Some market metadata was unavailable');
 return [...best.values()].sort((a,b)=>b.conv-a.conv).slice(0,8);
}
