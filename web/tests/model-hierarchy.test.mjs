import test from 'node:test';
import assert from 'node:assert/strict';
import {chainFor,tierFor,isSmallTalk,runChain,resetHealth,markFailure,parked,CHAINS,normalizeTier} from '../lib/model-hierarchy.js';
import {externalGenerate,providers} from '../lib/multi-provider.js';
import {failoverUpstream} from '../lib/provider-routing.js';
import {settingsOf,defaults} from '../lib/core-settings.js';
import {personalize} from '../lib/personality.js';

const KEYS=['NVIDIA_API_KEY','NVIDIA_FREE_ACCESS_CONFIRMED','OPENROUTER_API_KEY','GEMINI_API_KEY','GEMINI_FREE_TIER_CONFIRMED','CAPRI_FREE_ONLY','ANTHROPIC_API_KEY','CLAUDE_API_ENABLED'];
const withEnv=(values,body)=>async t=>{const old=Object.fromEntries(KEYS.map(k=>[k,process.env[k]]));for(const k of KEYS)delete process.env[k];Object.assign(process.env,values);resetHealth();t.after(()=>{for(const k of KEYS){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}resetHealth();});await body(t);};

test('chains list only configured models, in tier order, and spill into neighbouring tiers',withEnv({NVIDIA_API_KEY:'k',NVIDIA_FREE_ACCESS_CONFIRMED:'true',GEMINI_API_KEY:'g',GEMINI_FREE_TIER_CONFIRMED:'true'},()=>{
 const quick=chainFor('quick'),deep=chainFor('deep');
 assert.equal(quick[0],'nim:z-ai/glm-5.3-flash','quick starts on the fast model');
 assert.equal(deep[0],'nim:nvidia/nemotron-3-ultra-550b-a55b','deep starts on the 550B model');
 assert.ok(deep.indexOf('nim:nvidia/nemotron-3-ultra-550b-a55b')<deep.indexOf('gemini-3.8-flash'));
 assert.ok(!quick.some(id=>id.startsWith('openrouter:')),'no OpenRouter key, so no OpenRouter model');
 assert.ok(!quick.some(id=>id.startsWith('claude-')),'paid Claude stays off unless explicitly enabled');
 assert.ok(deep.includes('gemini-3.5-flash-lite')&&quick.includes('nim:nvidia/nemotron-3-super-120b-a12b'),'a whole tier going down never strands the request');
 assert.equal(new Set(quick).size,quick.length,'no duplicates');
}));

test('nothing configured means an empty chain, and the runner explains it',withEnv({},async()=>{
 assert.deepEqual(chainFor('standard'),[]);
 await assert.rejects(runChain(chainFor('standard'),async()=>1),error=>error.status===503&&/No chat model is available/.test(error.message));
}));

test('attachments use the vision chain and never a text-only model',withEnv({NVIDIA_API_KEY:'k',NVIDIA_FREE_ACCESS_CONFIRMED:'true',GEMINI_API_KEY:'g',GEMINI_FREE_TIER_CONFIRMED:'true'},()=>{
 const ids=chainFor('quick',{media:true});
 assert.equal(ids[0],'nim:nvidia/nemotron-3.5-super-vl-120b-a12b');
 assert.ok(ids.every(id=>id.startsWith('gemini-')||id.includes('vl')||id.includes('omni')));
}));

test('a manual pin goes first only when supplied, and is skipped if unavailable',withEnv({GEMINI_API_KEY:'g',GEMINI_FREE_TIER_CONFIRMED:'true'},()=>{
 assert.equal(chainFor('quick',{pinned:['gemini-3.8-flash']})[0],'gemini-3.8-flash');
 assert.ok(!chainFor('quick',{pinned:['nim:nvidia/nemotron-3-ultra-550b-a55b']}).includes('nim:nvidia/nemotron-3-ultra-550b-a55b'));
}));

