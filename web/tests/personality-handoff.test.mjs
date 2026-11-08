import test from 'node:test';
import assert from 'node:assert/strict';
import {personalityHandoff,citationMap} from '../public/personality-handoff.js';
import {personalize} from '../lib/personality.js';

test('handoff preserves draft and continuity but sends only cited source identities',()=>{
 const history=[{role:'model',text:'1. First topic\n2. Second topic'}],overview=[{title:'Prior chat',recent:[]}];
 const body={message:'Your view of the first?',history,overview,settings:{enabled:true},files:[{data:'BASE64'}],continuation:'CHECKPOINT',usage:{totalTokenCount:999},mode:'vault'};
 const result={answer:'First topic may be useful, but evidence is uncertain [S2, S3].',research:{searches:2},sources:[
  {id:'S1',title:'Unused',excerpt:'UNUSED_PASSAGE'},
  {id:'S2',title:'Source',path:'Source.md',vault:'Notes',excerpt:'RAW_PASSAGE'.repeat(1000),read:true},
  {id:'S3',title:'Other',path:'Other.md',vault:'Notes',excerpt:'OTHER_PASSAGE',read:true},
  {id:'S2',title:'Duplicate',excerpt:'DUPLICATE'}]};
 const handoff=personalityHandoff(body,result);
 assert.equal(handoff.answer,result.answer);assert.deepEqual(handoff.history,history);assert.deepEqual(handoff.overview,overview);
 assert.deepEqual(handoff.citationSources,[{id:'S2',title:'Source',path:'Source.md',vault:'Notes'},{id:'S3',title:'Other',path:'Other.md',vault:'Notes'}]);
 assert.equal(handoff.vaultSearches,2);assert.doesNotMatch(JSON.stringify(handoff),/RAW_PASSAGE|OTHER_PASSAGE|UNUSED_PASSAGE|DUPLICATE|CHECKPOINT|BASE64|totalTokenCount/);
 assert.deepEqual(citationMap('[S1]',[{id:'S1',read:false}]),[]);
});

test('personality preserves draft citations without further raw retrieval',async()=>{let calls=0;const result=await personalize({body:{action:'rewrite',message:'Explain the draft',answer:'Known [S1]',settings:{memory:true,web:'ask'}},generate:async(request,meta)=>{calls++;assert.equal(meta.phase,'rewrite');assert.deepEqual(JSON.parse(request.contents[0].parts[0].text).memories,[]);return {answer:'Known [S1]'};},search:()=>assert.fail('Personality must not retrieve raw notes'),webSearch:()=>assert.fail('No CORE AI web request')});assert.equal(calls,1);assert.equal(result.answer,'Known [S1]');});

test('personality cannot initiate public research independently',async()=>{let calls=0;const result=await personalize({body:{action:'rewrite',message:'Explain the draft',answer:'Known [S1]',settings:{memory:true,web:'ask'}},generate:async(request,meta)=>{calls++;assert.equal(meta.phase,'rewrite');assert.deepEqual(JSON.parse(request.contents[0].parts[0].text).memories,[]);return {answer:'Known [S1]'};},search:()=>assert.fail('Personality must not retrieve raw notes'),webSearch:()=>assert.fail('No CORE AI web request')});assert.equal(calls,1);assert.equal(result.answer,'Known [S1]');});

test('legacy handoffs remain accepted and malformed citation maps fail before generation',async()=>{
 const base={action:'rewrite',message:'Hi',answer:'Known [S1]',settings:{enabled:true,memory:false,web:'off'}};
 const result=await personalize({body:base,generate:async request=>{const c=JSON.parse(request.contents[0].parts[0].text);assert.deepEqual(c.citationSources,[]);assert.deepEqual(c.allowedCitations,['S1']);return {answer:'Known [S1]'};}});
 assert.equal(result.answer,'Known [S1]');
 for(const citationSources of [{},[{id:'S1',title:'x'.repeat(100001)}]])await assert.rejects(personalize({body:{...base,citationSources},generate:()=>{throw Error('Must not call');}}),/Invalid citation map/);
});
