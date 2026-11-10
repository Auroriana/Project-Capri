import {isExternal} from './multi-provider.js';
// Keep full evidence intact. Oversized Groq stages move to the configured Gemini
// path; they are never shortened or split into lossy summaries.
export function exceedsGroqBudget(id,request){
 if(!id.startsWith('groq:'))return false;
 const configured=Number(process.env.GROQ_REQUEST_TOKEN_BUDGET);
 const budget=Number.isFinite(configured)&&configured>0?configured:7000;
 // Conservative byte estimate, including output room and protocol overhead.
 return Math.ceil(Buffer.byteLength(JSON.stringify(request))/3)+(request.generationConfig?.maxOutputTokens||4096)+256>budget;
}
// NIM (and other hosted OpenAI-compatible providers) can cold-start, queue, or
// drop requests without answering. Those transient upstream failures move to
// the Gemini fallback with the context preserved. Rate limits (429) are not
// included: the browser already backs off, and silently spending the scarce
// Gemini daily quota would hide the real problem. Stages that overflow onto
// ANOTHER FREE provider (the Nemotron Ultra/Super text chain, the Super VL +
// OpenRouter Omni vision chain) pass a wider failoverOn predicate instead: a
// shared free-endpoint 429 there is routine, and the next hop costs nothing,
// so failing the turn would be worse.
export const failoverUpstream=error=>!!error&&(['TimeoutError','AbortError'].includes(error.name)||error instanceof TypeError||[413,502,503,504].includes(error.status));
// Free-chain failover: used while the next hop is itself a free endpoint (NIM
// Nemotron chain, OpenRouter :free mirrors), so a provider-side rejection —
// bad key, retired model id, quota, oversized payload — costs nothing to hop
// past instead of dead-ending the turn with a bare 400.
export const failoverFreeChain=error=>failoverUpstream(error)||[400,401,402,403,404,429].includes(error?.status);
// Selected-model failover: a model the user pinned has no free spare, so its
// failures may only fall back to the guarded Gemini quota. Auth/model
// rejections (400/401/403/404) hop — retrying them cannot succeed and the
// user sees a dead chat otherwise. Rate limits (429/402) still surface: the
// browser backs off, and silently spending the scarce Gemini daily quota on
// a pinned model's limits would hide the real problem.
export const failoverSelectedChain=error=>failoverUpstream(error)||[400,401,403,404].includes(error?.status);
export async function generateWithOverflow(id,request,{generate,fallback,failoverOn=failoverUpstream,onFallback=()=>{}}){
 const overflow=async(original,reason)=>{
  if(!fallback){
   // Without a fallback the caller must see the real upstream failure.
   if(original)throw original;
   throw Object.assign(Error('This stage exceeds the Groq request budget. Choose Gemini for all stages, or configure the Gemini overflow model. Context was preserved.'),{status:413});
  }
  onFallback(reason);return fallback(request);
 };
 if(exceedsGroqBudget(id,request))return overflow(null,'budget');
 try{return {...await generate(id,request),modelUsed:id};}
 catch(error){
  if(id.startsWith('groq:')&&error.status===413)return overflow(null,'budget');
  if(isExternal(id)&&failoverOn(error))return overflow(error,'failover');
  throw error;
 }
}