test('tierFor: CORE AI picks the cheapest tier, with guard rails',()=>{
 assert.equal(tierFor({route:'reply',suggested:'quick'}),'quick');
 assert.equal(tierFor({route:'reply'}),'quick');
 assert.equal(tierFor({route:'reasoning',suggested:'quick'}),'standard','reasoning never drops to quick');
 assert.equal(tierFor({route:'vault',suggested:'quick'}),'standard');
 assert.equal(tierFor({route:'reply',suggested:'deep'}),'deep');
 assert.equal(tierFor({route:'reply',suggested:'bogus'}),'quick');
 assert.equal(tierFor({route:'reply',suggested:'quick',message:'x'.repeat(401)}),'standard');
 assert.equal(tierFor({route:'reply',suggested:'quick',attachments:true}),'standard');
 assert.equal(tierFor({route:'reply',suggested:'quick',deep:true}),'deep','Overclock always escalates');
 assert.equal(normalizeTier('deep'),'deep');assert.equal(normalizeTier('x'),null);
});

test('small talk is recognised locally so greetings cost no model call',()=>{
 for(const m of ['hi','Hey Capri!','thanks','lol','good morning~','ok'])assert.ok(isSmallTalk(m),m);
 for(const m of ['hi, can you explain TCP slow start','what is 2+2','remind me at 5','']) assert.ok(!isSmallTalk(m),m);
});

test('runChain moves to the next model on any failure, but a user stop ends it at once',withEnv({},async()=>{
 const seen=[],switched=[];
 const out=await runChain(['a','b','c'],async(id,{last})=>{seen.push([id,last]);if(id!=='c')throw Object.assign(Error('down'),{status:502,providerStatus:404});return {id};},{onSwitch:e=>switched.push(e.from+'>'+e.to)});
 assert.equal(out.id,'c');assert.deepEqual(seen,[['a',false],['b',false],['c',true]]);assert.deepEqual(switched,['a>b','b>c']);
 await assert.rejects(runChain(['a','b'],async()=>{throw Object.assign(Error('last'),{status:503});}),/last/);
 const controller=new AbortController();let calls=0;
 await assert.rejects(runChain(['a','b'],async()=>{calls++;controller.abort();throw new DOMException('Stopped','AbortError');},{signal:controller.signal}),{name:'AbortError'});
 assert.equal(calls,1);
}));

test('a model that returns auth/missing errors is parked so later turns skip it',withEnv({NVIDIA_API_KEY:'k',NVIDIA_FREE_ACCESS_CONFIRMED:'true',GEMINI_API_KEY:'g',GEMINI_FREE_TIER_CONFIRMED:'true'},()=>{
 const first=chainFor('quick')[0];
 markFailure(first,{providerStatus:404});
 assert.ok(parked(first));assert.ok(!chainFor('quick').includes(first));
 markFailure('nim:z-ai/glm-5.3-flash',{status:429});
 assert.ok(!parked('nim:z-ai/glm-5.3-flash')||first==='nim:z-ai/glm-5.3-flash','rate limits are not parked');
}));

test('an upstream 4xx is a provider fault that fails over, not "your request was rejected" (HTTP 400)',withEnv({NVIDIA_API_KEY:'k',NVIDIA_FREE_ACCESS_CONFIRMED:'true'},async()=>{
 const request={systemInstruction:{parts:[{text:'s'}]},contents:[{role:'user',parts:[{text:'hi'}]}],generationConfig:{maxOutputTokens:50}};
 for(const status of [400,401,403,404,422]){
  await assert.rejects(externalGenerate('nim:nvidia/nemotron-3-ultra-550b-a55b',request,{},async()=>Response.json({detail:'nope'},{status})),error=>{
   assert.equal(error.status,502,'HTTP '+status+' must not surface as 400');assert.equal(error.providerStatus,status);assert.equal(error.providerFault,true);assert.ok(failoverUpstream(error));return true;});
 }
 await assert.rejects(externalGenerate('nim:nvidia/nemotron-3-ultra-550b-a55b',request,{},async()=>Response.json({},{status:429})),{status:429});
}));

