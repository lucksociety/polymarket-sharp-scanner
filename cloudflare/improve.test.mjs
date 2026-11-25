import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collect,roster,compact,sportFit,priceMove,showable,trust,expectedEdge,postable,LEADERBOARD,DEFAULTS} from './scanner.mjs';
import {selectWatchlist} from './journal.mjs';
import {priceNote,recordLine} from './scan-report.mjs';
import {summarize,appendLedger,firstPerGame,scoreLine,scorecardPayload,ledgerEntries,CURRENT} from './scorecard.mjs';
import {POLICY} from './journal.mjs';
import {handle} from './discord.mjs';
const now=Date.now(),W=i=>'0x'+String(i).padStart(40,'0');
const rec=(o={})=>({rank:1,games:120,wins:72,winRate:.6,avgPrice:.5,edge:.09,adj:.012,credit:.012,proven:false,cold:false,since:{games:0,wins:0},...o});
const sharp=(o={})=>({name:'S',wallet:W(1),games:200,wins:120,losses:80,winRate:.6,avgPrice:.5,edge:.09,medianStake:500,sports:{NBA:rec(),NHL:rec({cold:true})},...o});
const proven=()=>sharp({sports:{NBA:rec({proven:true,credit:.05})}});
test('sport fit: listed, listed but cold, or outside the bettor\'s sports',()=>{
 assert.equal(sportFit({sharp:sharp(),sport:'NBA'}),'strong');assert.equal(sportFit({sharp:sharp(),sport:'NHL'}),'cold');assert.equal(sportFit({sharp:sharp(),sport:'UFC'}),'outside');assert.equal(sportFit({sport:'NBA'}),null);
});
test('a ranked bettor is shown only inside a sport they are listed in, and not once the price has run away',()=>{
 const p={sharp:sharp(),sportFit:'strong',curPrice:.55,avgPrice:.5};
 assert.equal(showable(p,DEFAULTS),true);assert.equal(showable({...p,sportFit:'cold'},DEFAULTS),false);assert.equal(showable({...p,sportFit:'outside'},DEFAULTS),false);
 assert.equal(showable({...p,curPrice:.57},DEFAULTS),false);assert.equal(showable({...p,curPrice:.3},DEFAULTS),true);assert.equal(showable({...p,avgPrice:null},DEFAULTS),true);
 assert.equal(showable({curPrice:.9,avgPrice:.1,sportFit:'outside'},DEFAULTS),true);    // unranked wallets keep the old rules
 assert.ok(Math.abs(priceMove(p)-.05)<1e-9);assert.equal(priceMove({curPrice:.5}),null);
});
test('collector applies both rules using live game metadata, including the split college and esports buckets',async()=>{
 const cond=c=>'0x'+c.repeat(64),raw=(o={})=>({token_id:'1',condition_id:cond('a'),current_size:4000,avg_price:.5,entry_cost_usdc:2000,total_cost_usdc:2050,current_price:.505,current_value:2020,event_slug:'nba-a-b',outcome:'A',outcome_index:0,opposite_token_id:'9',redeemable:false,title:'A vs B',...o});
 const rows=[raw(),raw({token_id:'2',condition_id:cond('b'),event_slug:'nhl-c-d',opposite_token_id:'8'}),raw({token_id:'3',condition_id:cond('c'),event_slug:'nba-e-f',current_price:.6,opposite_token_id:'7'}),raw({token_id:'4',condition_id:cond('d'),event_slug:'cfb-g-h',opposite_token_id:'6'})];
 const get=async url=>{const u=new URL(url);if(u.pathname==='/v2/positions')return{data:rows,pagination:{next_cursor:null}};if(u.pathname==='/v2/activity')return{data:[],pagination:{next_cursor:null}};
  if(u.pathname==='/events')return[['nba-a-b','nba','a'],['nhl-c-d','nhl','b'],['nba-e-f','nba','c'],['cfb-g-h','sports','d']].map(([slug,tag,c])=>({slug,tags:[{slug:tag}],markets:[{conditionId:cond(c),gameStartTime:new Date(now+36e5).toISOString()}]}));throw Error(url);};
 const traders=(await roster(async()=>compact(LEADERBOARD,{generatedAt:new Date().toISOString(),specialists:Array.from({length:5},(_,i)=>sharp({name:'S'+i,wallet:W(i+1)}))}),[])).slice(0,1);
 const scan=await collect(get,traders,{sport:'All',limit:10,settings:{...DEFAULTS},asOf:now});
 assert.deepEqual(scan.candidates.map(p=>p.eventSlug),['nba-a-b']);assert.equal(scan.positions.find(p=>p.eventSlug==='nhl-c-d').sportFit,'cold');
 const cfb=scan.positions.find(p=>p.eventSlug==='cfb-g-h');assert.equal(cfb.sport,'College football');assert.equal(cfb.sportFit,'outside');     // an NBA record earns nothing in college football
});
test('trust comes from the record in that sport only, and weighs luck, bet size, agreement, opposition and price moves',()=>{
 const base={wallet:W(1),conditionId:'c',outcomeIndex:0,sport:'NBA',netShares:1,currentValue:5000,curPrice:.5,avgPrice:.5,sizeMultiple:1,sharp:sharp()};
 const t=(o={},rows=[])=>trust({...base,...o},[{...base,...o},...rows]);
 assert.equal(expectedEdge(sharp(),'NBA'),.012);assert.equal(expectedEdge(sharp(),'UFC'),0);assert.equal(expectedEdge(sharp(),'NHL'),0);          // outside their sports, or cold: no credit
 assert.equal(expectedEdge(sharp({sports:{NBA:rec({credit:.5})}}),'NBA'),.08);assert.equal(expectedEdge(null,'NBA'),0);assert.equal(expectedEdge(sharp({sports:{NBA:rec({credit:-.01})}}),'NBA'),0);
 const plain=t();assert.equal(plain.tier,'Lean');assert.equal(plain.alert,false);assert.ok(Math.abs(plain.estWin-(.5+plain.score))<.001);       // usual-sized bet, record could be luck
 assert.equal(postable({...base,trust:plain}),false);
 const big=t({sizeMultiple:2});assert.equal(big.tier,'Solid');assert.equal(big.alert,true);assert.ok(big.score>plain.score);assert.equal(postable({...base,trust:big}),true);
 const ally={...base,wallet:W(2)},foe={...base,wallet:W(3),outcomeIndex:1},stranger={...base,wallet:W(4),sharp:sharp({sports:{UFC:rec()}})};
 assert.equal(t({},[ally]).tier,'Solid');assert.equal(t({},[ally]).with,1);assert.equal(t({},[ally]).alert,false);
 assert.equal(t({},[stranger]).with,0);assert.equal(t({},[stranger]).tier,'Lean');                                                              // agreement from someone not listed in this sport does not count
 assert.equal(t({sizeMultiple:2},[foe]).against,1);assert.ok(t({sizeMultiple:2},[foe]).score<big.score);
 assert.equal(t({},[{...foe,currentValue:50}]).against,0);                                                                                     // scraps do not count as opposition
 assert.equal(t({sizeMultiple:2,curPrice:.52}).tier,'None');assert.equal(t({curPrice:.4}).score,plain.score);                                   // a 2¢ rise wipes out a 1-point edge
 const top=t({sharp:proven()});assert.equal(top.tier,'High');assert.equal(top.alert,true);
 assert.equal(t({sharp:proven()},[foe]).tier,'Solid');                                                                                         // a listed bettor on the other side blocks High
 assert.equal(t({sharp:proven(),curPrice:.535}).tier,'Solid');                                                                                 // price has eaten most of the edge
 assert.equal(t({sharp:proven(),sport:'UFC'}).tier,'None');
 assert.equal(trust({conditionId:'c'},[]),null);assert.equal(postable({}),true);
});
test('cards are ordered by trust, not by bet size',()=>{
 const p={isGame:true,game:now+1e6,netShares:1,costKnown:true,costBook:1,conv:0,sharp:sharp()};
 const out=selectWatchlist([{...p,eventSlug:'a',sizeMultiple:9,trust:{score:.02}},{...p,eventSlug:'b',sizeMultiple:1,trust:{score:.08}}],{now});
 assert.deepEqual(out.map(x=>x.eventSlug),['b','a']);
});
test('cards can be limited to the ones that are posted',()=>{
 const p={isGame:true,game:now+1e6,netShares:1,costKnown:true,costBook:1,conv:0,sharp:sharp()};
 const rows=[{...p,eventSlug:'a',trust:{score:.02,tier:'Lean'}},{...p,eventSlug:'b',trust:{score:.01,tier:'Solid'}}];
 assert.deepEqual(selectWatchlist(rows,{now,keep:postable}).map(x=>x.eventSlug),['b']);assert.equal(selectWatchlist(rows,{now}).length,2);
});
test('price note and record line read plainly',()=>{
 assert.match(priceNote({curPrice:.51,avgPrice:.5}),/Still near/);assert.match(priceNote({curPrice:.56,avgPrice:.5}),/Up 6\.0¢ since they bought/);assert.match(priceNote({curPrice:.44,avgPrice:.5}),/6\.0¢ cheaper/);assert.match(priceNote({curPrice:.5}),/unknown/);
 assert.match(recordLine({trader:'S',sport:'NBA',sharp:sharp()}),/#1 in NBA · S\nNBA record: 72-48 \(60%\) at avg 50\.0¢ · \+9\.0 pts vs price, \+1\.2 after allowing for luck$/);assert.match(recordLine({trader:'S',sport:'UFC',sharp:sharp()}),/not listed in UFC/);
});
const row=(i,o={})=>({runId:'r'+i,at:now-3*864e5,source:'discord',trader:'T',rank:1,proven:true,sport:'NBA',title:'G',outcome:'@everyone',asset:'a'+i,conditionId:'c'+i,outcomeIndex:0,game:now-864e5,gameKey:'g'+i,paid:.5,indicative:.5,allIn:.5,sizeMultiple:6,...o});
test('scorecard counts the first card per game, at the posted price, and leaves pending and void results out of the record',()=>{
 const entries=[row(1),row(2),row(3,{game:now+864e5}),row(4),row(5,{gameKey:'g1',at:now-2*864e5,runId:'repeat'}),row(6,{allIn:null,indicative:.5,source:'alert',sizeMultiple:2.2,paid:.4,proven:false}),row(7,{allIn:null,indicative:null})];
 const s=summarize(entries,{c1:[1e6,0],c2:[0,1e6],c4:[5e5,5e5],c6:[1e6,0],c5:[0,1e6]},now);
 assert.deepEqual([s.overall.bets,s.overall.wins,s.overall.losses,s.overall.pending],[3,2,1,1]);assert.equal(s.skipped,2);assert.equal(s.approxPriced,1);
 assert.ok(Math.abs(s.overall.profitPer100-(100+(-100)+100*(1/.5125-1))/3)<.01);
 assert.equal(s.bySource.Alerts.wins,1);assert.equal(s.bySize['2–3×'].bets,1);assert.equal(s.byTrust['Before trust ratings'].bets,3);assert.equal(s.byPrice['Price had moved up'].bets,1);assert.equal(s.byTier.Leading.bets,1);
 assert.equal(firstPerGame(entries).filter(e=>e.gameKey==='g1')[0].runId,'r1');
 assert.equal(s.byRules['Earlier rules'].bets,3);assert.equal(s.byBettor.T.bets,3);
 const mixed=summarize([row(1),row(2,{policy:'sharp-sport-v2'})],{c1:[1e6,0],c2:[0,1e6]},now);assert.equal(mixed.byRules['Current rules'].losses,1);assert.equal(mixed.byRules['Earlier rules'].wins,1);assert.match(scoreLine(mixed),/under the current rules: 0-1 .* earlier rules: 1-0/);assert.equal(mixed.byTier['Proven ✓'].bets,2);
 assert.equal(appendLedger([row(1)],[row(1),row(2)]).length,2);assert.equal(appendLedger(null,[row(1)]).length,1);
 assert.match(scoreLine(s),/Paper record since .*: 2-1 · \+\$\d+\.\d\d per \$100 · 1 pending/);assert.equal(scoreLine({overall:{bets:0,pending:0}}),null);assert.equal(scoreLine(null),null);
 const pay=scorecardPayload(s);assert.equal(JSON.stringify(pay).includes('@everyone'),false);assert.ok(pay.embeds[0].fields.every(f=>f.value.length<=1024&&f.value.length>0));assert.deepEqual(pay.allowed_mentions,{parse:[]});
});
test('alert route is bounded and the scorecard route exposes aggregates only',async()=>{
 const values=new Map(),created=[],env={DASHBOARD_WEBHOOK_URL:'https://discord.com/api/webhooks/1/abc',CACHE:{get:async(k,t)=>values.has(k)?(t==='json'?JSON.parse(values.get(k)):values.get(k)):null,put:async(k,v)=>values.set(k,v)},SCANS:{create:async x=>{if(created.some(c=>c.id===x.id))throw Error('exists');created.push(x);}}};
 const post=()=>handle(new Request('https://x/alert',{method:'POST'}),env);
 assert.equal((await post()).status,202);assert.equal(created[0].params.source,'alert');assert.equal((await post()).status,429);
 assert.equal((await handle(new Request('https://x/alert'),env)).status,405);
 values.set('alert-budget/'+new Date().toISOString().slice(0,10),'16');created.length=0;assert.equal((await post()).status,429);assert.equal(created.length,0);
 assert.equal((await handle(new Request('https://x/alert',{method:'POST'}),{...env,DASHBOARD_WEBHOOK_URL:''})).status,503);
 const empty=await handle(new Request('https://x/scorecard'),env);assert.deepEqual(await empty.json(),{empty:true});
 values.set('scorecard/v1/latest',JSON.stringify({overall:{bets:3}}));const r=await handle(new Request('https://x/scorecard'),env);
 assert.equal((await r.json()).overall.bets,3);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://lucksociety.github.io');
});
test('ledger rows carry the bettor\'s rank and proven flag in that sport, under the current rules name',()=>{
 assert.equal(POLICY,CURRENT);
 const pos={wallet:W(1),trader:'S',sport:'NBA',asset:'a',conditionId:'c',outcomeIndex:0,game:now+1,sharp:sharp({sports:{NBA:rec({rank:4,proven:true})}}),trust:{tier:'High',estWin:.6}};
 const [r]=ledgerEntries({runId:'r',preparedAt:now,policy:POLICY,source:'alert',entries:[{kind:'watchlist',position:pos}]});
 assert.equal(r.rank,4);assert.equal(r.proven,true);assert.equal(r.policy,'sharp-sport-v2');
 const [o]=ledgerEntries({runId:'r',preparedAt:now,entries:[{kind:'watchlist',position:{...pos,sharp:{rank:9,proven:false}}}]});assert.equal(o.rank,9);assert.equal(o.proven,false);
});
import {bigEnough,sharpFloor,SHARP} from './scanner.mjs';
import {CORE as ROSTER,UNCOPYABLE} from './roster.mjs';
test('a small bettor\'s usual bet counts; the dollar floor follows their usual size between $25 and $200',()=>{
 const p=(median,value)=>({sharp:{medianStake:median},currentValue:value});
 assert.equal(sharpFloor(p(50),DEFAULTS),50);assert.equal(sharpFloor(p(5),DEFAULTS),SHARP.minSmall);assert.equal(sharpFloor(p(9000),DEFAULTS),SHARP.minValue);
 assert.equal(bigEnough(p(50,60),DEFAULTS),true);assert.equal(bigEnough(p(50,40),DEFAULTS),false);assert.equal(bigEnough(p(9000,150),DEFAULTS),false);assert.equal(bigEnough({currentValue:500},DEFAULTS),false);
});
test('roster wallets are unique and valid, and the uncopyable list is well formed',()=>{
 const ws=ROSTER.map(t=>t.wallet.toLowerCase());assert.equal(new Set(ws).size,ws.length);assert.ok(ws.every(w=>/^0x[0-9a-f]{40}$/.test(w)));
 assert.ok(UNCOPYABLE.size>0);assert.ok([...UNCOPYABLE].every(w=>/^0x[0-9a-f]{40}$/.test(w)));
});
import {fetchWallet,fitResult} from './scanner.mjs';
test('a wallet\'s scan result stays small: no repeated raw fields or bettor record per position, and an enormous wallet is trimmed to fit',async()=>{
 const rawRow=i=>({token_id:'t'+i,condition_id:'0x'+String(i).padStart(64,'0'),current_size:1000,avg_price:.5,entry_cost_usdc:500,total_cost_usdc:505,current_price:.5,current_value:10+i,event_slug:'nba-game-'+i,outcome:'Yes',outcome_index:0,end_date:'2026-12-01',first_entry_at:1,last_event_at:2,opposite_token_id:'o'+i,redeemable:false,title:'A very long market title '.repeat(12)});
 const get=async url=>new URL(url).pathname==='/v2/positions'?{data:Array.from({length:600},(_,i)=>rawRow(i)),pagination:{next_cursor:null}}:{data:[],pagination:{next_cursor:null}};
 const t={name:'Big',wallet:W(9),spec:'x'.repeat(200),sharp:sharp()},v=await fetchWallet(t,get,now),p=v.positions[0];
 assert.equal(v.positions.length,600);assert.equal('token_id'in p,false);assert.equal('sharp'in p,false);assert.equal('spec'in p,false);assert.equal(p.asset,'t0');assert.equal(p.conditionId,rawRow(0).condition_id);assert.equal(p.sizeMultiple,1);assert.ok(p.title.length<=120);
 assert.ok(JSON.stringify(v).length<600*800);                                             // well under a kilobyte per position
 assert.equal(fitResult(v),v);
 const cut=fitResult(v,100000);assert.ok(JSON.stringify(cut).length<=100000);assert.ok(cut.positions.length<600&&cut.positions.length>0);assert.ok(cut.positions.every(x=>x.currentValue>=cut.trimmedBelow));
 // collect() puts the bettor's record back on each position
 const events=async url=>new URL(url).pathname==='/events'?[]:get(url),scan=await collect(events,[t],{sport:'All',limit:10,settings:{...DEFAULTS},asOf:now});
 assert.equal(scan.positions[0].sharp,t.sharp);assert.equal(scan.positions[0].spec,t.spec);
});
