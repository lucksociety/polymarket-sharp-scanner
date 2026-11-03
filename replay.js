#!/usr/bin/env node
'use strict';
// Reproduce forward observations; never use later results to choose a wallet.
const fs=require('node:fs'),E=require('./engine.js');
function replay(journal){
 if(journal.version!==1||!Array.isArray(journal.entries))throw Error('Expected a version 1 exported paper journal');
 const rows=journal.entries.map(r=>{
  const a=r.assessment,q=r.quote;
  if(!a?.p||!q||!r.evidence||!r.settings||!Number.isFinite(r.detectedAt))throw Error('Missing frozen detection evidence');
  // Consensus at detection is frozen from the full roster, not rebuilt from final winners.
  const check=E.assess(a.p,{evidence:E.validateEvidence(r.evidence),now:r.detectedAt,book:q.book,info:q.info,quoteAt:q.quoteAt,activity:[],settings:r.settings,cons:a.cons});
  // Replay the raw freshness evidence captured in the assessment; the full trade feed is not exported.
  const reasons=check.reasons.filter(x=>x!=='No recent net buying');
  if(!a.flow?.fresh)reasons.push('No recent net buying');
  if(!r.scanComplete)reasons.push('Scan incomplete; support/opposition may be missing');
  const eligible=reasons.length===0;
  const settled=r.status==='settled'&&E.number(r.payout)&&r.payout>=0&&r.payout<=1;
  return {id:r.id,detectedAt:new Date(r.detectedAt).toISOString(),eligible,recordedEligible:r.qualified,eligibilityMatches:eligible===r.qualified,
   edge:check.edge,roi:check.roi,reasons,settled,cost:a.ex.total,pnl:settled?r.payout*a.ex.shares-a.ex.total:null};
 });
 const summarize=rs=>{const done=rs.filter(r=>r.settled),cost=done.reduce((s,r)=>s+r.cost,0),pnl=done.reduce((s,r)=>s+r.pnl,0);return {entries:rs.length,settled:done.length,pnl,roi:cost?pnl/cost:null};};
 return {warning:'Observational replay, not a historical copy-fill backtest. Correlated/repeated entries and roster survivor bias remain.',all:summarize(rows),qualified:summarize(rows.filter(r=>r.eligible)),mismatches:rows.filter(r=>!r.eligibilityMatches).length,rows};
}
if(require.main===module){try{if(!process.argv[2])throw Error('Usage: node replay.js exported-journal.json');console.log(JSON.stringify(replay(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={replay};
