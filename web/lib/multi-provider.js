import {requestFetch as fetch} from './request-control.js';
import {credential} from './provider-credentials.js';
import {claude} from './claude.js';
export const providers={groq:{base:'https://api.groq.com/openai/v1',key:'GROQ_API_KEY'},nim:{base:'https://integrate.api.nvidia.com/v1',key:'NVIDIA_API_KEY'},deepseek:{base:'https://api.deepseek.com',key:'DEEPSEEK_API_KEY'},openrouter:{base:'https://openrouter.ai/api/v1',key:'OPENROUTER_API_KEY'},zai:{base:'https://api.z.ai/api/paas/v4',key:'ZAI_API_KEY'},anthropic:{base:'https://api.anthropic.com/v1',key:'ANTHROPIC_API_KEY'}};
export const externalModels=[...['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5','claude-fable-5-1'].map(id=>({id,name:id,provider:'anthropic'})),...['deepseek-flash','deepseek-v4-pro','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].map(id=>({id:'deepseek:'+id,name:id,provider:'deepseek'})),...['openai/gpt-oss-120b','openai/gpt-oss-20b'].map(id=>({id:'groq:'+id,name:'Groq / '+id,provider:'groq'}))];
externalModels.push(...['glm-5.3-flash','glm-5.3','glm-5.3-air'].map(id=>({id:'zai:'+id,name:'Z.ai / '+id,provider:'zai'})));
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
export async function externalGenerate(id,request,{signal}={},fetcher=fetch){
 if(!ready(id))throw Object.assign(Error('Provider is not enabled under the current key/free-only policy: '+providerOf(id)+'.'),{status:503});
 if(id.startsWith('claude-'))return claude(id,request,{signal,apiKey:providerKey('anthropic')},fetcher);
 const provider=providerOf(id),p=providers[provider],model=id.slice(provider.length+1);
 if((request.contents||[]).some(c=>c.parts.some(p=>p.inlineData)))throw Object.assign(Error('This adapter currently supports text only. Select Gemini or Claude for attachments.'),{status:400});
 const system=(request.systemInstruction?.parts||[]).map(p=>p.text||'').join('\n')+(request.generationConfig?.responseMimeType==='application/json'?'\nReturn only valid JSON, no code fences.':'');
 const body={model,messages:[{role:'system',content:system},...request.contents.map(c=>({role:c.role==='model'?'assistant':'user',content:c.parts.map(p=>p.text||'').join('\n')}))],max_tokens:request.generationConfig?.maxOutputTokens||4096,stream:false};
 const response=await fetcher(p.base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+providerKey(provider)},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});
 if(!response.ok)throw Object.assign(Error(provider+' request failed (HTTP '+response.status+').'),{status:response.status===413?413:response.status===429?429:response.status>=500?503:400,providerStatus:response.status});
 const data=await response.json(),choice=data.choices?.[0],answer=choice?.message?.content,u=data.usage;
 if(typeof answer!=='string'||!answer.trim())throw Object.assign(Error(provider+' returned no answer.'),{status:502});
 return {answer,truncated:choice.finish_reason==='length',usage:u?{promptTokenCount:u.prompt_tokens,candidatesTokenCount:u.completion_tokens,totalTokenCount:u.total_tokens,cachedContentTokenCount:u.prompt_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens??0}:null};
}
