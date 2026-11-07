import {requestFetch as fetch} from './request-control.js';
export async function claude(model,request,{signal,apiKey=process.env.ANTHROPIC_API_KEY}={},fetcher=fetch){
 if(!apiKey||process.env.CLAUDE_API_ENABLED!=='true')throw Object.assign(new Error('Claude requires ANTHROPIC_API_KEY and CLAUDE_API_ENABLED=true on the server.'),{status:503});
 const messages=request.contents.map(c=>({role:c.role==='model'?'assistant':'user',content:c.parts.map(p=>p.text!==undefined?{type:'text',text:p.text}:{type:p.inlineData.mimeType==='application/pdf'?'document':'image',source:{type:'base64',media_type:p.inlineData.mimeType,data:p.inlineData.data}})}));
 const response=await fetcher('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:Math.min(request.generationConfig?.maxOutputTokens||4096,8192),system:(request.systemInstruction?.parts||[]).map(p=>p.text).join('\n')+(request.generationConfig?.responseMimeType==='application/json'?'\nReturn only valid JSON, without code fences.':''),messages}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});
 if(!response.ok)throw Object.assign(new Error(response.status===429?'Claude quota or rate limit reached.':'Claude request failed. Check server credentials and model access.'),{status:response.status===429?429:502});
 const data=await response.json(),answer=(data.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('');
 if(!answer)throw Object.assign(new Error('Claude returned no answer.'),{status:502});
 const u=data.usage,input=(u?.input_tokens||0)+(u?.cache_creation_input_tokens||0)+(u?.cache_read_input_tokens||0);
 return {answer,truncated:data.stop_reason==='max_tokens',usage:u?{promptTokenCount:input,candidatesTokenCount:u.output_tokens,cachedContentTokenCount:u.cache_read_input_tokens??0,cacheCreationTokenCount:u.cache_creation_input_tokens??0,totalTokenCount:input+u.output_tokens}:null};
}
