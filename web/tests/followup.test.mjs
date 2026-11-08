import test from 'node:test';
import assert from 'node:assert/strict';
import {cacheFollowup,readFollowup,FOLLOWUP_TTL_MS,FOLLOWUP_CHARS} from '../lib/followup-cache.js';
import {researchVault} from '../lib/rag.js';
import handler from '../api/index.js';
import {conversationMemory} from '../public/chat-store.js';
import {personalityHandoff} from '../public/personality-handoff.js';

const source={id:'S8',title:'Profile',path:'Profile.md',vault:'Notes',excerpt:'Jhicaih kept her promise.',read:true,cited:true};
test('source cache binds owner and scope, expires, rejects tampering and excludes unsupported summaries',()=>{
 const now=Date.now(),token=cacheFollowup({answer:'An unsupported claim',sources:[source,{...source,cited:false},{...source,read:false},{...source,excerpt:'x'.repeat(FOLLOWUP_CHARS+1)}]},'owner','vault',now);
 const data=readFollowup(token,'owner','vault',now);assert.equal(data.sources.length,1);assert.equal(data.sources[0].content,source.excerpt);
 assert.doesNotMatch(JSON.stringify(data),/unsupported claim/);
 assert.equal(readFollowup(token,'other','vault',now),null);assert.equal(readFollowup(token,'owner','all',now),null);
 assert.equal(readFollowup(token,'owner','vault',now+FOLLOWUP_TTL_MS),null);
 assert.equal(readFollowup((token[0]==='A'?'B':'A')+token.slice(1),'owner','vault',now),null);
 assert.equal(cacheFollowup({answer:'Uncited answer',sources:[]},'owner',null),null);
});

test('reflective follow-up reuses actual passages with remapped citations, no search and no stale IDs',async()=>{
 const followup=readFollowup(cacheFollowup({sources:[source]},'o',null),'o',null),phases=[];
 const result=await researchVault({message:'What do you think of her?',history:[{role:'user',text:'Pull all information about Jhicaih.'},{role:'model',text:'Jhicaih kept her promise [S8].'}],route:true,followup,overview:async()=>[],search:async()=>{throw Error('Unnecessary search');},
 generate:async(request,meta)=>{
  phases.push(meta.phase);const context=JSON.parse(request.contents[0].parts[0].text);
  if(context.conversationMemory.length)assert.doesNotMatch(context.conversationMemory.at(-1).text,/\[S8\]/);
  if(meta.phase==='route'){assert.equal(context.cachedSources,undefined);assert.equal(context.evidence,undefined);return {answer:'{"intent":"context","queries":[]}'};}
  assert.equal(context.evidence[0].content,source.excerpt);assert.equal(context.evidence[0].id,'S1');
  return {answer:'Keeping her promise [S1] earns my respect.'};
 }});
 assert.deepEqual(phases,['route','context']);assert.equal(result.research.searches,0);assert.equal(result.research.reusedSources,true);
 assert.equal(result.sources[0].id,'S1');assert.equal(result.sources[0].cited,true);
 const handoff=personalityHandoff({message:'Your view?'},result);assert.equal(handoff.sourceBasis,'snapshot');assert.equal(handoff.snapshotCapturedAt,followup.capturedAt);
 assert.doesNotMatch(JSON.stringify(handoff),/Jhicaih kept her promise/);
});

test('fresh-information decision ignores cached evidence and performs new research',async()=>{
 let searches=0;
 const result=await researchVault({message:'Verify her current role from the notes.',route:true,followup:{sources:[{content:'OUTDATED',title:'Old'}],capturedAt:1},overview:async()=>[],
 search:async()=>{searches++;return [{id:'fresh',title:'Role',source_path:'Role.md',vault_name:'Notes',content:'Updated role.'}];},
 generate:async(request,meta)=>{
  if(meta.phase==='route')return {answer:'{"intent":"lookup","queries":[{"q":"current role"}]}'};
  assert.doesNotMatch(JSON.stringify(request),/OUTDATED/);return {answer:'Updated role [S1].'};
 }});
 assert.equal(searches,1);assert.equal(result.research.reusedSources,undefined);
});

