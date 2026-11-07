import {requestFetch as fetch,checkRequest} from './request-control.js';
async function checkGeminiResponse(response,model) {
  if(!response.ok) {
    let reasons=[];try{const errorBody=await response.json();reasons=errorBody.error?.details?.map(d=>d.reason)??[];}catch{}
    const invalidKey=reasons.includes('API_KEY_INVALID');
    throw Object.assign(new Error(invalidKey?'Google rejected the configured Gemini API key. Replace GEMINI_API_KEY in the server environment and restart or redeploy.':response.status===429?'Gemini quota reached. Wait or manually choose another available model.':response.status===404?`${model} is unavailable to your API project. Select another model.`:response.status===400?`Gemini rejected the request settings for ${model} (HTTP 400). Check model compatibility.`:[401,403].includes(response.status)?`Gemini denied access to ${model}. Check the API key and model access.`:response.status>=500?`Gemini is temporarily unavailable for ${model} (HTTP ${response.status}). Try again later.`:'Gemini could not answer. Check the API key, free-tier access, and model availability.'),{status:response.status===429?429:502,providerStatus:response.status,invalidKey});
  }
}
export async function gemini(model,body,fetcher=fetch) {
  let response,data;
  try {
    response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(model==='gemini-3.8-flash'?75000:45000)});
    if(response.ok)data=await response.json();
  } catch(error) {
    const timeout=['TimeoutError','AbortError'].includes(error.name);
    throw Object.assign(new Error(timeout?`${model} timed out before returning an answer. Please try again or choose another model.`:`Could not reach Gemini for ${model}. Check server connectivity and try again.`),{status:timeout?504:502});
  }
  await checkGeminiResponse(response,model);
  const candidate=data.candidates?.[0];
  const answer=candidate?.content?.parts?.filter(p=>!p.thought).map(p=>p.text??'').join('');
  if(!answer) throw Object.assign(new Error('Gemini returned no answer. It may have blocked the request or exhausted its output budget.'),{status:502});
  return {answer,grounding:candidate.groundingMetadata??null,usage:data.usageMetadata??null,truncated:candidate.finishReason==='MAX_TOKENS'};
}
// Google returns public thought summaries as text parts with thought:true.
// Signatures and planner JSON are never forwarded to the UI.
export async function geminiStream(model,body,{onThought=()=>{},onAnswerStarted=()=>{},onUsage=()=>{},onTokenText=()=>{},signal,idleMs=120000,totalMs=270000}={},fetcher=fetch) {
  const controller=new AbortController();let idleTimer,totalTimer,reader,received=false;
  const resetIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>controller.abort('idle'),idleMs);};
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let answer='',usage=null,finishReason,buffer='',answerStarted=false;
  function frame(text){
    const payload=text.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!payload||payload==='[DONE]')return;
    let data;try{data=JSON.parse(payload);}catch{throw Object.assign(new Error('Gemini returned an unreadable stream. Please try again.'),{status:502});}
    if(data.error)throw Object.assign(new Error('Gemini interrupted generation with an upstream error. Please try again.'),{status:502});
    if(data.usageMetadata){usage=data.usageMetadata;onUsage(usage);}
    const candidate=data.candidates?.find(c=>c.index===undefined||c.index===0);
    if(candidate?.finishReason)finishReason=candidate.finishReason;
    for(const part of candidate?.content?.parts??[]){
      if(typeof part.text!=='string'||!part.text)continue;
      onTokenText(part.text);
      if(part.thought===true)onThought(part.text);
      else {answer+=part.text;if(!answerStarted){answerStarted=true;onAnswerStarted();}}
    }
    if(data.promptFeedback?.blockReason)throw Object.assign(new Error('Gemini blocked this request and returned no answer.'),{status:502});
  }
  try{
    resetIdle();totalTimer=setTimeout(()=>controller.abort('deadline'),totalMs);
    const request={...body,generationConfig:{...body.generationConfig,thinkingConfig:{...body.generationConfig?.thinkingConfig,includeThoughts:true}}};
    const response=await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify(request),signal:combined});
    await checkGeminiResponse(response,model);
    if(!response.body)throw Object.assign(new Error('Gemini returned no response stream.'),{status:502});
    reader=response.body.getReader();const decoder=new TextDecoder();
    while(true){
      const {done,value}=await reader.read();if(done)break;
      if(value.length){received=true;resetIdle();}
      buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
      let end;while((end=buffer.indexOf('\n\n'))>=0){frame(buffer.slice(0,end));buffer=buffer.slice(end+2);}
      if(buffer.length>1000000)throw Object.assign(new Error('Gemini returned an oversized stream frame.'),{status:502});
    }
    buffer+=decoder.decode();if(buffer.trim())frame(buffer);
    if(!finishReason)throw Object.assign(new Error('Gemini closed the stream before completing the answer. Please try again.'),{status:502});
    if(!['STOP','MAX_TOKENS'].includes(finishReason))throw Object.assign(new Error('Gemini stopped generation without a complete answer. It may have blocked the response.'),{status:502});
    if(!answer)throw Object.assign(new Error('Gemini returned no answer. It may have exhausted its output budget.'),{status:502});
    return {answer,usage,truncated:finishReason==='MAX_TOKENS'};
  }catch(error){
    if(error.status)throw error;
    if(combined.aborted||['TimeoutError','AbortError'].includes(error.name)){
      const reason=signal?.aborted?signal.reason:controller.signal.reason;
      const message=reason==='disconnected'?'The chat connection was closed.':reason==='deadline'?`${model} reached the overall response time limit. Try a narrower question.`:received?`${model} stopped sending stream data for ${Math.round(idleMs/1000)} seconds. Please try again.`:`${model} sent no stream data within ${Math.round(idleMs/1000)} seconds. Google may be busy or the server connection may be stalled.`;
      throw Object.assign(new Error(message),{status:504});
    }
    throw Object.assign(new Error(`Connection to Gemini was interrupted for ${model}. Please try again.`),{status:502});
  }finally{clearTimeout(idleTimer);clearTimeout(totalTimer);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}}
}
export async function embed(text,fetcher=fetch) {
  const response=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({content:{parts:[{text}]},outputDimensionality:768}),signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw Object.assign(new Error('Embedding request failed or its quota was reached. No chat request was made.'),{status:response.status===429?429:502});
  const vector=(await response.json()).embedding?.values;
  if(!Array.isArray(vector)||vector.length!==768||vector.some(v=>!Number.isFinite(v))) throw new Error('Invalid embedding response.');
  return vector;
}
