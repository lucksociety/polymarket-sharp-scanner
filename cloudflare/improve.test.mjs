import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collect,roster,compact,sportFit,priceMove,showable,trust,expectedEdge,LEADERBOARD,DEFAULTS} from './scanner.mjs';
import {selectWatchlist} from './journal.mjs';
import {priceNote,recordLine} from './scan-report.mjs';
import {summarize,appendLedger,firstPerGame,scoreLine,scorecardPayload} from './scorecard.mjs';
import {handle} from './discord.mjs';
const now=Date.now(),W=i=>'0x'+String(i).padStart(40,'0');
const sharp=(o={})=>({rank:1,name:'S',wallet:W(1),proven:true,games:100,wins:60,losses:40,winRate:.6,avgPrice:.5,edge:.09,medianStake:500,bySport:{NBA:{games:40,wins:26,winRate:.65,edge:.1},NHL:{games:30,wins:12,winRate:.4,edge:-.08}},...o});
test('sport fit: ahead, behind, or too few bets to say',()=>{
 assert.equal(sportFit({sharp:sharp(),sport:'NBA'}),'strong');assert.equal(sportFit({sharp:sharp(),sport:'NHL'}),'weak');assert.equal(sportFit({sharp:sharp(),sport:'UFC'}),'thin');assert.equal(sportFit({sport:'NBA'}),null);
});
test('a ranked bettor is left out of a sport they are behind in, and of bets whose price has run away',()=>{
 const p={sharp:sharp(),sportFit:'strong',curPrice:.55,avgPrice:.5};
 assert.equal(showable(p,DEFAULTS),true);assert.equal(showable({...p,sportFit:'weak'},DEFAULTS),false);assert.equal(showable({...p,sportFit:'thin'},DEFAULTS),true);
 assert.equal(showable({...p,curPrice:.57},DEFAULTS),false);assert.equal(showable({...p,curPrice:.3},DEFAULTS),true);assert.equal(showable({...p,avgPrice:null},DEFAULTS),true);
 assert.equal(showable({curPrice:.9,avgPrice:.1,sportFit:'weak'},DEFAULTS),true);       // unranked wallets keep the old rules
 assert.ok(Math.abs(priceMove(p)-.05)<1e-9);assert.equal(priceMove({curPrice:.5}),null);
});
test('collector applies both rules using live game metadata',async()=>{
 const cond=c=>'0x'+c.repeat(64),raw=(o={})=>({token_id:'1',condition_id:cond('a'),current_size:4000,avg_price:.5,entry_cost_usdc:2000,total_cost_usdc:2050,current_price:.52,current_value:2080,event_slug:'nba-a-b',outcome:'A',outcome_index:0,opposite_token_id:'9',redeemable:false,title:'A vs B',...o});
 const rows=[raw(),raw({token_id:'2',condition_id:cond('b'),event_slug:'nhl-c-d',opposite_token_id:'8'}),raw({token_id:'3',condition_id:cond('c'),event_slug:'nba-e-f',current_price:.6,opposite_token_id:'7'})];
 const get=async url=>{const u=new URL(url);if(u.pathname==='/v2/positions')return{data:rows,pagination:{next_cursor:null}};if(u.pathname==='/v2/activity')return{data:[],pagination:{next_cursor:null}};
  if(u.pathname==='/events')return[['nba-a-b','nba','a'],['nhl-c-d','nhl','b'],['nba-e-f','nba','c']].map(([slug,tag,c])=>({slug,tags:[{slug:tag}],markets:[{conditionId:cond(c),gameStartTime:new Date(now+36e5).toISOString()}]}));throw Error(url);};
 const traders=(await roster(async()=>compact(LEADERBOARD,{generatedAt:new Date().toISOString(),sharps:Array.from({length:5},(_,i)=>sharp({rank:i+1,name:'S'+i,wallet:W(i+1)}))}),[])).slice(0,1);
 const scan=await collect(get,traders,{sport:'All',limit:10,settings:{...DEFAULTS},asOf:now});
 assert.deepEqual(scan.candidates.map(p=>p.eventSlug),['nba-a-b']);assert.equal(scan.positions.find(p=>p.eventSlug==='nhl-c-d').sportFit,'weak');
});
test('trust weighs sport record, luck, bet size, agreement, opposition and price moves',()=>{
 const base={wallet:W(1),conditionId:'c',outcomeIndex:0,sport:'NBA',netShares:1,currentValue:5000,curPrice:.5,avgPrice:.5,sizeMultiple:1,sharp:sharp()};
 const t=(o={},rows=[])=>trust({...base,...o},[{...base,...o},...rows]);
 assert.ok(Math.abs(expectedEdge(sharp(),'NBA')-(40*.1+20*.09)/60)<1e-9);                       // sport record blended with overall
 assert.ok(Math.abs(expectedEdge(sharp(),'UFC')-.045)<1e-9);                                    // no sport record: half weight
 assert.ok(Math.abs(expectedEdge(sharp({proven:false}),'UFC')-.027)<1e-9);                      // could still be luck: marked down
 assert.equal(expectedEdge(sharp({edge:.5,bySport:{}}),'NBA'),.12);assert.equal(expectedEdge(null,'NBA'),0);
 const plain=t();assert.equal(plain.tier,'High');assert.ok(Math.abs(plain.estWin-(.5+plain.score))<.001);assert.equal(plain.alert,true);
 assert.ok(t({sizeMultiple:8}).score>plain.score);assert.ok(t({sizeMultiple:.6}).score<plain.score);
 const ally={...base,wallet:W(2)},foe={...base,wallet:W(3),outcomeIndex:1};
 assert.ok(t({},[ally]).score>plain.score);assert.equal(t({},[ally]).with,1);
 assert.ok(t({},[foe]).score<.01);assert.equal(t({},[foe]).against,1);assert.equal(t({},[foe]).tier==='High',false);
 assert.equal(t({},[{...foe,currentValue:50}]).against,0);                                       // scraps do not count as opposition
 assert.ok(Math.abs(t({curPrice:.54}).score-(plain.score-.04))<1e-3);assert.equal(t({curPrice:.4}).score,plain.score);
 const lean=t({sport:'UFC',sharp:sharp({proven:false})});assert.equal(lean.tier,'Lean');assert.equal(lean.alert,false);
 assert.equal(t({sport:'UFC',sizeMultiple:1}).tier,'Solid');assert.equal(t({sport:'UFC',sizeMultiple:1}).alert,false);assert.equal(t({sport:'UFC',sizeMultiple:2}).alert,true);
 assert.equal(trust({conditionId:'c'},[]),null);
});
test('cards are ordered by trust, not by bet size',()=>{
 const p={isGame:true,game:now+1e6,netShares:1,costKnown:true,costBook:1,conv:0,sharp:sharp()};
 const out=selectWatchlist([{...p,eventSlug:'a',sizeMultiple:9,trust:{score:.02}},{...p,eventSlug:'b',sizeMultiple:1,trust:{score:.08}}],{now});
 assert.deepEqual(out.map(x=>x.eventSlug),['b','a']);
});
test('price note and record line read plainly',()=>{
 assert.match(priceNote({curPrice:.51,avgPrice:.5}),/Still near/);assert.match(priceNote({curPrice:.56,avgPrice:.5}),/Up 6\.0¢ since they bought/);assert.match(priceNote({curPrice:.44,avgPrice:.5}),/6\.0¢ cheaper/);assert.match(priceNote({curPrice:.5}),/unknown/);
 assert.match(recordLine({trader:'S',sport:'NBA',sharp:sharp()}),/NBA only: 26-14 \(65%\) · \+10\.0 pts/);assert.match(recordLine({trader:'S',sport:'UFC',sharp:sharp()}),/Few UFC bets on record/);
});
const row=(i,o={})=>({runId:'r'+i,at:now-3*864e5,source:'discord',trader:'T',rank:1,proven:true,sport:'NBA',title:'G',outcome:'@everyone',asset:'a'+i,conditionId:'c'+i,outcomeIndex:0,game:now-864e5,gameKey:'g'+i,paid:.5,indicative:.5,allIn:.5,sizeMultiple:6,...o});
test('scorecard counts the first card per game, at the posted price, and leaves pending and void results out of the record',()=>{
 const entries=[row(1),row(2),row(3,{game:now+864e5}),row(4),row(5,{gameKey:'g1',at:now-2*864e5,runId:'repeat'}),row(6,{allIn:null,indicative:.5,source:'alert',sizeMultiple:2.2,paid:.4,proven:false}),row(7,{allIn:null,indicative:null})];
 const s=summarize(entries,{c1:[1e6,0],c2:[0,1e6],c4:[5e5,5e5],c6:[1e6,0],c5:[0,1e6]},now);
 assert.deepEqual([s.overall.bets,s.overall.wins,s.overall.losses,s.overall.pending],[3,2,1,1]);assert.equal(s.skipped,2);assert.equal(s.approxPriced,1);
 assert.ok(Math.abs(s.overall.profitPer100-(100+(-100)+100*(1/.5125-1))/3)<.01);
 assert.equal(s.bySource.Alerts.wins,1);assert.equal(s.bySize['2–3×'].bets,1);assert.equal(s.byTrust['Before trust ratings'].bets,3);assert.equal(s.byPrice['Price had moved up'].bets,1);assert.equal(s.byTier.Leading.bets,1);
 assert.equal(firstPerGame(entries).filter(e=>e.gameKey==='g1')[0].runId,'r1');
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