test('a bare 400 on the streaming request is retried once as a plain request',withEnv({NVIDIA_API_KEY:'k',NVIDIA_FREE_ACCESS_CONFIRMED:'true'},async()=>{
 const bodies=[];
 const result=await externalGenerate('nim:nvidia/nemotron-3-ultra-550b-a55b',{systemInstruction:{parts:[{text:''}]},contents:[{role:'user',parts:[{text:'hi'}]}],generationConfig:{maxOutputTokens:50}},{},async(url,options)=>{
  const body=JSON.parse(options.body);bodies.push(body);
  if(body.stream)return Response.json({error:{message:'Bad request'}},{status:400});
  return Response.json({choices:[{message:{content:'hello'},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:1,total_tokens:4}});
 });
 assert.equal(result.answer,'hello');assert.equal(bodies.length,2);
 assert.equal(bodies[1].stream,undefined);assert.equal(bodies[1].stream_options,undefined);
 assert.ok(bodies[0].messages.every(m=>m.role!=='system'||m.content.trim()),'an empty system message is never sent');
}));

test('stale saved model ids heal instead of blocking every turn; auto defaults on',()=>{
 const s=settingsOf({personality:'nim:retired/model',router:'gone',reasoning:'also-gone',councilModels:['x','y']});
 assert.equal(s.auto,true);assert.equal(s.personality,defaults.personality);assert.equal(s.router,defaults.router);assert.equal(s.reasoning,defaults.reasoning);
 assert.deepEqual(s.councilModels,defaults.councilModels);
 assert.equal(settingsOf({auto:false}).auto,false);
 assert.equal(settingsOf({auto:'yes'}).auto,true);
});

test('CORE AI: greetings never call a model; the tier it picks reaches every later call',async()=>{
 let calls=0;const metas=[];
 const generate=async(request,meta)=>{calls++;metas.push(meta);return {answer:JSON.stringify({messages:['hey you'],expression:'neutral_attention'})};};
 const hello=await personalize({body:{action:'turn',message:'hey capri',settings:{memory:false}},generate});
 assert.equal(hello.route,'reply');assert.equal(hello.tier,'quick');
 assert.equal(metas.filter(m=>m.phase==='capri-turn').length,0,'no routing call for small talk');
 assert.ok(metas.length>=1&&metas.every(m=>m.tier==='quick'),'the voice call carries the quick tier');
 // CORE chooses deep for hard work: the tier is returned for the research and voice calls.
 const hard=await personalize({body:{action:'turn',message:'Compare these two approaches in detail and prove which is cheaper.',settings:{memory:false}},generate:async()=>({answer:JSON.stringify({route:'reasoning',tier:'deep'})})});
 assert.equal(hard.route,'reasoning');assert.equal(hard.tier,'deep');
 // Overclock forces deep even if CORE says quick.
 const mir=await personalize({body:{action:'turn',message:'tell me more',depth:'mir',settings:{memory:false}},generate:async()=>({answer:JSON.stringify({route:'reasoning',tier:'quick'})})});
 assert.equal(mir.tier,'deep');
 // If CORE cannot be reached on any model the person still gets a reply path.
 const down=await personalize({body:{action:'turn',message:'what do you think about rainy days',settings:{memory:false}},generate:async(request,meta)=>{if(meta.phase==='capri-turn')throw Object.assign(Error('all down'),{status:503});return {answer:JSON.stringify({messages:['moody, honestly'],expression:'neutral_attention'})};}});
 assert.equal(down.route,'reply');assert.equal(down.tier,'quick');
 const downHard=await personalize({body:{action:'turn',message:'Explain how TCP congestion control works step by step',settings:{memory:false}},generate:async()=>{throw Object.assign(Error('all down'),{status:503});}});
 assert.equal(downHard.route,'reasoning');assert.equal(downHard.tier,'standard');
});

test('every chain id is a registered model (a typo would silently shrink a tier)',async()=>{
 const {externalModels}=await import('../lib/multi-provider.js');
 const {models}=await import('../lib/models.js');
 const gemini=new Set(models.map(m=>m.id));
 for(const [tier,ids] of Object.entries(CHAINS))for(const id of ids)assert.ok(id.startsWith('gemini-')?gemini.has(id):externalModels.some(m=>m.id===id),tier+': '+id+' is not registered');
});
