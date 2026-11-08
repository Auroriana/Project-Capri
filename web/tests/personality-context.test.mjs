import test from 'node:test';
import assert from 'node:assert/strict';
import {personalize} from '../lib/personality.js';
import {personalityCards} from '../lib/personality-context.js';
import {searchPersonality} from '../lib/personality-retrieval.js';
import {withRuntime,rememberFailure} from '../lib/runtime-awareness.js';
import {requestErrorText} from '../public/request-error.js';
import {estimateText,callUsage,usageDetails} from '../public/token-usage.js';

test('runtime cards preserve attribution and substantive source text without mutating records',()=>{
 const passages=searchPersonality('undelete technical competence might try');const before=JSON.stringify(passages);
 const cards=personalityCards(passages);
 const card=cards.find(p=>p.id==='capri.transcript.t1-c20');
 assert.ok(card);assert.match(card.content,/might be traces/);assert.match(card.content,/not independently verified/);assert.match(card.content,/uncertainty markers/);
 assert.equal(card.sourceId,'T1');assert.equal(JSON.stringify(passages),before);
 const custom={kind:'adaptation',content:'## Review test\nCustom important constraint.\n\n## New section\nKeep me.'};
 assert.match(personalityCards([custom])[0].content,/Custom important constraint/);
 assert.match(personalityCards([custom])[0].content,/Keep me/);
});
test('short turn stays below prior 5775-token fixture while preserving custom instructions and exact quotes',async()=>{
 const message='Can you fix this broken feature?';
 await personalize({body:{action:'turn',message,history:[]},generate:async request=>{
  assert.ok(estimateText(JSON.stringify(request))<4300);
  const data=JSON.parse(request.contents[0].parts[0].text);assert.equal(data.message,message);assert.deepEqual(data.conversation,[]);assert.equal(data.personalityPassages,undefined);assert.match(request.systemInstruction.parts[0].text,/CORE AI/);
  return {answer:'{"route":"reasoning"}'};
 }});
 const custom='Keep my custom persona verbatim.';let calls=0;
 await personalize({body:{action:'rewrite',message:'[Reply to Capri: exact earlier quote]\nExplain',answer:'Never disclose without consent [S1].',history:[{role:'model',text:'Earlier answer.'}],settings:{prompts:{personality:custom},web:'off',memory:true}},generate:async(request,meta)=>{
  const data=JSON.parse(request.contents[0].parts[0].text);assert.equal(data.original,'Never disclose without consent [S1].');assert.equal(data.conversation[0].text,'Earlier answer.');assert.equal(data.currentMessages[0].replyTo,'exact earlier quote');
  if(meta.phase==='memory-plan'){assert.doesNotMatch(request.systemInstruction.parts[0].text,/custom persona/);return {answer:'{"query":null}'};}
  assert.ok(request.systemInstruction.parts[0].text.includes(custom));calls++;return {answer:'Consent required [S1].'};
 }});assert.equal(calls,1);
});
test('runtime snapshot reports actual fallback and bounded failures without secrets or stale model claims',()=>{
 const owner='runtime-fixture';rememberFailure(owner,{status:429,model:'nim:nvidia/test',phase:'rewrite',secret:'NEVER_SEND'});
 const first=withRuntime({systemInstruction:{parts:[{text:'Original instruction'}]}},{owner,model:'groq:test',phase:'rewrite',settings:{web:'off',apiKey:'NEVER_SEND'}});
 const next=withRuntime(first,{owner,model:'gemini-test',phase:'rewrite',fallbackFrom:'groq:test'});
 assert.equal(next.systemInstruction.parts.length,1);assert.equal(next.contents.at(-1).parts.length,1);const text=next.contents.at(-1).parts.at(-1).text;
 assert.match(text,/"model":"gemini-test"/);assert.match(text,/"fallbackFrom":"groq:test"/);assert.match(text,/"status":429/);assert.doesNotMatch(text,/NEVER_SEND/);
 assert.match(requestErrorText(429,true),/retry shortly/);assert.match(requestErrorText(413),/too big/);
});
test('NVIDIA usage is itemized and personality cards have a separate input estimate',()=>{
 const usage=callUsage({promptTokenCount:90,candidatesTokenCount:10,totalTokenCount:100},{contents:[{parts:[{text:JSON.stringify({personalityPassages:[{content:'Reference'}]})}]}]},'Answer',{model:'nim:nvidia/nemotron-3-ultra-550b-a55b',role:'personality',phase:'rewrite',latencyMs:50});
 assert.ok(usage.calls[0].promptEstimates.personality>0);assert.match(usageDetails(usage),/NVIDIA NIM/);assert.match(usageDetails(usage),/Input 90 · Output 10/);
});
