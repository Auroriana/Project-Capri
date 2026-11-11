import {externalModels,ready,supportsVision} from './multi-provider.js';

// MODEL HIERARCHY
// CORE AI (the router) classifies every request into a tier. Easy chat goes to the
// quick, cheap models; ordinary questions go to the standard tier; hard or
// high-stakes work goes to the deep tier. Each tier is an ORDERED chain, so a
// provider that is down, rate-limited, retired or misconfigured never ends the
// turn: the next model in the chain simply answers. Entries that are not
// configured (no key, free-only policy, Gemini off) are skipped automatically.
export const TIERS=['quick','standard','deep'];
export const normalizeTier=value=>TIERS.includes(value)?value:null;

export const CHAINS={
 quick:[
  'openrouter:nvidia/nemotron-3.5-lightning:free',
  'nim:z-ai/glm-5.3-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'claude-haiku-5-5'
 ],
 standard:[
  'nim:nvidia/nemotron-3-super-120b-a12b',
  'nim:deepseek-ai/deepseek-v4.1-flash',
  'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'claude-sonnet-5-5'
 ],
 deep:[
  'nim:nvidia/nemotron-3-ultra-550b-a55b',
  'openrouter:nvidia/nemotron-3-ultra-550b-a55b:free',
  'nim:nvidia/nemotron-3-super-120b-a12b',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'claude-opus-5-5'
 ],
 // Attachment turns need eyes. Gemini also reads PDFs.
 vision:[
  'nim:nvidia/nemotron-3.5-super-vl-120b-a12b',
  'openrouter:nvidia/nemotron-3.5-super-vl:free',
  'openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash'
 ]
};
// When a whole tier is down the request may borrow from its neighbours rather than fail.
const SPILL={quick:['quick','standard','deep'],standard:['standard','deep','quick'],deep:['deep','standard','quick']};

export const geminiReady=()=>!!process.env.GEMINI_API_KEY&&process.env.GEMINI_FREE_TIER_CONFIRMED==='true';
export function available(id){
 if(typeof id!=='string'||!id)return false;
 if(id.startsWith('gemini-'))return geminiReady();
 return externalModels.some(m=>m.id===id)&&ready(id);
}

// Short in-memory health memory (per server instance, best effort): a model that just
// failed with an auth/missing/stall error is parked for a few minutes so later turns do
// not each pay its timeout again. It is never the only candidate removed.
const health=new Map();
const PARK_MS=300000;
export function markFailure(id,error){
 const status=error?.providerStatus??error?.status;
 const stall=['TimeoutError'].includes(error?.name)||status===504;
 if([401,402,403,404,410].includes(status)||stall)health.set(id,Date.now()+PARK_MS);
}
export const markSuccess=id=>{health.delete(id);};
export const parked=id=>(health.get(id)||0)>Date.now();
export const resetHealth=()=>health.clear();

// Candidate list for one call: pinned models first (only when the owner pinned them),
// then the tier chain, then neighbour tiers as a last resort.
export function chainFor(tier,{pinned=[],media=false}={}){
 const lanes=media?[CHAINS.vision,CHAINS[normalizeTier(tier)||'standard']]:SPILL[normalizeTier(tier)||'standard'].map(t=>CHAINS[t]);
 const ordered=[...pinned.filter(Boolean),...lanes.flat()];
 const seen=new Set(),usable=[];
 for(const id of ordered){
  if(seen.has(id))continue;seen.add(id);
  if(!available(id))continue;
  if(media&&!id.startsWith('gemini-')&&!supportsVision(id))continue;
  usable.push(id);
 }
 const healthy=usable.filter(id=>!parked(id));
 return healthy.length?healthy:usable;
}

// ---- CORE AI heuristics -------------------------------------------------
const SOCIAL=/^(hi+|hey+|hello+|heya|hiya|yo+|sup|gm|gn|good (morning|night|evening|afternoon)|thanks?( you| so much)?|thx|ty|ok(ay)?|k|kk|lol|lmao|haha+|hehe+|nice|cool|wow|omg|bye|cya|night|nvm|yes|no|yep|nope|yeah|nah)(\s+capri)?[\s!.?~,]*$/i;
export const isSmallTalk=message=>{const text=String(message||'').trim();return text.length>0&&text.length<=40&&SOCIAL.test(text);};

// Combine CORE AI's suggestion with guard rails. Reasoning and note work never drop to the
// quick tier; MIR (overclock) always uses the deep tier; long inputs are not "quick".
export function tierFor({route='reasoning',suggested,deep=false,message='',attachments=false}={}){
 if(deep)return 'deep';
 let tier=normalizeTier(suggested)||({reply:'quick',agenda:'quick',web:'standard',vault:'standard',reasoning:'standard'}[route]||'standard');
 if(tier==='quick'&&(['reasoning','vault','web'].includes(route)||String(message).length>400||attachments))tier='standard';
 return tier;
}

// ---- failover runner ----------------------------------------------------
// attempt(id,{index,last}) -> result. Anything except a user stop moves on to the next model.
export async function runChain(ids,attempt,{signal,onSwitch=()=>{}}={}){
 if(!ids.length)throw Object.assign(new Error('No chat model is available. Add a provider key (for example NVIDIA_API_KEY) or enable Gemini in the server environment.'),{status:503});
 let lastError;
 for(let index=0;index<ids.length;index++){
  const id=ids[index],last=index===ids.length-1;
  try{const result=await attempt(id,{index,last});markSuccess(id);return result;}
  catch(error){
   if(signal?.aborted)throw error;
   markFailure(id,error);lastError=error;
   if(!last)onSwitch({from:id,to:ids[index+1],error});
  }
 }
 throw lastError;
}
