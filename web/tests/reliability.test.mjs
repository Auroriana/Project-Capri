import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIntent,reminderContent,needsVault,scheduledTime} from '../public/capture.js';
import {selectPassages} from '../lib/retrieval-selection.js';
import {completeGeneration} from '../lib/generation-recovery.js';
import {personalize} from '../lib/personality.js';
import {webSearch} from '../lib/web-search.js';
import {callUsage} from '../public/token-usage.js';
import {reminderPresentation} from '../public/spoken-text.js';
import {mountNotifications} from '../public/notifications.js';
import handler from '../api/index.js';

test('conversational reminders ask for time and compound note queries remain separate',()=>{
 const vague=captureIntent('alr thanks cutie, can you remind me later to remove the references');
 assert.equal(vague.kind,'reminder');assert.equal(scheduledTime(vague.text),null);
 const mixed=captureIntent("Remind me in 5 minutes to go get coffee? Also help me find the love poetry/quote i made and while you're at it, look inside my quotes and find your favorite 3!");
 assert.equal(reminderContent(mixed.text),'go get coffee');assert.ok(scheduledTime(mixed.text));assert.ok(needsVault(mixed.followup));
 for(const input of ['She said "can you remind me later"','Do not remind me later','Example: can you remind me later','I asked if you can remind me later'])assert.equal(captureIntent(input),null);
});
test('find my poetry forces note retrieval even when conversational classifier misses it',async()=>{
 const result=await personalize({body:{action:'turn',message:'Help me find the love poetry I made and pick your favorite 3 quotes'},generate:async()=>({answer:JSON.stringify({route:'reply',messages:['Sure.']})})});assert.equal(result.route,'vault');
});
test('retrieval prioritizes distinct matching terms, deduplicates and enforces size',()=>{
 const row=(id,content)=>({id,title:id,content});
 const best=row('love poem','love poetry quote from my notebook');
 const selected=selectPassages([row('unrelated','insurance coffee'),row('weak','quote'),best,best,row('huge','love poetry quote'.repeat(2000))],'love poetry quote');
 assert.deepEqual(selected.map(x=>x.id),['love poem']);assert.ok(selected.reduce((n,x)=>n+x.content.length,0)<=18000);
});
test('truncated prose continues, JSON regenerates whole, retry limit stays bounded',async()=>{
 const request={contents:[{role:'user',parts:[{text:'question'}]}],generationConfig:{maxOutputTokens:100}};let n=0;
 const result=await completeGeneration(request,async r=>{n++;if(n===2)assert.match(r.contents.at(-1).parts[0].text,/Continue exactly/);return {answer:n===1?'First ':'second.',truncated:n===1};});assert.equal(result.answer,'First second.');
 n=0;const json=await completeGeneration(request,async r=>{n++;assert.equal(r.contents.length,1);return {answer:n===1?'{':JSON.stringify({messages:['Complete']}),truncated:n===1};},{json:true});assert.equal(JSON.parse(json.answer).messages[0],'Complete');
 n=0;await assert.rejects(completeGeneration(request,async()=>{n++;return {answer:'x',truncated:true};}),{status:503});assert.equal(n,3);
});
test('web fallback handles both reservation and provider quotas',async()=>{
 for(const failure of ['reservation','provider']){const attempted=[];const result=await webSearch('public query',{reserve:async model=>{attempted.push(model);if(failure==='reservation'&&attempted.length===1)throw Object.assign(Error('quota'),{status:429});},generate:async()=>{if(failure==='provider'&&attempted.length===1)throw Object.assign(Error('quota'),{providerStatus:429});return {answer:'Facts',grounding:{groundingChunks:[{web:{uri:'https://example.com',title:'Source'}}]}};}});assert.equal(attempted.length,2);assert.equal(result.answer,'Facts');}
});
test('usage estimates include input and output and reminder metadata stays separate',()=>{
 const usage=callUsage(null,{contents:[{parts:[{text:'Hello'}]}]},'Hi',{model:'test',role:'reply',phase:'test',latencyMs:1});assert.ok(usage.promptTokenCount>0);assert.equal(usage.candidatesTokenCount,1);assert.equal(usage.estimated,true);
 assert.deepEqual(reminderPresentation({event:'reminder.due',text:'[focus]\nCoffee time.\n\nin 5 minutes to get coffee [S1]'}),{text:'Coffee time.',details:'in 5 minutes to get coffee [S1]'});
});
test('reply notifications sound, deduplicate and honor the off switch',async t=>{
 const names=['document','window','localStorage','navigator','Notification'],original=names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]);
 t.after(()=>{for(const [name,descriptor] of original)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
 let button,sounds=0;const alerts=[];
 class Audio{state='running';currentTime=0;resume(){return Promise.resolve();}createOscillator(){return {frequency:{value:0},connect(){},start(){sounds++;},stop(){}};}createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}}
 class Notice{static permission='granted';static async requestPermission(){return 'granted';}constructor(title,options){alerts.push(options);}}
 const values={document:{hidden:true,hasFocus:()=>false,addEventListener(){},createElement:()=>({setAttribute(){}})},window:{AudioContext:Audio,Notification:Notice,focus(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{},Notification:Notice};
 for(const [name,value] of Object.entries(values))Object.defineProperty(globalThis,name,{configurable:true,value});
 const notifications=mountNotifications({api:async()=>({}),container:{append:n=>button=n},onError:e=>{throw Error(e);}});
 await button.onclick();const before=sounds;const stamp=Date.now()+5000;t.mock.method(Date,'now',()=>stamp);
 notifications.notify({id:'reply-1',role:'model',text:'[focus]Here are 3 quotes [S1].'});notifications.notify({id:'reply-1',role:'model',text:'Duplicate'});
 assert.equal(alerts.length,1);assert.equal(alerts[0].body,'Here are 3 quotes.');assert.equal(alerts[0].silent,false);assert.ok(before>=1);assert.equal(sounds,before+1);
 await button.onclick();notifications.notify({id:'reply-2',role:'model',text:'Muted'});assert.equal(alerts.length,1);
});
test('quota failure checkpoints research and resumes without repeating successful searches',async t=>{
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',OWNER_USER_ID:'owner',GEMINI_API_KEY:'test',GEMINI_FREE_TIER_CONFIRMED:'true',ENABLE_ROUTER:'true'};
 const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 let calls=0,searches=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'owner'});
  if(url.includes('aria_reserve'))return Response.json(true);
  if(url.includes('aria_vault_overview'))return Response.json([]);
  if(url.includes('aria_search')){searches++;return Response.json([{id:'poem',title:'Love poetry',source_path:'Poem.md',content:'Love poetry quotation',vault_name:'Notes'}]);}
  calls++;if(calls>=2&&calls<=4)return Response.json({error:{details:[]}},{status:429}); // quota hits all three Gemini candidates, so the turn checkpoints
  const answer=calls===1?'{"intent":"case","queries":["love poetry"]}':calls===5?'{"queries":[]}':'Found your poem [S1].';
  return Response.json({candidates:[{content:{parts:[{text:answer}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:10,totalTokenCount:30}});
 });
 const body={model:'gemini-3.5-flash-lite',mode:'vault',message:'Find love poetry',resumable:true};
 async function call(extra){let result;const res={setHeader(){},end:s=>result=JSON.parse(s)};await handler({method:'POST',url:'/api/chat',headers:{cookie:'aria_session=test','content-type':'application/json'},body:{...body,...extra}},res);assert.equal(res.statusCode,200);return result;}
 const first=await call({});assert.equal(first.retryStatus,429);assert.ok(first.continuation);assert.equal(searches,1);
 const second=await call({continuation:first.continuation});assert.equal(second.answer,'Found your poem [S1].');assert.equal(searches,1);assert.equal(second.usage.totalTokenCount,90);
});
