import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTree,extractLinks,resolveLink,withLayout,readLayout,splitNote,aliasesOf} from '../public/note-model.js';
import {planImport,verifyPlan} from '../public/importer.js';
import {conversationMemory,recentChats} from '../public/chat-store.js';
import {sealCheckpoint,openCheckpoint} from '../lib/checkpoint.js';
import {researchStep,createResearchState} from '../lib/rag.js';
import {validateChat,models} from '../lib/models.js';
import {proposeLayout} from '../lib/note-format.js';
import {validateSyncConfig} from '../../tools/sync-config.mjs';
import {noteRoutes} from '../lib/notes-api.js';
import handler from '../api/index.js';

const notes=[{path:'Policies/Transfer to Licensed.md',aliases:['Licensed']},{path:'50 Maps/Home.md'},{path:'Start Here.md'},{path:'Other/Home.md'}];
test('folder tree never flattens paths; links handle aliases, relative paths, headings and ambiguity',()=>{
  const tree=buildTree(notes);assert.deepEqual(tree.notes.map(n=>n.path),['Start Here.md']);assert.equal(tree.folders.get('50 Maps').notes[0].path,'50 Maps/Home.md');
  const links=extractLinks('---\ntitle: "[[not a link]]"\n---\n[[Licensed|transfer]] [[50 Maps/Home#Overview]] [Home](../50%20Maps/Home.md) `[[ignore]]`\n```\n[[ignore too]]\n```');
  assert.equal(links.length,3);assert.equal(resolveLink(links[0],'Policies/Case.md',notes).resolved,notes[0].path);
  assert.equal(resolveLink(links[1],'Start Here.md',notes).anchor,'Overview');assert.equal(resolveLink(links[2],'Policies/Case.md',notes).resolved,notes[1].path);
  assert.equal(resolveLink('Home','Start Here.md',notes).ambiguous,true);assert.deepEqual(aliasesOf('---\naliases: [Licensed, "Transfer"]\n---\n'),['Licensed','Transfer']);
});
test('layout application preserves body byte for byte and invalidates stale styles',async()=>{
  const text='---\nai_enabled: true\n---\n\nNon-payment\n1. Keep **every** word.\n  1. If yes\n     1. Stop.\n';
  const layout={blocks:[{kind:'heading',line:2,level:2}],spans:[{start:1,end:12,kind:'strong'}]};
  const formatted=withLayout(text,layout);assert.equal(splitNote(formatted).body,splitNote(text).body);assert.ok(readLayout(formatted));assert.equal(readLayout(formatted+'extra'),null);
  assert.throws(()=>withLayout(text,{replacementText:'rewritten'}));assert.throws(()=>withLayout(text,{spans:[{kind:'color',start:0,end:5,color:'url(javascript:evil)'}]}));
  const original='1. State FL or VA?\n   1. If yes\n      1. Stop.\n'+('word\n'.repeat(1000));
  const p=await planImport(original,{sectionLabels:false});assert.equal(p.labels,0);assert.ok(verifyPlan(original,p));assert.equal(p.parts.map(p=>p.pieces.filter(x=>!x.added).map(x=>x.text).join('')).join(''),original);
});
test('formatter rejects generated replacement text and accepts only verified positional layout',async()=>{
  await assert.rejects(proposeLayout('A\nB',async()=>({answer:'{"blocks":[],"text":"rewrite"}'})),/invalid layout/);
  assert.equal((await proposeLayout('A\nB',async()=>({answer:'{"blocks":[{"line":1,"kind":"branch","endLine":2}],"spans":[]}'}))).blocks.length,1);
});
test('history retains ten conversations and sends earlier messages as memory',()=>{
  const chats=Array.from({length:11},(_,i)=>({id:i,updated:i}));assert.deepEqual(recentChats(chats).map(c=>c.id),[10,9,8,7,6,5,4,3,2,1]);
  assert.deepEqual(conversationMemory([{role:'user',text:'Customer lives in FL'},{role:'model',text:'Understood'},{role:'user',text:'What is next?'}]).map(m=>m.text),['Customer lives in FL','Understood','What is next?']);
});
test('checkpoints survive serialization and reject tampering, another owner or different question',()=>{
  const state=createResearchState(),token=sealCheckpoint(state,'owner','question');assert.deepEqual(openCheckpoint(token,'owner','question'),state);
  assert.throws(()=>openCheckpoint(token,'other','question'));assert.throws(()=>openCheckpoint(token,'owner','other'));assert.throws(()=>openCheckpoint(token.slice(0,50)+(token[50]==='X'?'Y':'X')+token.slice(51),'owner','question'));
});
test('resumed research retains earlier evidence, attached images, stable citations and memory',async()=>{
  let state={...createResearchState(),needsHistory:true},calls=0;const files=[{inlineData:{mimeType:'image/png',data:'test'}}],history=[{role:'user',text:'Customer is in Florida.'}];
  for(let i=0;i<12;i++){
    const result=await researchStep({state,message:'Next step?',files,history,search:async q=>[{id:q,title:q,source_path:q+'.md',content:'Stop. [[Transfer to Licensed]]'}],generate:async request=>{
      assert.deepEqual(request.contents[0].parts[1],files[0]);const c=JSON.parse(request.contents[0].parts[0].text);assert.deepEqual(c.conversationMemory,history);
      if(++calls===1)return {answer:'{"queries":["Transfer to Licensed"]}'};if(calls===2)return {answer:'{"queries":[]}'};return {answer:'Transfer [S2].'};
    }});
    if(result.result){assert.equal(result.result.sources.length,2);assert.equal(result.result.research.searches,2);return;}
    state=openCheckpoint(sealCheckpoint(result.state,'owner','hash'),'owner','hash');
  }assert.fail('Research did not finish');
});
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64');
test('screenshots validate and become multimodal model parts; forged images and oversized payloads fail',()=>{
  const b={model:models[0].id,mode:'general',message:'Read this',files:[{mime:'image/png',data:png}]};
  assert.deepEqual(validateChat(b).files,[{inlineData:{mimeType:'image/png',data:png}}]);
  assert.throws(()=>validateChat({...b,files:[{mime:'image/png',data:Buffer.from('<script>').toString('base64')}]}));
  assert.throws(()=>validateChat({...b,files:Array(5).fill(b.files[0])}));
});
test('API delivers an actual image part in general chat',async t=>{
  const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',OWNER_USER_ID:'owner',GEMINI_API_KEY:'test',GEMINI_FREE_TIER_CONFIRMED:'true'};
  const before={};for(const k in env){before[k]=process.env[k];process.env[k]=env[k];}t.after(()=>{for(const k in before)if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];});
  let seen=false;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url.endsWith('/auth/v1/user'))return {ok:true,json:async()=>({id:'owner'})};if(url.endsWith('/aria_reserve'))return {ok:true,json:async()=>true};
    const body=JSON.parse(options.body);assert.deepEqual(body.contents.at(-1).parts[1],{inlineData:{mimeType:'image/png',data:png}});seen=true;
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'Screenshot text recognized'}]}}]})};
  });
  let reply;const res={setHeader(){},end(v){reply=JSON.parse(v);}};
  await handler({method:'POST',url:'/api/chat',headers:{host:'localhost',cookie:'aria_session=test','content-type':'application/json'},body:{model:models[0].id,mode:'general',message:'Read this',files:[{mime:'image/png',data:png}]}},res);
  assert.equal(res.statusCode,200);assert.ok(seen);assert.equal(reply.answer,'Screenshot text recognized');
});
test('notes API paginates beyond 1000 and exposes references without full content',async()=>{
  let queries=0,result;
  await noteRoutes({req:{method:'GET'},route:'/api/notes',url:new URL('https://aria/api/notes?vault=a81a0000-0000-4000-8000-0000000000f1'),token:'owner',fail:message=>new Error(message),send:(_,r)=>result=r,sb:async()=>++queries<=2?Array.from({length:500},(_,i)=>({path:`${queries}-${i}.md`,content:'[[Home]]'})):[{path:'last.md',content:'[[Home]]'}]});
  assert.equal(result.notes.length,1001);assert.equal(result.notes[0].references[0].target,'Home');assert.equal(result.notes[0].content,undefined);
});
test('sync configuration rejects duplicate and nested vault mappings',()=>{
  const base=process.cwd(),v={localPath:base,cloudName:'A'};
  assert.throws(()=>validateSyncConfig({vaults:[v,{...v,cloudName:'B'}]}));assert.throws(()=>validateSyncConfig({vaults:[v,{localPath:base+'/nested',cloudName:'B'}]}));
  assert.equal(validateSyncConfig({vaults:[v]}).intervalSeconds,30);
});
