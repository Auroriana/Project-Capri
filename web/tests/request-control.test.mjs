import test from 'node:test';
import assert from 'node:assert/strict';
import {withRequest,registerRequest,stopRequests,requestFetch} from '../lib/request-control.js';
import {generateWithOverflow} from '../lib/provider-routing.js';
import handler from '../api/index.js';

test('oversized Groq stages preserve every byte and source in one fallback call',async()=>{
 const request={contents:[{role:'user',parts:[{text:'[S1] Never disclose without consent.\n'.repeat(5000)}]}],generationConfig:{maxOutputTokens:4096}};
 const before=JSON.stringify(request);let calls=0,notice=0;
 const result=await generateWithOverflow('groq:openai/gpt-oss-120b',request,{generate:()=>assert.fail('Oversized stage must not reach Groq'),fallback:async input=>{calls++;assert.equal(JSON.stringify(input),before);return {answer:'Grounded answer',modelUsed:'gemini-fixture'};},onFallback:()=>notice++});
 assert.equal(calls,1);assert.equal(notice,1);assert.equal(result.modelUsed,'gemini-fixture');assert.equal(JSON.stringify(request),before);
});
test('provider 413 falls back once; ordinary errors never trigger fallback',async()=>{
 const request={contents:[]};let calls=0;
 const fallback=async()=>{calls++;return {answer:'ok'};};
 await generateWithOverflow('groq:test',request,{generate:async()=>{throw Object.assign(Error('too large'),{status:413});},fallback});
 assert.equal(calls,1);
 await assert.rejects(generateWithOverflow('groq:test',request,{generate:async()=>{throw Object.assign(Error('quota'),{status:429});},fallback}),{status:429});
 assert.equal(calls,1);
 await assert.rejects(generateWithOverflow('groq:test',{contents:[{text:'x'.repeat(50000)}]},{generate:()=>assert.fail()}),{status:413});
});
test('stop isolates owners, aborts in-flight fetches and blocks later phases',async t=>{
 t.mock.method(globalThis,'fetch',async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
 const a=new AbortController(),b=new AbortController();const cleanA=registerRequest('a',a),cleanB=registerRequest('b',b);t.after(()=>{cleanA();cleanB();});
 const pending=withRequest(a,()=>requestFetch('https://fixture.invalid'));
 assert.equal(stopRequests('a'),1);await assert.rejects(pending,{name:'AbortError'});assert.equal(b.signal.aborted,false);
 assert.throws(()=>withRequest(a,()=>requestFetch('https://fixture.invalid')),{name:'AbortError'});
 cleanA();assert.equal(stopRequests('a'),0);
});
test('authenticated Stop aborts an active non-streaming Gemini personality request',async t=>{
 for(const [key,value] of Object.entries({SUPABASE_URL:'https://db.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',OWNER_USER_ID:'owner',GEMINI_API_KEY:'fixture',GEMINI_FREE_TIER_CONFIRMED:'true'})){const old=process.env[key];process.env[key]=value;t.after(()=>old===undefined?delete process.env[key]:process.env[key]=old);}
 let started;const ready=new Promise(resolve=>started=resolve);let providerSignal;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'owner'});
  if(url.includes('aria_reserve'))return Response.json(true);
  if(url.includes('generateContent')){providerSignal=options.signal;started();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}
  throw Error('Unexpected URL '+url);
 });
 const call=async(route,body)=>{let result;const res={setHeader(){},end(text){result=JSON.parse(text);}};await handler({url:'/api/'+route,method:'POST',headers:{cookie:'aria_session=fixture','content-type':'application/json'},body},res);return result;};
 const pending=call('personality',{action:'turn',message:'hello',settings:{router:'gemini-3.5-flash-lite'}});
 await ready;const stopped=await call('stop',{});assert.equal(stopped.stopped,1);assert.equal(providerSignal.aborted,true);await pending;
 assert.equal((await call('stop',{})).stopped,0);
});
