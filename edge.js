/* Evidence, executable quotes and forward paper tracking for the static scanner. */
'use strict';
const EdgeUI=(()=>{
  const E=SharpEngine,CLOB='https://clob.polymarket.com';
  const DEFAULTS={budget:100,minEdge:.02,minWin:0,buffer:.02,minSharps:2,maxOpposition:0,minGames:100,freshMinutes:120,maxSpread:.03};
  const empty=()=>({version:1,odds:[],history:[],clusters:{}});
  let storageError='';
  function read(k,fallback){try{return JSON.parse(localStorage.getItem(k))??fallback;}catch(e){storageError='Browser storage unavailable or invalid. Export your work before leaving.';return fallback;}}
  let evidence=empty();try{evidence=E.validateEvidence(read('sharp.evidence.v1',empty()));}catch(e){storageError='Saved evidence rejected: '+e.message;}
  let paper=read('sharp.paper.v1',[]);if(!Array.isArray(paper))paper=[];
  let settings={...DEFAULTS,benchmarkMode:'polymarket'},quotes=new Map(),assessments=[],busy=false;
  let historyCancelled=false;
  let sourceURL=read('sharp.source.v1',''),message='Use Build Polymarket history, then SCAN and refresh quotes. No external odds provider is required for model screening.';
  function save(k,value){try{localStorage.setItem(k,JSON.stringify(value));return true;}catch(e){storageError='Storage write failed. Export data now to preserve it.';return false;}}
  function download(name,value){const u=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  const fmt=(v,n=1)=>Number.isFinite(v)?(100*v).toFixed(n)+'%':'—';
  const cash=v=>Number.isFinite(v)?'$'+v.toFixed(2):'—';
  const stamp=v=>v?new Date(v).toLocaleString():'Unknown';
  document.head.insertAdjacentHTML('beforeend',`<style>
    .edge-panel{border:1px solid var(--line2);border-radius:16px;padding:18px;background:var(--card);margin:24px 0}
    .edge-panel h2{font:400 25px var(--deco);color:var(--gold-hi);margin:0 0 10px}
    .edge-panel p{font-size:13px;color:var(--muted);line-height:1.6}
    .edge-controls{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
    .edge-controls label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted)}
    .edge-controls input,.edge-controls select,.edge-panel textarea{color:var(--text);background:var(--bg2);border:1px solid var(--line2);border-radius:7px;padding:8px;font:13px var(--sans)}
    .edge-controls input[type=number]{width:105px}.edge-controls input[type=url]{width:min(420px,75vw)}
    .edge-button{border:1px solid var(--line2);background:#1f2a22;color:var(--green-hi);border-radius:8px;padding:9px 12px;cursor:pointer;font:600 12px var(--sans)}
    .edge-button:disabled{opacity:.45;cursor:default}.edge-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:end}
    .edge-panel textarea{width:100%;min-height:120px;margin:12px 0;font-family:var(--mono)}
    .edge-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:12px}
    .edge-card{border:1px solid var(--line2);border-radius:12px;padding:15px;background:var(--bg2)}
    .edge-card.eligible{border-color:var(--green)}.edge-card h3{font-size:14px;margin:9px 0;line-height:1.5}
    .edge-card dl{display:grid;grid-template-columns:1fr 1fr;font-size:12px;gap:8px;margin:12px 0}.edge-card dt{color:var(--muted)}.edge-card dd{margin:0;text-align:right;font-family:var(--mono)}
    .edge-card small{display:block;color:var(--muted);line-height:1.5;margin:8px 0}.edge-warning{color:var(--gold-hi)!important;white-space:pre-line}
    .edge-scroll{overflow:auto}.edge-status{font-size:13px;line-height:1.6;white-space:pre-line;color:var(--muted)}
  </style>`);
  document.querySelector('#playsSec').insertAdjacentHTML('beforebegin',`<section class="edge-panel" id="edgePanel">
    <h2>Price & Evidence Screener</h2>
    <p>The Polymarket-only model uses resolved pregame buys, historical prices, and executable quotes. A shortlist requires sport-specific historical performance, fresh net buying and qualified support. Modeled edge is not an independent sportsbook valuation. Estimates are uncertain. Open cost share excludes cash and external hedges; wallet independence is unknown unless you provide related-wallet groups.</p>
    <div class="edge-controls" id="edgeSettings">
      <label>Probability source<select id="edge-benchmarkMode"><option value="polymarket">Polymarket historical model</option><option value="independent">Independent odds (optional import)</option></select></label>
      <label>Order budget ($)<input id="edge-budget" type="number" min="1" max="1000000" step="1" value="100"></label>
      <label>Min net edge (¢/share)<input id="edge-minEdge" type="number" min="0" max="50" step=".1" value="2"></label>
      <label>Min estimated win (%)<input id="edge-minWin" type="number" min="0" max="99" step="1" value="0"></label>
      <label>Probability buffer (pp)<input id="edge-buffer" type="number" min="0" max="30" step=".5" value="2"></label>
      <label>Qualified supporters<input id="edge-minSharps" type="number" min="1" max="20" step="1" value="2"></label>
      <label>Max qualified opponents<input id="edge-maxOpposition" type="number" min="0" max="20" step="1" value="0"></label>
      <label>Min prior games<input id="edge-minGames" type="number" min="30" max="10000" step="1" value="100"></label>
      <label>Net buying within (min)<input id="edge-freshMinutes" type="number" min="5" max="1440" step="5" value="120"></label>
      <label>Max spread (¢)<input id="edge-maxSpread" type="number" min="0" max="50" step=".5" value="3"></label>
      <label>Show<select id="edge-mode"><option value="all">All candidates + exclusion reasons</option><option value="eligible">Qualified shortlist only</option></select></label>
    </div>
    <div class="edge-controls"><label>Historical assumed fee rate (%)<input id="history-fee" type="number" min="0" max="25" step=".5" value="5"></label><label>Max pages / wallet (1,000 trades each)<input id="history-pages" type="number" min="1" max="1000" step="1" value="100" required></label><button class="edge-button" id="history-build">Build Polymarket history (180 days)</button><button class="edge-button" id="history-stop" disabled>Stop history build</button></div><p>History models the first observed pregame buy per wallet/market in the last 180 days, held through official resolution with a fixed $100 entry and the assumed fee rate × p × (1−p). Both-side buyers are excluded. These are hypothetical returns at trader prices, not actual account profits or delayed copy fills. Current-roster selection creates survivor bias. Closing prices require a strictly pregame observation within 15 minutes; missing historical coverage is reported.</p><div class="edge-actions"><button class="edge-button" id="edge-quotes">Refresh quotes (first 60 candidates)</button><button class="edge-button" id="edge-export">Export evidence</button><button class="edge-button" id="edge-template">Download input template</button></div>
    <p class="edge-status" id="edgeStatus" role="status" aria-live="polite"></p>
    <details><summary>Independent odds & trader evidence</summary>
      <p>Import a version 1 JSON file. Odds need at least two distinct books, snapshots no older than 15 minutes, every mutually exclusive outcome, decimal odds, and confirmation that the line, overtime, draw and settlement rules match this exact condition. Source labels and wallet groups are your assertions, not independently audited. History needs all results including losses, after-cost P&L and closing probabilities; one row per wallet/game/entry. Qualification requires the minimum games, 90+ days, positive cost-weighted CLV and profit remaining after removing the biggest winning game.</p>
      <div class="edge-actions"><label class="edge-button">Import JSON<input id="edge-file" type="file" accept="application/json,.json"></label></div>
      <textarea id="edge-json" aria-label="Evidence JSON" placeholder="Paste evidence JSON here"></textarea>
      <button class="edge-button" id="edge-import">Validate & replace evidence</button>
      <div class="edge-controls"><label>Optional public evidence feed URL<input id="edge-url" type="url" placeholder="https://your-feed.example/evidence.json"></label><button class="edge-button" id="edge-fetch">Fetch evidence feed</button></div>
      <p>A feed must return the same JSON schema and allow browser CORS. No paid odds service or secret API key is bundled. Import replaces the full dataset; keep complete losing and winning records. Evidence is stored in this browser only.</p>
    </details>
    <p class="edge-warning" id="edgeWarnings"></p><p id="edgeCount"></p><div class="edge-grid" id="edgeCards"></div>
  </section>
  <section class="edge-panel"><h2>Forward Paper Journal</h2>
    <p>Paper entries freeze the detection time, roster, settings, evidence and available quote. No orders are placed. Unqualified entries remain marked as research. One outcome per market per scan can be logged; repeat scans are separate experiments, not independent bets. Multiple bets on the same game may be correlated. Quotes expire after 30 seconds and the scan after 5 minutes.</p>
    <div class="edge-actions"><button class="edge-button" id="paper-export">Export journal & snapshots</button><button class="edge-button" id="paper-settle">Check official resolutions</button></div><p id="paperStats"></p><div class="edge-scroll" id="paperRows"></div>
  </section>`);
  document.querySelector('#edge-url').value=sourceURL;
  document.querySelectorAll('#edgeSettings input[type=number],#history-fee').forEach(el=>el.required=true);
  function candidates(){
    const now=Date.now(),cons=E.consensus(STATE.positions,evidence,now,settings),byKey=new Map();
    for(const p of filtered()) {
      if(!p.isGame||p.game<=now||!(p.netShares>0)||p.outcomeIndex===999)continue;
      const quote=quotes.get(p.asset)||{};
      const a=E.assess(p,{evidence,now,...quote,settings,cons:cons.get(E.key(p)),activity:STATE.activity?.[p.wallet]});
      if(!STATE.complete)a.reasons.push('Scan incomplete; support/opposition may be missing');
      a.eligible=a.reasons.length===0;
      const k=E.key(p),prev=byKey.get(k);
      if(!prev||+a.eligible>+prev.eligible||a.eligible===prev.eligible&&
        (a.reasons.length<prev.reasons.length||a.reasons.length===prev.reasons.length&&(a.roi??-Infinity)>(prev.roi??-Infinity)||
         a.reasons.length===prev.reasons.length&&a.roi===prev.roi&&p.conv>prev.p.conv))byKey.set(k,a);
    }
    return [...byKey.values()].sort((a,b)=>+b.eligible-+a.eligible||(b.roi??-Infinity)-(a.roi??-Infinity)||(b.cons?.qualified||0)-(a.cons?.qualified||0)||b.p.conv-a.p.conv);
  }
  function render(){
    assessments=candidates();
    const qualified=assessments.filter(a=>a.eligible),mode=document.querySelector('#edge-mode').value;
    const displayed=(mode==='eligible'?qualified:assessments).slice(0,60);
    document.querySelector('#edgeStatus').textContent=message+`\nEvidence: ${evidence.odds.length} book snapshots · ${evidence.history.length} historical entries. ${storageError}`;
    document.querySelector('#edgeWarnings').textContent=(STATE.warnings||[]).join('\n');
    document.querySelector('#edgeCount').textContent=`${qualified.length} qualified · ${assessments.length} upcoming outcome candidates · showing ${displayed.length}. Ranked by conservative expected return after costs. Existing sport, size and open cost share filters apply to candidate display; consensus always uses the full scan.`;
    document.querySelector('#edge-quotes').disabled=busy||!assessments.length;
    document.querySelector('#edgeCards').innerHTML=displayed.map(a=>{
      const p=a.p,c=a.cons||{supporters:[],opponents:[],qualified:0,opposingQualified:0},q=a.q;
      return `<article class="edge-card ${a.eligible?'eligible':''}"><span class="pill ${a.eligible?'':'dim'}">${a.eligible?(a.b.model?'Model candidate':'Evidence candidate'):'Research · excluded'}</span>
      <h3><a href="https://polymarket.com/event/${encodeURIComponent(p.eventSlug)}" target="_blank" rel="noopener">${esc(p.title)}</a></h3><b>${esc(p.outcome)}</b> · ${esc(p.sport)}<small>Starts ${esc(stamp(p.game))}<br>Condition: ${esc(p.conditionId)}<br>Outcome: ${esc(p.outcome)} · token ${esc(p.asset)}</small>
      <dl><dt>Fair estimate / conservative</dt><dd>${fmt(a.b.fair)} / ${fmt(a.b.low)}</dd><dt>Executable all-in / share</dt><dd>${a.ex.known?cash(a.ex.allIn):'Unknown'}</dd><dt>Conservative edge / return</dt><dd>${a.edge!==null?(a.edge*100).toFixed(2)+'¢':''} / ${fmt(a.roi)}</dd><dt>Qualified support / opposition</dt><dd>${c.qualified} / ${c.opposingQualified}</dd><dt>Total observed support / opposition</dt><dd>${c.supporters.length} / ${c.opponents.length}</dd><dt>${a.b.model?"Prior games in price bucket":"Independent book sources"}</dt><dd>${a.b.model?(a.b.games??0):a.b.books}</dd></dl>
      <small>Representative: ${esc(p.trader)} · ${fmt(p.conv)} of open entry cost.<br>${esc(q.label)}: ${q.games} prior games · ROI ${fmt(q.roi)} · CLV ${fmt(q.clv)}.<br>Recent net flow: ${a.flow.net.toFixed(1)} shares; last buy ${esc(stamp(a.flow.lastBuy))}.<br>Support: ${c.supporters.map(x=>esc(x.trader)+(x.qualified?' ✓':' (unverified)')).join(', ')||'None'}<br>Opposition: ${c.opponents.map(x=>esc(x.trader)+(x.qualified?' ✓':' (unverified)')).join(', ')||'None observed'}<br>${a.b.model?"Historical evidence through":"Odds as of"} ${esc(stamp(a.b.asOf))}; quote fetched ${esc(stamp(quotes.get(p.asset)?.quoteAt))}.</small>
      <p class="edge-warning">${a.reasons.map(esc).join(' · ')||'All configured gates passed. Model probabilities are observational estimates; selection bias and correlated games remain.'}</p>
      <div class="edge-actions"><button class="edge-button" data-quote="${esc(p.asset)}" ${busy?'disabled':''}>Refresh this quote</button><button class="edge-button" data-paper="${esc(p.asset)}" ${!a.ex.known||!a.ex.filled||a.reasons.includes('Refresh executable quote')||a.reasons.includes('Rescan positions and activity')?'disabled':''}>Log paper entry</button></div>
      <details><summary>Execution details</summary><p>Shares ${a.ex.shares?.toFixed(4)??'—'} · cost ${cash(a.ex.cost)} · fees ${cash(a.ex.fees)} · spread ${a.ex.spread===null?'unknown':fmt(a.ex.spread)} · slippage ${fmt(a.ex.slippage)}. Taker fee uses this market’s rate and exponent across all consumed ask levels. No rebates assumed.</p></details></article>`;
    }).join('')||'<p>No candidates match. Scan the roster and adjust the display filters. Missing evidence will never produce a qualified shortlist.</p>';
    renderPaper();
  }
  async function fetchQuote(p){
    const [book,info]=await Promise.all([getJSON(`${CLOB}/book?token_id=${encodeURIComponent(p.asset)}`),getJSON(`${CLOB}/clob-markets/${encodeURIComponent(p.conditionId)}`)]);
    if(book.asset_id!==p.asset||book.market!==p.conditionId||!Array.isArray(info.t)||!info.t.some(t=>t.t===p.asset))throw Error('Quote identity mismatch');
    if(info.ao===false)throw Error('Market not accepting orders');
    quotes.set(p.asset,{book,info,quoteAt:Date.now()});
  }
  async function refresh(assets){
    if(busy)return;busy=true;message='Fetching order books and market-specific fees…';render();
    let ok=0;const errors=[];
    try{await pool(assets,3,async p=>{try{await fetchQuote(p);ok++;}catch(e){quotes.delete(p.asset);errors.push(`${p.title}: ${e.message}`);}});}
    finally{busy=false;message=`${ok}/${assets.length} quotes refreshed. ${errors.length?errors.slice(0,3).join(' · '):'Quotes expire after 30 seconds.'}`;render();}
  }
  function importEvidence(data){evidence=E.validateEvidence(data);save('sharp.evidence.v1',evidence);message='Evidence validated and replaced. Qualification is based on your imported records, not an independent audit.';render();}
  function paperEntry(asset){
    const a=candidates().find(a=>a.p.asset===asset);
    if(!a||!a.ex.known||!a.ex.filled||a.reasons.includes('Refresh executable quote')||a.reasons.includes('Rescan positions and activity'))throw Error('Refresh the scan and executable quote before logging');
    const id=`${STATE.scannedAt.toISOString()}|${E.key(a.p)}`;
    if(paper.some(r=>r.id===id))throw Error('This outcome is already logged for this scan');
    if(paper.length>=1000)throw Error('Journal limit reached (1,000). Export it before starting a new browser journal.');
    const now=Date.now(),p=a.p;
    const snapshot={id,detectedAt:now,scanAt:STATE.scannedAt.toISOString(),gameAt:p.game,conditionId:p.conditionId,token:p.asset,outcome:p.outcome,title:p.title,sport:p.sport,
      qualified:a.eligible,reasons:a.reasons,settings:{...settings},assessment:structuredClone(a),quote:quotes.get(asset),
      roster:TRADERS.map(t=>({...t})),scanComplete:STATE.complete,evidence:structuredClone(evidence),status:'pending'};
    paper.push(snapshot);save('sharp.paper.v1',paper);message='Paper entry saved with the evidence and executable quote available at detection.';render();
  }
  function closing(r){
    if(r.polymarketClose)return {...r.polymarketClose,clv:r.polymarketClose.probability-r.assessment.ex.allIn};
    // Allow historical snapshots imported later, but only timestamps just before game start.
    const latest=evidence.odds.filter(o=>o.conditionId===r.conditionId&&Date.parse(o.asOf)>=r.gameAt-15*60000&&Date.parse(o.asOf)<r.gameAt);
    const b=E.benchmark({conditionId:r.conditionId,outcome:r.outcome},latest,r.gameAt,{maxAge:15*60000,buffer:0});
    return b.known?{probability:b.fair,sources:b.sources,asOf:b.asOf,clv:b.fair-r.assessment.ex.allIn}:null;
  }
  function renderPaper(){
    const done=paper.filter(r=>r.status==='settled'),cost=done.reduce((s,r)=>s+r.assessment.ex.total,0),pnl=done.reduce((s,r)=>s+r.pnl,0);
    const wins=done.filter(r=>r.payout>0.999).length,qualified=done.filter(r=>r.qualified),qc=qualified.reduce((s,r)=>s+r.assessment.ex.total,0),qp=qualified.reduce((s,r)=>s+r.pnl,0);
    const clvs=paper.map(closing).filter(Boolean);
    document.querySelector('#paperStats').textContent=`${paper.length} entries · ${done.length} settled · ${wins} full wins · settled P&L ${cash(pnl)} · ROI ${cost?fmt(pnl/cost):'—'} · qualified-only ROI ${qc?fmt(qp/qc):'—'} (${qualified.length} settled) · closing benchmarks ${clvs.length}/${paper.length}. Overlapping entries are not independent.`;
    document.querySelector('#paperRows').innerHTML=`<table><thead><tr><th>Detected</th><th>Market / side</th><th>Entry</th><th>Class</th><th>CLV</th><th>Result / P&L</th></tr></thead><tbody>${paper.slice().reverse().slice(0,100).map(r=>`<tr><td>${esc(stamp(r.detectedAt))}</td><td>${esc(r.title)} · ${esc(r.outcome)}</td><td>${cash(r.assessment.ex.allIn)}</td><td>${r.qualified?'Qualified':'Research'}</td><td>${fmt(closing(r)?.clv)}</td><td>${r.status==='settled'?cash(r.pnl):'Pending'}</td></tr>`).join('')}</tbody></table>`;
  }
  async function settle(){
    const button=document.querySelector('#paper-settle');button.disabled=true;let count=0;const errors=[];
    try{
      const conditions=[...new Set(paper.filter(r=>r.status!=='settled'&&r.gameAt<Date.now()).map(r=>r.conditionId))];
      await pool(conditions,3,async condition=>{try{
        const result=await getJSON(`${DATA}/v2/resolutions?condition=${encodeURIComponent(condition)}`);
        const resolution=(result.data||[]).find(r=>r.condition_id===condition&&r.status==='resolved'&&Array.isArray(r.payouts));
        if(!resolution)return;
        for(const r of paper.filter(r=>r.conditionId===condition&&r.status!=='settled')){
          const value=resolution.payouts[r.assessment.p.outcomeIndex];
          if(!E.number(value)||value<0||value>1000000)continue;
          r.payout=value/1e6;r.pnl=r.payout*r.assessment.ex.shares-r.assessment.ex.total;r.status='settled';r.resolution={checkedAt:Date.now(),source:'Polymarket v2 final payout',data:resolution};count++;
        }
      }catch(e){errors.push(e.message);}});
      await pool(paper.filter(r=>r.gameAt<Date.now()&&!r.polymarketClose),3,async r=>{try{
        const result=await getJSON(`${DATA}/v2/prices-history?token_id=${r.token}&as_of=${Math.floor(r.gameAt/1000)-1}`);
        const point=(result.data||[]).filter(p=>E.number(p.resolution_seconds)&&p.resolution_seconds>=0&&p.timestamp*1000>=r.gameAt-15*60000&&(p.timestamp+p.resolution_seconds)*1000<r.gameAt&&p.price>0&&p.price<1).sort((a,b)=>b.timestamp-a.timestamp)[0];
        if(point)r.polymarketClose={probability:point.price,asOf:point.timestamp*1000,sources:['Polymarket strictly pregame historical mark'],raw:point};
      }catch(e){errors.push(e.message);}});
      save('sharp.paper.v1',paper);message=`${count} paper entries settled. ${errors.length?errors.length+' resolution/closing-price requests failed.':'Unresolved or unconfirmed markets remain pending; missing closing data stays unknown.'}`;
    }finally{button.disabled=false;render();}
  }
  async function loadFeed(){
    const value=document.querySelector('#edge-url').value.trim(),url=new URL(value);
    if(url.protocol!=='https:')throw Error('Evidence feeds must use HTTPS');
    const r=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Evidence feed HTTP '+r.status);
    const text=await r.text();if(text.length>20e6)throw Error('Evidence feed too large');
    importEvidence(JSON.parse(text));sourceURL=value;save('sharp.source.v1',sourceURL);
  }
  async function guarded(fn){try{await fn();}catch(e){message=e.message;render();}}
  document.querySelector('#edgeSettings').addEventListener('change',()=>{
    let valid=true;
    for(const k of Object.keys(DEFAULTS)){
      const el=document.querySelector('#edge-'+k);if(!el.checkValidity()){el.reportValidity();valid=false;break;}
    }
    if(!valid)return;
    for(const k of Object.keys(DEFAULTS)){const el=document.querySelector('#edge-'+k);settings[k]=+el.value/(['minEdge','minWin','buffer','maxSpread'].includes(k)?100:1);}
    settings.benchmarkMode=document.querySelector('#edge-benchmarkMode').value;
    render();
  });
  document.querySelector('#history-build').addEventListener('click',()=>guarded(async()=>{
    const button=document.querySelector('#history-build'),fee=document.querySelector('#history-fee'),pages=document.querySelector('#history-pages'),stop=document.querySelector('#history-stop');
    if(!fee.checkValidity()){fee.reportValidity();return;}if(!pages.checkValidity()){pages.reportValidity();return;}historyCancelled=false;stop.disabled=false;
    button.disabled=true;message='Building Polymarket history. This can take several minutes; keep this tab open.';render();
    try{
      const result=await PolymarketHistory.build({traders:TRADERS,get:url=>{if(historyCancelled)throw Error('Canceled');return getJSON(url);},pool,data:DATA,gamma:GAMMA,feeRate:Number(fee.value)/100,maxPages:Number(pages.value),onProgress:t=>{message=t;document.querySelector('#edgeStatus').textContent=t;}});
      if(historyCancelled)throw Error('History build stopped; previous saved history retained.');
      evidence={...evidence,history:[...evidence.history.filter(r=>!r.model),...result.records],polymarketBuild:{...result,records:undefined}};
      save('sharp.evidence.v1',evidence);message=`Polymarket history: ${result.counts.records} modeled entries, ${result.counts.activity} trades read, ${result.counts.failedWallets} failed wallets. `+result.warnings.slice(0,8).join(' · ');
    }finally{button.disabled=false;stop.disabled=true;render();}
  }));
  document.querySelector('#history-stop').addEventListener('click',()=>{historyCancelled=true;message='Stopping after active requests finish…';render();});
  document.querySelector('#edge-mode').addEventListener('change',render);
  document.querySelector('#edge-import').addEventListener('click',()=>guarded(()=>importEvidence(JSON.parse(document.querySelector('#edge-json').value))));
  document.querySelector('#edge-file').addEventListener('change',e=>guarded(async()=>{const f=e.target.files[0];if(!f)return;if(f.size>20e6)throw Error('File exceeds 20 MB');importEvidence(JSON.parse(await f.text()));}));
  document.querySelector('#edge-fetch').addEventListener('click',()=>guarded(loadFeed));
  document.querySelector('#edge-export').addEventListener('click',()=>download('sharp-evidence.json',evidence));
  document.querySelector('#edge-template').addEventListener('click',()=>download('sharp-input-template.json',{
    version:1,odds:[{conditionId:'0x'+'0'.repeat(64),source:'REPLACE: independent sportsbook',asOf:new Date().toISOString(),outcomes:['Yes','No'],decimalOdds:[1.8,2.1],rules:'REPLACE: exact line, overtime, draw and settlement rules',rulesConfirmed:false}],
    history:[],clusters:{},instructions:'Replace sample odds with real matched markets. Add at least two independent sources per condition. See README for historical row schema and complete example. Never invent performance records.'}));
  document.querySelector('#edge-quotes').addEventListener('click',()=>guarded(()=>refresh(candidates().slice(0,60).map(a=>a.p))));
  document.querySelector('#edgeCards').addEventListener('click',e=>{
    const q=e.target.closest('[data-quote]'),p=e.target.closest('[data-paper]');
    if(q)guarded(()=>refresh(assessments.filter(a=>a.p.asset===q.dataset.quote).map(a=>a.p)));
    if(p)guarded(()=>paperEntry(p.dataset.paper));
  });
  document.querySelector('#paper-export').addEventListener('click',()=>download('sharp-paper-journal.json',{version:1,exportedAt:new Date().toISOString(),entries:paper.map(r=>({...r,closingBenchmark:closing(r)}))}));
  document.querySelector('#paper-settle').addEventListener('click',()=>guarded(settle));
  setInterval(()=>{if(!document.hidden)render();},10000);
  render();
  return {render,afterScan(){quotes.clear();message='Scan finished. Refresh quotes to evaluate current executable value.';render();}};
})();
