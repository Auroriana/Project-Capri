import {sealCheckpoint,openCheckpoint} from './checkpoint.js';
export const FOLLOWUP_TTL_MS=15*60*1000;
export const FOLLOWUP_CHARS=24000;
const purpose=vault=>'aria-followup-v1:'+String(vault??'all').toLowerCase();

// Only completed, cited, read passages; never turn an assistant summary into evidence.
export function cacheFollowup(result,owner,vault,now=Date.now()){
 let chars=0;const sources=[];
 for(const s of result.sources??[]){
  if(!s.cited||!s.read||typeof s.excerpt!=='string'||chars+s.excerpt.length>FOLLOWUP_CHARS||sources.length>=12)continue;
  chars+=s.excerpt.length;sources.push({title:s.title,source_path:s.path,vault_name:s.vault,content:s.excerpt});
 }
 if(!sources.length)return null;
 return sealCheckpoint({sources,capturedAt:now,expiresAt:now+FOLLOWUP_TTL_MS},owner,purpose(vault));
}
export function readFollowup(token,owner,vault,now=Date.now()){
 if(!token)return null;
 try{const data=openCheckpoint(token,owner,purpose(vault));return data.expiresAt>now&&data.capturedAt<=now&&Array.isArray(data.sources)?data:null;}catch{return null;}
}
export const FOLLOWUP_ROUTING=' You may also return intent "context" with queries:[] for a scope-narrowing correction (such as "the Aria project only"), reflective follow-up or explanation of facts already established in the recent dialogue when the recent dialogue establishes the facts. Resolve her/him/them/the first one from the most recent relevant user-visible exchange; do not guess if ambiguous. Earlier passage snapshots may be available after routing; they are not current verification. For new details, current/latest information, changed circumstances, procedural decisions, explicit rechecking or source verification choose lookup/case and search afresh. Do not reuse a snapshot simply because a previous answer exists. If the topic is ambiguous, use social to ask a clarifying question.';
