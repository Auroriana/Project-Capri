import {requestFetch as fetch} from './request-control.js';
import {credential} from './provider-credentials.js';
import {claude} from './claude.js';
export const providers={groq:{base:'https://api.groq.com/openai/v1',key:'GROQ_API_KEY'},nim:{base:'https://integrate.api.nvidia.com/v1',key:'NVIDIA_API_KEY'},deepseek:{base:'https://api.deepseek.com',key:'DEEPSEEK_API_KEY'},openrouter:{base:'https://openrouter.ai/api/v1',key:'OPENROUTER_API_KEY'},zai:{base:'https://api.z.ai/api/paas/v4',key:'ZAI_API_KEY'},anthropic:{base:'https://api.anthropic.com/v1',key:'ANTHROPIC_API_KEY'}};
export const externalModels=[...['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5','claude-fable-5-1'].map(id=>({id,name:id,provider:'anthropic'})),...['deepseek-flash','deepseek-v4-pro','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].map(id=>({id:'deepseek:'+id,name:id,provider:'deepseek'})),...['openai/gpt-oss-120b','openai/gpt-oss-20b'].map(id=>({id:'groq:'+id,name:'Groq / '+id,provider:'groq'}))];
externalModels.push(...['glm-5.3-flash','glm-5.3','glm-5.3-air'].map(id=>({id:'zai:'+id,name:'Z.ai / '+id,provider:'zai'})));
externalModels.push(...['deepseek-ai/deepseek-v4.1-flash','z-ai/glm-5.3-flash'].map(model=>({id:'nim:'+model,name:'NVIDIA NIM / '+model,provider:'nim'})));
externalModels.push({id:'nim:nvidia/nemotron-3-super-120b-a12b',name:'NVIDIA / Nemotron 3 Super 120B A12B',provider:'nim'});
externalModels.push({id:'nim:nvidia/nemotron-3-ultra-550b-a55b',name:'NVIDIA / Nemotron 3 Ultra 550B A55B',provider:'nim'});
export const providerKey=provider=>credential(provider)?.key||process.env[providers[provider]?.key];
export const providerOf=id=>id.startsWith('claude-')?'anthropic':id.split(':')[0];
export const isExternal=id=>Object.hasOwn(providers,providerOf(id));
export const freeAllowed=id=>{if(process.env.CAPRI_FREE_ONLY==='false')return true;const provider=providerOf(id);return provider==='groq'?(credential('groq')?.freeAccess||process.env.GROQ_FREE_TIER_CONFIRMED==='true'):provider==='nim'?(credential('nim')?.freeAccess||process.env.NVIDIA_FREE_ACCESS_CONFIRMED==='true'):provider==='zai'?(credential('zai')?.freeAccess||process.env.ZAI_FREE_ACCESS_CONFIRMED==='true'):provider==='openrouter'?(id.endsWith(':free')||id==='openrouter:openrouter/free'):false;};
export const ready=id=>{const p=providerOf(id);return freeAllowed(id)&&!!providerKey(p)&&(p!=='anthropic'||process.env.CLAUDE_API_ENABLED==='true');};
let cachedUntil=0,pending;
export async function discoverModels(fetcher=fetch){
 if(!Object.keys(providers).some(p=>credential(p))){if(Date.now()<cachedUntil)return externalModels;if(pending)return pending;}
 pending=(async()=>{await Promise.all(Object.entries(providers).map(async([provider,p])=>{
 if(!providerKey(provider))return;
 try{let after;do{const url=p.base+'/models'+(provider==='anthropic'?'?limit=100'+(after?'&after_id='+encodeURIComponent(after):''):'');const response=await fetcher(url,{headers:provider==='anthropic'?{'x-api-key':providerKey(provider),'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+providerKey(provider)},signal:AbortSignal.timeout(10000)});if(!response.ok)return;const data=await response.json();for(const row of data.data||[]){if(typeof row.id!=='string'||row.id.length>200)continue;const id=provider==='anthropic'?row.id:provider+':'+row.id;if(!externalModels.some(m=>m.id===id))externalModels.push({id,name:provider+' / '+(row.display_name||row.name||row.id),provider});}const next=data.has_more&&data.last_id;if(!next||next===after)break;after=next;}while(provider==='anthropic');}catch{/* Keep known entries if discovery is unavailable. */}
 }));cachedUntil=Date.now()+300000;return externalModels;})();try{return await pending;}finally{pending=null;}
}
// Streamed completions keep long provider queues (NIM cold starts) observable:
// a first-token watchdog fails stalled requests early instead of hanging for
// the full timeout, and an idle timer catches streams that die mid-answer.
function finishExternal(data,provider,model){
 const choice=data.choices?.[0],answer=choice?.message?.content,u=data.usage;
 if((typeof answer!=='string'||!answer.trim())&&choice?.finish_reason==='length')return {answer:'',truncated:true,usage:u?{promptTokenCount:u.prompt_tokens,candidatesTokenCount:u.completion_tokens,totalTokenCount:u.total_tokens}:null};
 if(typeof answer!=='string'||!answer.trim())throw Object.assign(new Error(provider+' / '+model+(choice?.finish_reason==='length'?' exhausted its output budget before producing a final answer.':' returned no final answer.')+' Finish reason: '+(choice?.finish_reason||'missing')+'.'),{status:502});
 return {answer,truncated:choice.finish_reason==='length',usage:u?{promptTokenCount:u.prompt_tokens,candidatesTokenCount:u.completion_tokens,totalTokenCount:u.total_tokens,cachedContentTokenCount:u.prompt_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens??0}:null};
}
async function providerError(response,provider,model,key){
 let detail;try{detail=await response.json();}catch{}
 const raw=detail?.error?.message||detail?.detail||detail?.message||detail?.title||'';
 const safe=String(raw).replaceAll(key,'[redacted]').replace(/Bearer\s+\S+|nvapi-[\w-]+|sk-[\w-]+/gi,'[redacted]').slice(0,400);
 const retryAfter=response.headers.get('retry-after');
 return Object.assign(Error(provider+' / '+model+' failed (HTTP '+response.status+').'+(safe?' '+safe:'')+(retryAfter?' Retry after '+retryAfter+'.':'')),{status:response.status===413?413:response.status===429?429:response.status>=500?503:400,providerStatus:response.status,retryAfter});
}
export async function externalGenerate(id,request,{signal,onToken=()=>{},onAnswerStarted=()=>{}}={},fetcher=fetch){
 if(!ready(id))throw Object.assign(Error('Provider is not enabled under the current key/free-only policy: '+providerOf(id)+'.'),{status:503});
 if(id.startsWith('claude-'))return claude(id,request,{signal,apiKey:providerKey('anthropic')},fetcher);
 const provider=providerOf(id),p=providers[provider],model=id.slice(provider.length+1),key=providerKey(provider);
 if((request.contents||[]).some(c=>c.parts.some(part=>part.inlineData)))throw Object.assign(Error('This adapter currently supports text only. Select Gemini or Claude for attachments.'),{status:400});
 const system=(request.systemInstruction?.parts||[]).map(part=>part.text||'').join('\n')+(request.generationConfig?.responseMimeType==='application/json'?'\nReturn only valid JSON, no code fences.':'');
 const baseBody={model,messages:[{role:'system',content:system},...request.contents.map(c=>({role:c.role==='model'?'assistant':'user',content:c.parts.map(part=>part.text||'').join('\n')}))],max_tokens:request.generationConfig?.maxOutputTokens||4096};
 const positive=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:fallback;};
 const firstTokenMs=positive(process.env.EXTERNAL_FIRST_TOKEN_MS,45000),idleMs=positive(process.env.EXTERNAL_IDLE_MS,45000),totalMs=positive(process.env.EXTERNAL_TOTAL_MS,120000);
 const wantStream=process.env.EXTERNAL_STREAM!=='false';
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 let idleTimer;const totalTimer=setTimeout(()=>controller.abort('total'),totalMs);
 let firstTokenTimer=setTimeout(()=>controller.abort('first-token'),firstTokenMs);
 const resetIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>controller.abort('idle'),idleMs);};
 const transportError=error=>{
  if(error.status||signal?.aborted)return error;
  const reason=String(controller.signal.reason||''),name=provider+' / '+model;
  if(reason==='first-token')return Object.assign(new Error(name+' produced no output within '+Math.round(firstTokenMs/1000)+' seconds. The provider may be cold-starting or its queue is busy. Retry, pick another model, or keep the Gemini fallback configured.'),{status:504});
  if(reason==='idle')return Object.assign(new Error(name+' stopped sending output for '+Math.round(idleMs/1000)+' seconds mid-reply.'),{status:504});
  if(reason==='total')return Object.assign(new Error(name+' exceeded the '+Math.round(totalMs/1000)+'-second limit for this stage.'),{status:504});
  if(['TimeoutError','AbortError'].includes(error.name))return Object.assign(new Error(name+' timed out before returning an answer. Please try again or choose another model.'),{status:504});
  if(error instanceof TypeError)return Object.assign(new Error('Could not reach '+provider+' for '+model+'. The connection failed or was interrupted.'),{status:502});
  return Object.assign(new Error('The request to '+name+' failed.'),{status:502});
 };
 let answer='',usage=null,finishReason=null,answerStarted=false,buffer='',reader=null;
 const frame=line=>{
  if(!line.startsWith('data:'))return;
  const payload=line.slice(5).trim();
  if(!payload||payload==='[DONE]')return;
  let chunk;try{chunk=JSON.parse(payload);}catch{throw Object.assign(new Error(provider+' / '+model+' returned an unreadable stream chunk.'),{status:502});}
  if(chunk.error)throw Object.assign(new Error(provider+' / '+model+' interrupted generation: '+String(chunk.error.message||chunk.error.detail||'unknown').replaceAll(key,'[redacted]').slice(0,300)),{status:502});
  if(chunk.usage)usage=chunk.usage;
  const choice=chunk.choices?.[0];
  if(choice?.finish_reason)finishReason=choice.finish_reason;
  // Any live server-sent event proves the provider accepted and is working on
  // the request; only the idle timer applies from that point on.
  if(firstTokenTimer){clearTimeout(firstTokenTimer);firstTokenTimer=null;}
  const delta=choice?.delta?.content;
  if(typeof delta==='string'&&delta){answer+=delta;if(!answerStarted){answerStarted=true;onAnswerStarted();}onToken(delta);}
 };
 try{
  resetIdle();
  const url=p.base+'/chat/completions',headers={'Content-Type':'application/json',Authorization:'Bearer '+key};
  let response=await fetcher(url,{method:'POST',headers,body:JSON.stringify(wantStream?{...baseBody,stream:true,stream_options:{include_usage:true}}:baseBody),signal:combined});
  if(!response.ok&&response.status===400&&wantStream){
   let detail;try{detail=await response.json();}catch{}
   if(/stream/i.test(String(detail?.error?.message||detail?.detail||detail?.message||'')))
    response=await fetcher(url,{method:'POST',headers,body:JSON.stringify(baseBody),signal:combined});
  }
  if(!response.ok)throw await providerError(response,provider,model,key);
  if(!(response.headers.get('content-type')||'').includes('text/event-stream')){
   // Provider answered with a complete JSON body (ignored or rejected streaming).
   return finishExternal(await response.json(),provider,model);
  }
  if(!response.body)throw Object.assign(new Error(provider+' / '+model+' returned no response stream.'),{status:502});
  reader=response.body.getReader();const decoder=new TextDecoder();
  while(true){
   const {done,value}=await reader.read();if(done)break;
   if(value&&value.length)resetIdle();
   buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
   let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);frame(line);}
   if(buffer.length>200000)throw Object.assign(new Error(provider+' / '+model+' returned an oversized stream buffer.'),{status:502});
  }
  buffer+=decoder.decode();if(buffer.trim())frame(buffer.trim());
 }catch(error){throw transportError(error);}
 finally{clearTimeout(firstTokenTimer);clearTimeout(idleTimer);clearTimeout(totalTimer);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}}
 if(!finishReason)throw Object.assign(new Error(provider+' / '+model+' closed the stream before finishing the answer. Please try again.'),{status:502});
 return finishExternal({choices:[{message:{content:answer},finish_reason:finishReason}],usage},provider,model);
}
