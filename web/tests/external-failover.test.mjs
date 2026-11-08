import test from 'node:test';
import assert from 'node:assert/strict';
import {externalGenerate,providers} from '../lib/multi-provider.js';
import {generateWithOverflow} from '../lib/provider-routing.js';

const request={systemInstruction:{parts:[{text:'system'}]},contents:[{role:'user',parts:[{text:'hello'}]}],generationConfig:{maxOutputTokens:100}};
const keys=()=>{const snapshot={};for(const provider of ['groq','nim','deepseek','openrouter','zai']){const k=providers[provider].key;snapshot[k]=process.env[k];process.env[k]='fixture';}snapshot.CAPRI_FREE_ONLY=process.env.CAPRI_FREE_ONLY;process.env.CAPRI_FREE_ONLY='false';return snapshot;};
const restore=snapshot=>{for(const [k,v] of Object.entries(snapshot)){if(v===undefined)delete process.env[k];else process.env[k]=v;}};
const sse=chunks=>new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(chunk)+'\n\n'));controller.close();}}),{headers:{'content-type':'text/event-stream'}});

test('NIM requests stream SSE, assemble the answer and count usage',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 const tokens=[];let started=0;
 const result=await externalGenerate('nim:z-ai/glm-5.3-flash',request,{onToken:text=>tokens.push(text),onAnswerStarted:()=>started++},async(url,options)=>{
  assert.equal(url,providers.nim.base+'/chat/completions');
  const body=JSON.parse(options.body);
  assert.equal(body.model,'z-ai/glm-5.3-flash');
  assert.equal(body.stream,true);
  assert.deepEqual(body.stream_options,{include_usage:true});
  return sse([
   {choices:[{delta:{role:'assistant'}}]},
   {choices:[{delta:{content:'Hel'}}]},
   {choices:[{delta:{content:'lo'}}]},
   {choices:[{delta:{},finish_reason:'length'}]},
   {choices:[],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}}
  ]);
 });
 assert.equal(result.answer,'Hello');
 assert.equal(result.truncated,true);
 assert.equal(result.usage.totalTokenCount,12);
 assert.deepEqual(tokens,['Hel','lo']);
 assert.equal(started,1);
});

test('a stalled NIM stream fails fast with 504 instead of hanging',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 const oldFirst=process.env.EXTERNAL_FIRST_TOKEN_MS;process.env.EXTERNAL_FIRST_TOKEN_MS='60';
 t.after(()=>{if(oldFirst===undefined)delete process.env.EXTERNAL_FIRST_TOKEN_MS;else process.env.EXTERNAL_FIRST_TOKEN_MS=oldFirst;});
 // A real fetch body is cancelled when its signal aborts; the mock must honor that too.
 const hanging=signal=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}),{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(externalGenerate('nim:z-ai/glm-5.3-flash',request,{},(url,options)=>hanging(options.signal)),error=>{
  assert.equal(error.status,504);
  assert.match(error.message,/glm-5\.3-flash/);
  return true;
 });
});

test('a stream that dies mid-answer reports an idle timeout',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 const oldIdle=process.env.EXTERNAL_IDLE_MS;process.env.EXTERNAL_IDLE_MS='60';
 t.after(()=>{if(oldIdle===undefined)delete process.env.EXTERNAL_IDLE_MS;else process.env.EXTERNAL_IDLE_MS=oldIdle;});
 // One event arrives (clearing the first-token watchdog), then the stream stalls forever.
 const partial=signal=>new Response(new ReadableStream({start(controller){
  controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'Hel'}}]})+'\n\n'));
  signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});
 }}),{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(externalGenerate('nim:z-ai/glm-5.3-flash',request,{},(url,options)=>partial(options.signal)),{status:504});
});

test('providers that reject streaming retry once without it',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 let calls=0;
 const result=await externalGenerate('nim:nvidia/nemotron-3-ultra-550b-a55b',request,{},async(url,options)=>{
  calls++;const body=JSON.parse(options.body);
  if(body.stream)return Response.json({error:{message:'stream_options is not supported for this model'}},{status:400});
  assert.equal(body.stream,undefined);
  return Response.json({choices:[{message:{content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:1,total_tokens:4}});
 });
 assert.equal(result.answer,'ok');
 assert.equal(result.truncated,false);
 assert.equal(calls,2);
});

test('a NIM timeout moves the stage to the Gemini fallback',async()=>{
 let fallbackUsed=0;
 const result=await generateWithOverflow('nim:z-ai/glm-5.3-flash',request,{
  generate:async()=>{throw Object.assign(new Error('NIM / z-ai/glm-5.3-flash produced no output within 45 seconds.'),{status:504});},
  fallback:async()=>{fallbackUsed++;return {answer:'from gemini',truncated:false,usage:null};},
  onFallback:reason=>assert.equal(reason,'failover')
 });
 assert.equal(fallbackUsed,1);
 assert.equal(result.answer,'from gemini');
});

test('without a fallback the original NIM error surfaces',async()=>{
 await assert.rejects(generateWithOverflow('nim:z-ai/glm-5.3-flash',request,{
  generate:async()=>{throw Object.assign(new Error('NIM / z-ai/glm-5.3-flash exceeded the 120-second limit for this stage.'),{status:504});}
 }),{status:504});
});

test('rate limits surface instead of silently spending Gemini quota',async()=>{
 let fallbackUsed=0;
 await assert.rejects(generateWithOverflow('nim:z-ai/glm-5.3-flash',request,{
  generate:async()=>{throw Object.assign(new Error('NIM / z-ai/glm-5.3-flash failed (HTTP 429). Retry after 30.'),{status:429});},
  fallback:async()=>{fallbackUsed++;return {answer:'x',truncated:false};}
 }),{status:429});
 assert.equal(fallbackUsed,0);
});

test('groq oversized stages still overflow by budget, not by failure',async()=>{
 const big={...request,contents:[{role:'user',parts:[{text:'x'.repeat(30000)}]}]};
 let fallbackUsed=0;
 const result=await generateWithOverflow('groq:openai/gpt-oss-120b',big,{
  generate:async()=>assert.fail('Oversized stage must not reach Groq'),
  fallback:async()=>{fallbackUsed++;return {answer:'g',truncated:false};},
  onFallback:reason=>assert.equal(reason,'budget')
 });
 assert.equal(fallbackUsed,1);
 assert.equal(result.answer,'g');
});
