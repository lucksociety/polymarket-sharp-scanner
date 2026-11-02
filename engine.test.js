'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('./engine.js');
const now=Date.parse('2026-11-02T20:00:00Z'),wallet='0x'+'1'.repeat(40),condition='0x'+'a'.repeat(64);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const p={wallet,trader:'A',sport:'NBA',conditionId:condition,outcomeIndex:0,outcome:'Yes',asset:'1',oppositeAsset:'2',size:100,entryCost:50,costKnown:true,conv:.1,netShares:100,isGame:true,game:now+3600000,scanAt:now};
function history(w=wallet){return Array.from({length:101},(_,i)=>({wallet:w,sport:'NBA',eventId:'game'+i,source:'audit',entryAt:new Date(now-(200-i)*864e5).toISOString(),settledAt:new Date(now-(199-i)*864e5).toISOString(),stake:100,pnlNet:i%2?20:-10,entryAllIn:.5,closingProbability:.55,costsIncluded:true}));}
const odds=()=>['Book A','Book B'].map(source=>({conditionId:condition,source,asOf:new Date(now-60000).toISOString(),outcomes:['Yes','No'],decimalOdds:[1.6,2.6],rulesConfirmed:true,rules:'Exact moneyline, overtime included'}));
const info={mos:1,fd:{r:.05,e:1}},book={timestamp:now,asks:[{price:'.6',size:'1000'},{price:'.5',size:'1000'}],bids:[{price:'.49',size:'100'}]};
test('normalizes v2 position fields without turning missing cost into zero',()=>{const r=E.position({token_id:'42',current_size:10,entry_cost_usdc:null,current_price:.4});assert.equal(r.asset,'42');assert.equal(r.size,10);assert.equal(r.entryCost,null);});
test('cursor walks preserve cohort filters and do not stop on short pages',async()=>{const urls=[];const rows=await E.pages(async url=>{urls.push(new URL(url));return urls.length===1?{data:[1],pagination:{next_cursor:'opaque/+x'}}:{data:[2],pagination:{next_cursor:null}};},'https://example.com/v2/positions?user=wallet&status=OPEN&limit=500');assert.deepEqual(rows,[1,2]);assert.equal(urls[1].searchParams.get('cursor'),'opaque/+x');assert.equal(urls[1].searchParams.get('status'),'OPEN');assert.equal(urls[1].searchParams.has('offset'),false);});
test('repeated cursors and incomplete walks fail closed',async()=>{await assert.rejects(E.pages(async()=>({data:[],pagination:{next_cursor:'x'}}),'https://example.com'),/repeated/);await assert.rejects(E.pages(async()=>({data:[],pagination:{next_cursor:'x'}}),'https://example.com',{maxPages:1}),/incomplete/);await assert.rejects(E.pages(async()=>[],'https://example.com'),/envelope/);});
test('partial hedges use only unmatched cost; equal pairs carry no directional exposure',()=>{const rs=E.exposure([p,{...p,asset:'2',oppositeAsset:'1',size:40,entryCost:20}]);near(rs[0].conv,30/70);assert.equal(rs[0].netShares,60);assert.equal(rs[1].netShares,0);assert.equal(rs[1].conv,0);});
test('rising marks do not inflate open cost share',()=>{const rs=E.exposure([{...p,currentValue:95},{...p,asset:'3',oppositeAsset:'4',currentValue:10}]);near(rs[0].conv,.5);near(rs[1].conv,.5);});
test('freshness requires net buying, not merely holding or recent selling',()=>{const a=[{token_id:'1',type:'TRADE',side:'BUY',size:10,price:.5,timestamp:now/1000-10},{token_id:'1',type:'TRADE',side:'SELL',size:12,timestamp:now/1000-5}];assert.equal(E.recentFlow(p,a,now).fresh,false);assert.equal(E.recentFlow(p,a.slice(0,1),now).fresh,true);assert.equal(E.recentFlow(p,[{...a[0],timestamp:now/1000+1}],now).fresh,false);});
test('removes vig from exhaustive outcomes and requires two independent current books',()=>{const b=E.benchmark(p,odds(),now);near(b.fair,(1/1.6)/(1/1.6+1/2.6));near(b.low,b.fair-.02);assert.equal(b.books,2);assert.equal(E.benchmark(p,[odds()[0],odds()[0]],now).known,false);});
test('stale, future, unconfirmed and mismatched odds cannot qualify',()=>{for(const mutate of [r=>({...r,asOf:new Date(now-16*60000).toISOString()}),r=>({...r,asOf:new Date(now+1).toISOString()}),r=>({...r,rulesConfirmed:false}),r=>({...r,conditionId:'other'})])assert.equal(E.benchmark(p,odds().map(mutate),now).known,false);});
test('execution sorts levels and prices market-specific fees through depth',()=>{const ex=E.execution(book,info,51.25,now);near(ex.shares,100);near(ex.cost,50);near(ex.fees,1.25);near(ex.allIn,.5125);assert.equal(ex.filled,true);near(ex.bestAsk,.5);});
test('insufficient depth is never presented as a full-size fill',()=>{const ex=E.execution({...book,asks:[{price:'.5',size:10}]},info,100,now);assert.equal(ex.filled,false);near(ex.shares,10);});
test('rounded fees stay within the configured cash budget',()=>{const ex=E.execution(book,info,100,now);assert.ok(ex.total<=100);assert.ok(ex.shares>195);});
test('missing fee or minimum size, empty/crossed book cannot qualify',()=>{assert.equal(E.execution(book,{},100,now).known,false);assert.equal(E.execution(book,{fd:info.fd},100,now).known,false);assert.equal(E.execution({...book,asks:[]},info,100,now).known,false);assert.equal(E.execution({...book,bids:[{price:.6}]},info,100,now).known,false);assert.equal(E.execution(book,{mos:1000,fd:info.fd},1,now).known,false);});
test('fee curve exponent is respected; missing rate is not fee-free',()=>{const ex=E.execution(book,{mos:1,fd:{r:.02,e:2}},50.125,now);near(ex.fees,.125);assert.equal(E.feeParams({fd:{r:null,e:1}}),null);assert.deepEqual(E.feeParams({fd:{r:0,e:1}}),{rate:0,exponent:1});});
test('history qualifies by separate games, span, CLV and profit excluding biggest win',()=>{const q=E.quality(wallet,'NBA',history(),now);assert.equal(q.qualified,true);assert.equal(q.games,101);assert.equal(E.quality(wallet,'NFL',history(),now).qualified,false);const lottery=history().map((r,i)=>({...r,pnlNet:i===0?100000:-10}));assert.equal(E.quality(wallet,'NBA',lottery,now).qualified,false);});
test('future results cannot qualify an earlier signal',()=>{assert.equal(E.quality(wallet,'NBA',history(),now-180*864e5).qualified,false);});
test('multiple entries on a single game do not inflate sample size',()=>{const rs=history().map(r=>({...r,eventId:'same'}));assert.equal(E.quality(wallet,'NBA',rs,now).games,1);assert.equal(E.quality(wallet,'NBA',rs,now).qualified,false);});
test('consensus preserves opposing exposure and collapses linked wallets',()=>{const w2='0x'+'2'.repeat(40),w3='0x'+'3'.repeat(40);const ev={history:[...history(),...history(w2),...history(w3)],clusters:{[wallet]:'team',[w2]:'team'}};const rows=[p,{...p,wallet:w2,trader:'B'},{...p,wallet:w3,trader:'C',outcomeIndex:1}];const c=E.consensus(rows,ev,now).get(E.key(p));assert.equal(c.qualified,1);assert.equal(c.opposingQualified,1);assert.equal(c.supporters.length,1);});
test('a linked cluster supporting both sides is not independent support',()=>{const w2='0x'+'2'.repeat(40);const ev={history:[...history(),...history(w2)],clusters:{[wallet]:'team',[w2]:'team'}};const c=E.consensus([p,{...p,wallet:w2,outcomeIndex:1}],ev,now).get(E.key(p));assert.equal(c.qualified,0);});
test('missing evidence never creates eligible bets despite a large holding',()=>{const a=E.assess(p,{evidence:{odds:[],history:[],clusters:{}},now,book,info,quoteAt:now,activity:[],settings:{budget:100,minEdge:.02,minWin:0,buffer:.02,minSharps:2,maxOpposition:0,minGames:100,freshMinutes:120,maxSpread:.03},cons:null});assert.equal(a.eligible,false);assert.equal(a.edge,null);assert.ok(a.reasons.includes('Unverified'));});
test('qualified value still fails when quotes or scans are stale',()=>{const settings={budget:100,minEdge:.02,minWin:0,buffer:.02,minSharps:2,maxOpposition:0,minGames:100,freshMinutes:120,maxSpread:.03};const args={evidence:{odds:odds(),history:history(),clusters:{}},now,book,info,quoteAt:now,activity:[{token_id:'1',type:'TRADE',side:'BUY',size:100,timestamp:now/1000-10}],settings,cons:{qualified:2,opposingQualified:0,netWeight:1}};assert.equal(E.assess(p,args).eligible,true);assert.equal(E.assess(p,{...args,quoteAt:now-31000}).eligible,false);assert.equal(E.assess({...p,scanAt:now-301000},args).eligible,false);assert.equal(E.assess(p,{...args,settings:{...settings,minWin:.9}}).eligible,false);});
test('evidence validator rejects partial after-cost histories and malformed odds',()=>{const valid={version:1,history:history(),odds:odds(),clusters:{}};assert.equal(E.validateEvidence(valid).history.length,101);assert.throws(()=>E.validateEvidence({...valid,history:[{...history()[0],costsIncluded:false}]}),/history row/);assert.throws(()=>E.validateEvidence({...valid,odds:[{...odds()[0],decimalOdds:[1]}]}),/odds row/);});
test('Polymarket probability model uses unique prior games in the executable-price bucket',()=>{
 const rs=history().map((r,i)=>({...r,model:true,payout:i<80?1:0,feeAssumption:.05}));
 const b=E.modelBenchmark(p,rs,now,.5);assert.equal(b.known,true);assert.equal(b.games,101);near(b.fair,80/101);assert.ok(b.low<b.fair-.02);
 assert.equal(E.modelBenchmark(p,rs,now,.9).known,false);
 assert.equal(E.modelBenchmark(p,rs,now-180*864e5,.5).known,false);
 assert.equal(E.modelBenchmark(p,rs.map(r=>({...r,eventId:'same'})),now,.5).known,false);
 assert.equal(E.modelBenchmark(p,rs.map(r=>({...r,model:false})),now,.5).known,false);
});
test('Polymarket history excludes both-side buys, in-play buys and incomplete closing buckets',async()=>{
 globalThis.SharpEngine=E;
 const H=require('./history.js'),time=Date.now(),game=time-864e5;
 const trade=(token,cond,slug,ts)=>({token_id:token,condition_id:cond,event_slug:slug,outcome_index:0,type:'TRADE',side:'BUY',price:.5,size:100,timestamp:Math.floor(ts/1000),transaction_hash:'tx'});
 const rows=[trade('good','c1','good',game-3600000),trade('hedgeA','c2','hedge',game-3600000),trade('hedgeB','c2','hedge',game-3500000),trade('live','c3','live',game+10000),trade('bucket','c4','bucket',game-3600000)];
 const get=async url=>{
  const u=new URL(url);
  if(u.pathname==='/v2/activity')return {data:rows,pagination:{next_cursor:null}};
  if(u.pathname==='/events')return ['good','hedge','live','bucket'].map((slug,i)=>({slug,tags:[{slug:'nba'}],markets:[{conditionId:'c'+(i+1),gameStartTime:new Date(game).toISOString()}]}));
  if(u.pathname==='/v2/resolutions')return {data:['c1','c4'].map(condition_id=>({condition_id,status:'resolved',payouts:[1000000,0],resolved_at:new Date(game+100000).toISOString()}))};
  if(u.pathname==='/v2/prices-history')return {data:[{timestamp:Math.floor(game/1000)-30,price:.6,resolution_seconds:u.searchParams.get('token_id')==='bucket'?60:0}]};
  throw Error('unexpected '+url);
 };
 const pool=async(items,n,fn)=>Promise.all(items.map(fn));
 const result=await H.build({traders:[{wallet,name:'A'}],get,pool,data:'https://data.test',gamma:'https://gamma.test',classifySport:()=> 'NBA'});
 assert.equal(result.records.length,1);assert.equal(result.records[0].token,'good');assert.equal(result.counts.missingClose,1);near(result.records[0].entryAllIn,.5125);
 const broken=await H.build({traders:[{wallet,name:'A'}],get:async()=>{throw Error('HTTP 503');},pool,data:'https://data.test',gamma:'https://gamma.test',classifySport:()=> 'NBA'});
 assert.equal(broken.records.length,0);assert.equal(broken.counts.failedWallets,1);
});
test('forward replay uses frozen evidence and reproduces settlement P&L without future results',()=>{
 const {replay}=require('./replay.js');
 const settings={budget:100,minEdge:.02,minWin:0,buffer:.02,minSharps:2,maxOpposition:0,minGames:100,freshMinutes:120,maxSpread:.03};
 const evidence={version:1,odds:odds(),history:history(),clusters:{}};
 const activity=[{token_id:'1',type:'TRADE',side:'BUY',size:100,timestamp:now/1000-10}];
 const a=E.assess(p,{evidence,now,book,info,quoteAt:now,activity,settings,cons:{qualified:2,opposingQualified:0,netWeight:1}});
 const row={id:'signal',detectedAt:now,assessment:a,quote:{book,info,quoteAt:now},evidence,settings,qualified:true,scanComplete:true,status:'settled',payout:1};
 const result=replay({version:1,entries:[row]});assert.equal(result.mismatches,0);near(result.qualified.pnl,a.ex.shares-a.ex.total);
 const changed=structuredClone(row);changed.detectedAt=now+31000;
 assert.equal(replay({version:1,entries:[changed]}).rows[0].eligible,false);
});

test('large-wallet cost validation scales linearly and preserves unknown-cost rejection',()=>{
 let reads=0;const rows=Array.from({length:1000},(_,i)=>({asset:String(i),oppositeAsset:'none',size:10,get entryCost(){reads++;return i===999?null:5;}}));
 const value=E.exposure(rows);
 assert.equal(value.length,1000);assert.ok(value.every(p=>p.costKnown===false));assert.ok(reads<20000,'portfolio cost validation must not repeat for every position');
});
