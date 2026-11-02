import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {CORE,DEFAULTS,collect,quote,assessOne,rankUnique,readPublic,DATA} from './scanner.mjs';
const now=Date.now(),condition='0x'+'a'.repeat(64),traders=CORE.slice(0,2);
const raw={token_id:'42',condition_id:condition,current_size:10000,avg_price:.5,entry_cost_usdc:5000,total_cost_usdc:5125,current_price:.5,current_value:5000,event_slug:'nba-test',outcome:'Yes',outcome_index:0,opposite_token_id:'43',redeemable:false,title:'Test NBA game'};
const options={sport:'NBA',limit:3,settings:{...DEFAULTS},asOf:now};
async function get(url){const u=new URL(url);if(u.pathname==='/v2/positions')return {data:[raw],pagination:{next_cursor:null}};if(u.pathname==='/v2/activity')return {data:[{token_id:'42',type:'TRADE',side:'BUY',size:10000,timestamp:Math.floor(now/1000)-60,price:.5}],pagination:{next_cursor:null}};if(u.pathname==='/events')return [{slug:'nba-test',tags:[{slug:'nba'}],markets:[{conditionId:condition,gameStartTime:new Date(now+3600000).toISOString()}]}];if(u.pathname==='/book')return {asset_id:'42',market:condition,timestamp:now,_fetchedAt:now,asks:[{price:'.5',size:'10000'}],bids:[{price:'.49',size:'10000'}]};if(u.pathname.startsWith('/clob-markets/'))return {t:[{t:'42'}],fd:{r:.05,e:1},mos:1,ao:true};throw Error('Unexpected URL');}
const evidence={version:1,odds:[],clusters:{},history:traders.flatMap(t=>Array.from({length:120},(_,i)=>({wallet:t.wallet,sport:'NBA',eventId:'game'+i,source:'synthetic',entryAt:new Date(now-(200-i)*864e5).toISOString(),settledAt:new Date(now-(199-i)*864e5).toISOString(),stake:100,pnlNet:i<110?90:-100,entryAllIn:.5125,closingProbability:.6,costsIncluded:true,model:true,payout:i<110?1:0,feeAssumption:.05})))};
test('headless scanner shares dashboard roster and does not silently drift',async()=>{const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),core=runInNewContext('('+html.match(/const CORE = (\[.*?\n\]);/s)[1]+')');assert.equal(JSON.stringify(core),JSON.stringify(CORE));});
test('public data collector, shared model and execution price produce an eligible outcome',async()=>{const scan=await collect(get,traders,options);assert.equal(scan.complete,true);assert.equal(scan.positions.length,2);const q=await quote(scan.candidates[0],get),a=assessOne(scan.candidates[0],scan,evidence,options,q,now);assert.equal(a.eligible,true);assert.equal(a.cons.qualified,2);assert.equal(rankUnique([a]).length,1);assert.ok(a.ex.total<=100);});
test('an incomplete wallet blocks picks even when another wallet has strong history',async()=>{const scan=await collect(async url=>{if(url.includes(traders[1].wallet))throw Error('API failed');return get(url);},traders,options);assert.equal(scan.complete,false);const a=assessOne(scan.candidates[0],scan,evidence,options,await quote(scan.candidates[0],get),now);assert.equal(a.eligible,false);assert.ok(a.reasons.includes('Incomplete roster scan'));});
test('display filters do not erase full-roster opposing positions',async()=>{const scan=await collect(get,traders,options);const p=scan.candidates[0];scan.positions.push({...p,wallet:'0x'+'9'.repeat(40),trader:'Opposition',outcomeIndex:1,outcome:'No',currentValue:1,conv:.00001});const a=assessOne(p,scan,evidence,options,await quote(p,get),now);assert.equal(a.cons.opponents.length,1);});
test('cached quotes retain actual fetch time and wrong token books are rejected',async()=>{const p=(await collect(get,traders,options)).candidates[0];const old=await quote(p,async url=>{const r=await get(url);if(url.includes('/book?'))r._fetchedAt=now-40000;return r;});assert.equal(old.quoteAt,now-40000);const a=assessOne(p,await collect(get,traders,options),evidence,options,old,now);assert.equal(a.eligible,false);await assert.rejects(quote(p,async url=>{const r=await get(url);if(url.includes('/book?'))r.asset_id='wrong';return r;}),/mismatched/);});
test('collector cannot be redirected to arbitrary private or credentialed origins',async()=>{await assert.rejects(readPublic('http://127.0.0.1/secret'),/origin/);await assert.rejects(readPublic(DATA.replace('https://','https://user:pass@')+'/v2/activity'),/origin/);});
test('event compaction drops non-game market inventories but retains exact game starts',async()=>{const {compact}=await import('./scanner.mjs');const r=compact('https://gamma-api.polymarket.com/events',[{slug:'test',tags:[{slug:'sports'}],markets:[{conditionId:'future',gameStartTime:null},{conditionId:'game',gameStartTime:'2026-11-03T00:00:00Z'}]}]);assert.equal(r[0].markets.length,1);assert.equal(r[0].markets[0].conditionId,'game');});
test('Workflow metadata compaction retains only conditions observed in its own activity or positions',async()=>{const {compact}=await import('./scanner.mjs');const rows=[{slug:'season',markets:Array.from({length:12000},(_,i)=>({conditionId:'condition'+i,gameStartTime:'2026-11-03T00:00:00Z'}))}];const value=compact('https://gamma-api.polymarket.com/events',rows,new Set(['condition42']));assert.equal(value[0].markets.length,1);assert.equal(value[0].markets[0].conditionId,'condition42');assert.ok(JSON.stringify(value).length<1000);});

