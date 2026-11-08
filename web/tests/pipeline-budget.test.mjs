import test from 'node:test';import assert from 'node:assert/strict';
import {capHistory,recentExchange} from '../public/context-budget.js';
import {prepareNote,validatePreparation,preparationWindows} from '../lib/note-preparation.js';
import {researchStep,createResearchState} from '../lib/rag.js';
import {estimateText} from '../public/token-usage.js';
test('history drops oldest messages and preserves the recent exchange within a token cap',()=>{
 const h=Array.from({length:40},(_,i)=>({role:i%2?'model':'user',text:'Message '+i+' x'.repeat(80)}));
 const capped=capHistory(h,500);assert.ok(estimateText(JSON.stringify(capped))<520);assert.deepEqual(capped.at(-1),h.at(-1));assert.equal(recentExchange(capped).length,2);
});
test('preparation retries invalid numbers, preserves originals, and reuses hashes',async()=>{
 const note={title:'Plan',content:'- Pay 25 on Friday.\n- Bring 2 keys.'};let calls=0;
 const good={heading:'Plan',text:note.content,clarified:'Pay 25 on Friday. Bring 2 keys.',keywords:['payment'],questions:['What should I bring?']};
 const result=await prepareNote(note,async()=>({answer:JSON.stringify({chunks:[++calls===1?{...good,clarified:'Pay Friday.'}:good]})}));
 assert.equal(calls,2);assert.equal(result.retries,1);assert.equal(result.fallback,false);
 assert.equal((await prepareNote(note,()=>assert.fail('Unchanged note must not call model'),result)).reused,true);
 assert.throws(()=>validatePreparation(note.content,[{...good,text:'Edited source'}]),/Source/);
 assert.equal(preparationWindows(note.content.repeat(1000)).join(''),note.content.repeat(1000));
});
test('RAG serialized evidence stays below 2500 estimated tokens and retains stable citations',async()=>{
 const state={...createResearchState(),phase:'answer',intent:'lookup',sources:Array.from({length:12},(_,i)=>({key:String(i),title:'Note '+i,content:('Relevant fact '+i+' ').repeat(160),relevance:12-i}))};
 await researchStep({state,message:'What are the facts?',search:()=>assert.fail(),generate:async r=>{
  const e=JSON.parse(r.contents[0].parts[0].text).evidence;assert.ok(e.length<=8);assert.ok(estimateText(JSON.stringify(e))<=2500);assert.equal(e[0].id,'S1');return {answer:'Fact [S1]'};
 }});
});
