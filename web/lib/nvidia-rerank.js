import {providerKey,freeAllowed} from './multi-provider.js';
import {requestFetch,checkRequest} from './request-control.js';
import {selectPassages} from './retrieval-selection.js';
import {createHash} from 'node:crypto';
export const RERANK_MODEL='nvidia/llama-nemotron-rerank-vl-1b-v2';
const endpoint='https://ai.api.nvidia.com/v1/retrieval/'+RERANK_MODEL+'/reranking';
// One request-local cache: never share private documents or credentials across owners.
export function createReranker({fetcher=requestFetch,key=()=>providerKey('nim'),enabled=()=>process.env.CAPRI_NVIDIA_RERANK!=='false'&&freeAllowed('nim:'+RERANK_MODEL),onUsage=()=>{},maxCalls=2}={}){
 let calls=0;const cache=new Map();
 return async(rows,query,{limit=6,characters=12000}={})=>{
  checkRequest();const fallback=()=>selectPassages(rows,query,{limit,characters});
  if(!enabled()||!key()||rows.length<2)return fallback();
  // Whole candidate passages only. A refused oversize request falls back locally.
  const seen=new Set();let size=0;
  const candidates=rows.filter(r=>{const text=r.content;if(typeof text!=='string'||!text)return false;const id=r.id??text;if(seen.has(id)||size+text.length>30000)return false;seen.add(id);size+=text.length;return true;}).slice(0,12);
  if(candidates.length<2)return fallback();
  const body={model:RERANK_MODEL,query:{text:String(query)},passages:candidates.map(r=>({text:(r.title||r.path||'')+'\n'+r.content})),truncate:'NONE'};
  const signature=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  let ranking=cache.get(signature);
  if(!ranking){
   if(calls>=maxCalls)return fallback();calls++;
   const started=Date.now();
   try{
    const response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key()},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Object.assign(Error('Reranking unavailable'),{status:response.status});
    const data=await response.json();ranking=data.rankings;
    if(!Array.isArray(ranking)||ranking.length!==candidates.length||new Set(ranking.map(r=>r.index)).size!==candidates.length||ranking.some(r=>!Number.isInteger(r.index)||r.index<0||r.index>=candidates.length||!Number.isFinite(r.logit)))throw Error('Invalid ranking');
    cache.set(signature,ranking);onUsage({model:'nim:'+RERANK_MODEL,latencyMs:Date.now()-started,candidates:candidates.length,inputTokens:data.usage?.prompt_tokens,totalTokens:data.usage?.total_tokens,estimatedInput:Math.ceil(Buffer.byteLength(JSON.stringify(body))/4),fallback:false});
   }catch(error){checkRequest();onUsage({model:'nim:'+RERANK_MODEL,latencyMs:Date.now()-started,fallback:true,status:error.status});return fallback();}
  }
  const ranked=ranking.map(r=>({...candidates[r.index],rerankScore:r.logit}));
  return selectPassages(ranked,query,{limit,characters});
 };
}
