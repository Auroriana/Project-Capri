import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateQuestion,normalizeUsage,addUsage,callUsage,usageDetails} from '../public/token-usage.js';
import {geminiStream} from '../lib/providers.js';
import {sealCheckpoint,openCheckpoint} from '../lib/checkpoint.js';
import handler from '../api/index.js';
test('draft estimate includes history and attachments without counting base64 as text',()=>{
 assert.equal(estimateQuestion('abcd',[{text:'abcdefgh'}],[{data:'x'.repeat(10000)}]),4099);
});
test('reported total includes thinking once and missing metadata stays estimated',()=>{
 const a=normalizeUsage({promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:30,totalTokenCount:150});
 const b=normalizeUsage({promptTokenCount:50,candidatesTokenCount:10,totalTokenCount:60});
 assert.deepEqual(addUsage(a,b),{totalTokenCount:210,estimated:false,promptTokenCount:150,candidatesTokenCount:30,thoughtsTokenCount:30});
 assert.equal(addUsage(a,normalizeUsage(null,40)).estimated,true);
 assert.equal(normalizeUsage(null,40).totalTokenCount,40);
 const saved=sealCheckpoint({tokenUsage:addUsage(a,b)},'owner','request');
 assert.equal(openCheckpoint(saved,'owner','request').tokenUsage.totalTokenCount,210);
});
test('stream usage snapshots replace earlier cumulative counts',async()=>{
 const counts=[];
 const chunks=[{usageMetadata:{totalTokenCount:100},candidates:[{content:{parts:[{text:'Hello'}]}}]},{usageMetadata:{promptTokenCount:100,candidatesTokenCount:2,thoughtsTokenCount:5,totalTokenCount:107},candidates:[{finishReason:'STOP'}]}];
 const result=await geminiStream('test',{}, {onUsage:u=>counts.push(u.totalTokenCount)},async()=>new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')));
 assert.deepEqual(counts,[100,107]);assert.equal(result.usage.totalTokenCount,107);
});

test('cached input is a subset, including when total metadata is absent',()=>{
 const usage={promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:30,cachedContentTokenCount:80,cacheCreationTokenCount:10};
 assert.equal(normalizeUsage(usage).totalTokenCount,150);
 assert.equal(normalizeUsage({...usage,totalTokenCount:150}).totalTokenCount,150);
 assert.equal(addUsage(normalizeUsage(usage),normalizeUsage(usage)).cachedContentTokenCount,160);
});

test('call ledger preserves roles, estimates and checkpoint metadata without prompt content',()=>{
 const request={systemInstruction:{parts:[{text:'SECRET_SYSTEM'}]},contents:[{role:'user',parts:[{text:JSON.stringify({conversationMemory:[{text:'SECRET_HISTORY'}],evidence:[{content:'SECRET_NOTE'}],recentChats:[{title:'SECRET_TITLE'}],original:'SECRET_DRAFT'})},{inlineData:{mimeType:'image/png',data:'PRIVATE_BASE64'}}]}]};
 const first=callUsage({promptTokenCount:100,candidatesTokenCount:20,totalTokenCount:120},request,'Reply',{model:'test',role:'reasoning',phase:'answer',latencyMs:5});
 const second=callUsage(null,request,'Reply',{model:'test',role:'personality',phase:'rewrite',latencyMs:6});
 const combined=addUsage(first,second);
 assert.equal(combined.calls.length,2);assert.equal(combined.estimated,true);
 assert.ok(second.calls[0].promptEstimates.input>=4096);
 for(const key of ['system','history','retrieved','overview','draft'])assert.ok(first.calls[0].promptEstimates[key]>0);
 assert.doesNotMatch(JSON.stringify(combined),/SECRET|PRIVATE_BASE64/);
 assert.match(usageDetails(combined),/personality \/ rewrite/);
 assert.deepEqual(openCheckpoint(sealCheckpoint({tokenUsage:combined},'o','r'),'o','r').tokenUsage,combined);
});

test('personality no-gap opinion diagnostics count two calls and no retrieval',async t=>{
 const values={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test',OWNER_USER_ID:'owner',GEMINI_API_KEY:'test',GEMINI_FREE_TIER_CONFIRMED:'true'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 t.after(()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 let count=0;
 t.mock.method(globalThis,'fetch',async url=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'owner'});
  if(url.includes('aria_reserve'))return Response.json(true);
  if(url.includes('aria_search'))throw Error('Unexpected retrieval');
  assert.match(url,/generateContent$/);
  count++;const text='A considered opinion.';
  return Response.json({candidates:[{content:{parts:[{text}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,totalTokenCount:120,cachedContentTokenCount:50}});
 });
 let result;const res={setHeader(){},end(s){result=JSON.parse(s);}};
 await handler({url:'/api/personality',method:'POST',headers:{cookie:'aria_session=test','content-type':'application/json'},body:{action:'rewrite',message:'What do you think of her?',answer:'A draft.',history:[{role:'model',text:'PRIVATE_FACT'}],settings:{enabled:true,personality:'gemini-3.5-flash-lite'}}},res);
 assert.equal(res.statusCode,200);assert.equal(result.usage.totalTokenCount,120);
 assert.equal(result.usage.cachedContentTokenCount,50);assert.equal(result.usage.ragSearches,0);
 assert.deepEqual(result.usage.calls.map(c=>c.phase),['rewrite']);
 assert.doesNotMatch(JSON.stringify(result.usage),/PRIVATE_FACT|A draft/);
});
