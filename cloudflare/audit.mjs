#!/usr/bin/env node
// Read-only private journal export and paper-results summary. Never places orders or posts messages.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {paperSummary,settlementKey,closeKey,PREFIX,publicationKey} from './journal.mjs';
export async function exportJournal(cache){
 const runs=[],publications={},settlements={},closes={};let cursor;
 do{const page=await cache.list({prefix:PREFIX,cursor});for(const k of page.keys||[]){if(k.name.endsWith('/publication'))continue;const run=await cache.get(k.name,{type:'json'});if(!run)continue;runs.push(run);const receipt=await cache.get(publicationKey(k.name),{type:'json'});if(receipt)publications[run.runId]=receipt;}cursor=page.list_complete?null:page.cursor;if(!page.list_complete&&!cursor)throw Error('Incomplete journal key listing');}while(cursor);
 const entries=runs.flatMap(r=>r.entries||[]);
 for(const c of new Set(entries.map(e=>e.position.conditionId))){const r=await cache.get(settlementKey(c),{type:'json'});if(r)settlements[c]=r;}
 for(const p of new Map(entries.map(e=>[e.position.asset+'|'+e.position.game,e.position])).values()){const r=await cache.get(closeKey(p.asset,p.game),{type:'json'});if(r)closes[p.asset+'|'+p.game]=r;}
 return{version:1,exportedAt:new Date().toISOString(),runs,publications,settlements,closes};
}
function remoteCache(){
 const token=process.env.CLOUDFLARE_API_TOKEN||process.env.CLOUDFLARE_OAUTH_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID,namespace=process.env.POLYSHARP_KV_ID;
 if(!token||!account||!namespace)throw Error('Set Cloudflare token, account ID and POLYSHARP_KV_ID in the environment; never commit credentials.');
 const base=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/storage/kv/namespaces/${encodeURIComponent(namespace)}`;
 async function request(path){const r=await fetch(base+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});if(r.status===404)return null;if(!r.ok)throw Error('Private journal read HTTP '+r.status);return r.json();}
 return{get:async key=>request('/values/'+encodeURIComponent(key)),list:async({prefix,cursor})=>{const q=new URLSearchParams({prefix,limit:'1000'});if(cursor)q.set('cursor',cursor);const j=await request('/keys?'+q);if(!j?.success||!Array.isArray(j.result))throw Error('Private journal key listing failed');return{keys:j.result,cursor:j.result_info?.cursor,list_complete:!j.result_info?.cursor};}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2),remote=args[0]==='--remote';if(!args[0])throw Error('Usage: node cloudflare/audit.mjs export.json OR --remote [export.json]');const data=remote?await exportJournal(remoteCache()):JSON.parse(await fs.readFile(args[0],'utf8'));if(remote&&args[1])await fs.writeFile(args[1],JSON.stringify(data,null,2)+'\n',{mode:0o600});process.stdout.write(JSON.stringify(paperSummary(data),null,2)+'\n');}catch(e){console.error(e.message);process.exitCode=1;}
}