test('cache-missing reuse and reuse with searches fall back safely to retrieval',async()=>{
 for(const queries of [[],[{q:'new details'}]]){
  let searches=0;
  await researchVault({message:'What changed?',route:true,overview:async()=>[],search:async()=>{searches++;return [];},generate:async(request,meta)=>({answer:meta.phase==='route'?JSON.stringify({intent:'context',queries}):meta.phase==='planning'?'{"queries":[]}':'No evidence.'})});
  assert.equal(searches,1);
 }
});

test('history uses the displayed response or clean draft instead of appended research bookkeeping',()=>{
 assert.deepEqual(conversationMemory([{role:'model',text:'Draft\nResearch: 4 searches',reasoningText:'Draft'},{role:'model',text:'Raw',reasoningText:'Draft',personality:'Displayed list'}]),[{role:'model',text:'Draft'},{role:'model',text:'Displayed list'}]);
});

test('reused evidence rejects unknown grouped and mixed citation IDs',async()=>{
 for(const citation of ['[S1, S999]','[S1, P9]'])await assert.rejects(researchVault({message:'Your view?',route:true,followup:{sources:[{title:'Profile',content:source.excerpt}],capturedAt:1},overview:async()=>[],search:async()=>{throw Error('No search');},generate:async(request,meta)=>({answer:meta.phase==='route'?'{"intent":"context","queries":[]}':'A claim '+citation})}),/invalid source reference/);
});

test('HTTP follow-up cache survives response transport, preserves TTL and is kept out of fresh retrieval',async t=>{
 const values={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test',OWNER_USER_ID:'owner',GEMINI_API_KEY:'test',GEMINI_FREE_TIER_CONFIRMED:'true',ENABLE_ROUTER:'true'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);t.after(()=>{for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 let requestCount=0,searches=0,followupTurn=false;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'owner'});
  if(url.includes('aria_reserve'))return Response.json(true);
  if(url.includes('aria_vault_overview'))return Response.json([]);
  if(url.includes('aria_search')){searches++;return Response.json([{id:'chunk',title:'Profile',source_path:'Profile.md',vault_name:'Notes',content:source.excerpt}]);}
  const body=JSON.parse(options.body);assert.match(url,/generateContent$/);if(body.systemInstruction.parts[0].text.includes('choose additional searches'))return Response.json({candidates:[{content:{parts:[{text:'{"queries":[]}'}]}}],usageMetadata:{totalTokenCount:100}});requestCount++;
  if(followupTurn)assert.match(body.systemInstruction.parts[0].text,requestCount%2?/intent "context"/:/earlier cited passage snapshots/);
  const answer=requestCount%2?(followupTurn?'{"intent":"context","queries":[]}':'{"intent":"lookup","queries":[{"q":"Jhicaih"}]}'):(followupTurn?'That earns my respect [S1].':'She kept her promise [S1].');
  return Response.json({candidates:[{content:{parts:[{text:answer}]}}],usageMetadata:{totalTokenCount:100}});
 });
 async function call(body){let data;const res={setHeader(){},end(s){data=JSON.parse(s);}};await handler({url:'/api/chat',method:'POST',headers:{cookie:'aria_session=test','content-type':'application/json'},body:{model:'gemini-3.5-flash-lite',mode:'vault',message:'Jhicaih',settings:{enabled:true},...body}},res);assert.equal(res.statusCode,200);return data;}
 const first=await call({});assert.ok(first.followupCache);followupTurn=true;
 const second=await call({message:'What do you think of her?',history:[{role:'model',text:first.answer}],followupCache:first.followupCache});
 assert.equal(searches,1);assert.equal(second.research.searches,0);assert.equal(second.followupCache,first.followupCache);
 assert.equal(second.usage.calls[1].phase,'context');assert.equal(second.sources[0].excerpt,source.excerpt);
});