test('foreground wallet activity covers the configured freshness window and keeps only held-token fields',async()=>{
 const {fetchWallet}=await import('./scanner.mjs');let start;
 const value=await fetchWallet(traders[0],async url=>{const u=new URL(url);if(u.pathname==='/v2/activity'){start=Number(u.searchParams.get('start'));const r=await get(url);r.data.push({token_id:'not-held',type:'TRADE',side:'BUY',timestamp:now/1000,size:100});r.data[0].transaction_hash='unused';return r;}return get(url);},now);
 assert.equal(start,Math.floor(now/1000)-DEFAULTS.freshMinutes*60);assert.equal(value.activity.length,1);assert.equal(value.activity[0].token_id,'42');assert.equal('transaction_hash'in value.activity[0],false);
});

test('large-wallet row compaction preserves hidden hedge shares and the full portfolio cost denominator',async()=>{
 const E=(await import('../engine.js')).default,{fetchWallet}=await import('./scanner.mjs');
 const rows=[raw,{...raw,token_id:'43',opposite_token_id:'42',current_size:3000,current_price:.0001,current_value:.3,entry_cost_usdc:1500},{...raw,token_id:'dust',opposite_token_id:'none',current_size:10,current_price:0,current_value:0,entry_cost_usdc:5000}];
 const value=await fetchWallet(traders[0],async url=>new URL(url).pathname==='/v2/positions'?{data:rows,pagination:{next_cursor:null}}:get(url),now);
 const expected=E.exposure(rows.map(E.position))[0],actual=value.positions[0];
 for(const key of ['paired','netShares','costBook','conv','costKnown'])assert.equal(actual[key],expected[key],key);
 assert.equal(value.positions.length,1);
});

test('metadata requests omit irrelevant outcomes while preserving all scanned positions',async()=>{
 let metadata;
 const scan=await collect(async url=>{
  const u=new URL(url);
  if(u.pathname==='/v2/positions')return {data:[raw,{...raw,token_id:'tiny',condition_id:'0x'+'b'.repeat(64),event_slug:'unrelated-small-holding',current_size:10,current_value:5,entry_cost_usdc:5}],pagination:{next_cursor:null}};
  if(u.pathname==='/events')metadata=u.searchParams.getAll('slug');
  return get(url);
 },traders,options);
 assert.deepEqual(metadata,['nba-test']);assert.equal(scan.positions.length,4);assert.equal(scan.scannedWallets,2);assert.equal(scan.complete,true);
});

test('cached wallet pages discard redeemed rows and unused fields while preserving cursor and hedge economics',async()=>{
 const {compactWalletPage}=await import('./scanner.mjs');const page={data:[raw,{...raw,token_id:'redeemed',redeemable:true},{...raw,token_id:'thin',current_price:.0001,current_value:.01,current_size:100,entry_cost_usdc:12}],pagination:{next_cursor:'opaque'}};
 const slim=compactWalletPage(page);assert.equal(slim.data.length,2);assert.equal(slim.pagination.next_cursor,'opaque');assert.equal(slim.data[0].title,raw.title);assert.equal(slim.data[1].title,undefined);assert.equal(slim.data[1].current_size,100);assert.equal(slim.data[1].entry_cost_usdc,12);assert.equal(slim.data[1].opposite_token_id,raw.opposite_token_id);
});
