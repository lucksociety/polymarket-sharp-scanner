import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roster,readPublic,compact,collect,convinced,LEADERBOARD,CORE,DEFAULTS,SHARP} from './scanner.mjs';
import {selectWatchlist} from './journal.mjs';
import {scanReport,recordLine} from './scan-report.mjs';
const now=Date.now(),W=i=>'0x'+String(i).padStart(40,'0');
const row=(i,extra={})=>({rank:i,name:'Sharp'+i,wallet:W(i),proven:i===1,games:100,wins:60,losses:40,winRate:.6,avgPrice:.5,edge:.0875,edgeLower:.01,roi:.17,medianStake:500,bySport:{NBA:{games:40,wins:26,winRate:.65,edge:.1}},secret:'drop',...extra});
const board=(n=6,at=now)=>({generatedAt:new Date(at).toISOString(),policy:'edge-over-price-v1',sharps:Array.from({length:n},(_,i)=>row(i+1))});
test('leaderboard is the only non-Polymarket URL the collector may read, and is compacted',async()=>{
 await assert.rejects(readPublic(LEADERBOARD.replace('leaderboard.json','other.json')),/origin/);
 const c=compact(LEADERBOARD,board());assert.equal(c.sharps.length,6);assert.equal('secret'in c.sharps[0],false);assert.equal(c.sharps[0].bySport.NBA.wins,26);
});
test('roster uses ranked bettors when the leaderboard is fresh, else the fixed roster',async()=>{
 const good=await roster(async()=>compact(LEADERBOARD,board()),[]);assert.equal(good.length,6);assert.equal(good[0].sharp.rank,1);assert.match(good[0].spec,/#1 · 60-40 · \+8\.8 pts/);
 for(const bad of[async()=>{throw Error('down')},async()=>board(6,now-(SHARP.maxAgeDays+1)*864e5),async()=>board(2),async()=>({sharps:[{wallet:'nope'}]})]){
  const w=[],r=await roster(bad,w);assert.equal(r.length,CORE.length);assert.equal(r.some(t=>t.sharp),false);assert.deepEqual(w,[]);}
});
const raw=(o={})=>({token_id:'42',condition_id:'0x'+'a'.repeat(64),current_size:4000,avg_price:.5,entry_cost_usdc:2000,total_cost_usdc:2050,current_price:.55,current_value:2200,event_slug:'nba-a-b',outcome:'A',outcome_index:0,opposite_token_id:'43',redeemable:false,title:'A vs B',...o});
const api=rows=>async url=>{const u=new URL(url);if(u.pathname==='/v2/positions')return{data:rows(u.searchParams.get('user')),pagination:{next_cursor:null}};if(u.pathname==='/v2/activity')return{data:[],pagination:{next_cursor:null}};if(u.pathname==='/events')return[{slug:'nba-a-b',tags:[{slug:'nba'}],markets:[{conditionId:'0x'+'a'.repeat(64),gameStartTime:new Date(now+36e5).toISOString()},{conditionId:'0x'+'b'.repeat(64),gameStartTime:new Date(now+72e5).toISOString()}]}];throw Error('unexpected '+url);};
test('conviction for a ranked bettor is the bet size against their own usual bet',async()=>{
 const traders=(await roster(async()=>compact(LEADERBOARD,board()),[])).slice(0,2);traders[1].sharp={...traders[1].sharp,medianStake:5000};
 // Same $2,000 bet: 4x usual for the first bettor, 0.4x for the second. Lots of other open money must not matter.
 const scan=await collect(api(()=>[raw(),raw({token_id:'77',condition_id:'0x'+'c'.repeat(64),event_slug:'old-future',entry_cost_usdc:500000,current_value:500000,opposite_token_id:'78'})]),traders,{sport:'All',limit:10,settings:{...DEFAULTS},asOf:now});
 const upcoming=scan.candidates;assert.equal(upcoming.length,1);assert.equal(upcoming[0].wallet,traders[0].wallet);assert.equal(upcoming[0].sizeMultiple,4);assert.ok(upcoming[0].conv<.01);
 assert.equal(convinced({sharp:{},sizeMultiple:1.9},DEFAULTS),false);assert.equal(convinced({conv:.05},DEFAULTS),true);
});
test('watchlist ranks ranked bettors by size multiple and keeps one bet per game',()=>{
 const p={isGame:true,game:now+1e6,netShares:1,costKnown:true,costBook:100,conv:.01,sharp:row(1),eventSlug:'g1'};
 const out=selectWatchlist([{...p,sizeMultiple:3},{...p,sizeMultiple:9,eventSlug:'g2'},{...p,sizeMultiple:5,eventSlug:'g1-more-markets'}],{now});
 assert.deepEqual(out.map(x=>x.sizeMultiple),[9,5]);
});
test('ranked report leads with the bettor record and size, and escapes names',()=>{
 const p={wallet:W(1),trader:'@everyone',asset:'a',conditionId:'c',outcomeIndex:0,outcome:'Lakers',eventSlug:'nba-x',title:'Lakers vs Celtics',sport:'NBA',game:now+36e5,isGame:true,conv:.02,costBook:1e6,remainingCost:6200,avgPrice:.54,curPrice:.57,netShares:10,currentValue:6500,sharp:row(1),sizeMultiple:12.4};
 const opp={...p,wallet:W(2),outcomeIndex:1,sharp:row(2)};
 const out=scanReport({watchlist:[p],scan:{complete:true,scannedWallets:30,positions:[p,opp]},rosterCount:30,options:{limit:10,sport:'All',settings:{...DEFAULTS}},now});
 const [summary,bets]=out.payload.embeds;assert.equal(out.payload.embeds.length,2);assert.match(summary.description,/Top 30 bettors by win rate above the price/);
 const v=bets.fields[0].value;assert.match(v,/#1 .* ✓ · 60-40 \(60%\) at avg 50\.0¢ · \+8\.8 pts vs price/);assert.match(v,/NBA only: 26-14 \(65%\)/);assert.match(v,/\*\*12× their usual bet\*\* · \$6,200 in at 54\.0¢/);assert.match(v,/Other top bettors: 0 with · 1 against/);
 assert.equal(v.includes('@everyone'),false);assert.equal(recordLine({trader:'x'}),null);
 const none=scanReport({watchlist:[],scan:{complete:true,scannedWallets:30,positions:[p]},rosterCount:30,options:{limit:10,sport:'All'},now});assert.match(none.payload.embeds[1].description,/None of the top bettors/);
});
