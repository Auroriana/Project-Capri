import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsOf,defaults} from '../lib/core-settings.js';
import {personalize} from '../lib/personality.js';
import {failoverFreeChain,failoverSelectedChain} from '../lib/provider-routing.js';
import {requestErrorText} from '../public/request-error.js';

test('defaults keep every stage on the quick model until CORE escalates',()=>{
  assert.equal(defaults.router,'gemini-3.5-flash-lite');
  assert.equal(defaults.light,'gemini-3.5-flash-lite');
  assert.equal(defaults.reasoning,'gemini-3.5-flash-lite');
  assert.equal(defaults.personality,'gemini-3.5-flash-lite');
  const s=settingsOf({});
  assert.equal(s.light,'gemini-3.5-flash-lite');
  // saved settings without the new light role fall back to it
  assert.equal(settingsOf({light:undefined}).light,'gemini-3.5-flash-lite');
  // the light role validates like every other stage role
  assert.throws(()=>settingsOf({light:'not-a-model'}),{status:400});
  assert.equal(settingsOf({light:'gemini-3.8-flash'}).light,'gemini-3.8-flash');
});

test('CORE marks a casual reply light: small output budget, one compose pass',async()=>{
  const calls=[];
  const reply=await personalize({body:{action:'turn',message:'how cheeky',history:[]},generate:async req=>{
    calls.push(req);
    return calls.length===1
      ?{answer:JSON.stringify({route:'reply',effort:'light'})}
      :{answer:JSON.stringify({messages:['Who, me?'],expression:'amused_interest'})};
  }});
  assert.equal(calls.length,2); // router + one voice pass, no extra retrieval rounds
  assert.equal(reply.route,'reply');
  assert.equal(reply.effort,'light');
  assert.equal(calls[1].generationConfig.maxOutputTokens,1024);
});

test('CORE escalates a deep reply to the full personality budget',async()=>{
  const calls=[];
  const reply=await personalize({body:{action:'turn',message:'write me a long story about night city',history:[]},generate:async req=>{
    calls.push(req);
    return calls.length===1
      ?{answer:JSON.stringify({route:'reply',effort:'deep'})}
      :{answer:JSON.stringify({messages:['Once upon a time…'],expression:'neutral_attention'})};
  }});
  assert.equal(calls.length,2);
  assert.equal(reply.effort,'deep');
  assert.equal(calls[1].generationConfig.maxOutputTokens,4096);
});

test('a missing or invalid effort defaults to light (token efficiency first)',async()=>{
  const calls=[];
  await personalize({body:{action:'turn',message:'hey',history:[]},generate:async req=>{
    calls.push(req);
    return calls.length===1
      ?{answer:JSON.stringify({route:'reply'})} // no effort field
      :{answer:JSON.stringify({messages:['hi~'],expression:'neutral_attention'})};
  }});
  assert.equal(calls[1].generationConfig.maxOutputTokens,1024);
});

test('researched rewrites keep the full budget regardless of effort wording',async()=>{
  const calls=[];
  await personalize({body:{action:'rewrite',sprite:true,message:'What did the note say?',answer:'Tuesday [S1].',settings:{memory:false,web:'off'},effort:'light'},generate:async req=>{
    calls.push(req);
    return {answer:'{"answer":"Tuesday [S1].","expression":"focused_analysis"}'};
  }});
  // effort only shrinks CORE-routed casual turns (action turn → rewrite);
  // a research voice pass sent straight as rewrite is never downscaled
  assert.equal(calls[0].generationConfig.maxOutputTokens,4096);
});

test('provider rejections hop the free chain instead of dead-ending the turn',()=>{
  for(const status of [400,401,402,403,404,429,413,502,503,504]){
    assert.equal(failoverFreeChain(Object.assign(new Error('x'),{status})),true,'free chain should hop on '+status);
  }
  assert.equal(failoverFreeChain(Object.assign(new Error('x'),{status:500})),false);
  assert.equal(failoverFreeChain(new TypeError('network')),true);
  // a user-pinned model without free spares: auth/model rejections hop to the
  // guarded Gemini fallback, rate limits still surface
  for(const status of [400,401,403,404,413,502,503,504])assert.equal(failoverSelectedChain(Object.assign(new Error('x'),{status})),true);
  for(const status of [402,429,500])assert.equal(failoverSelectedChain(Object.assign(new Error('x'),{status})),false,'selected model should surface '+status);
});

test('request errors now carry the upstream reason',()=>{
  const plain=requestErrorText(400,false);
  assert.match(plain,/That request was rejected\./);
  assert.ok(!plain.includes('Reason:'));
  const detailed=requestErrorText(400,false,'NIM / nemotron-3-ultra-550b-a55b failed (HTTP 404). model not available');
  assert.match(detailed,/That request was rejected\. Reason: NIM \/ nemotron/);
  assert.match(detailed,/Use Resume reply to try again/);
  assert.ok(requestErrorText(429,true).includes('I’ll retry shortly'));
});
