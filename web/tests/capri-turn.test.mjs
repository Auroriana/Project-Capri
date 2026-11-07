import test from 'node:test';
import assert from 'node:assert/strict';
import {personalize} from '../lib/personality.js';
import {quickRequest} from '../lib/quick-note.js';

test('a reaction gets a single speaking call with owner calibration and the previous visible reply',async()=>{
 const history=[{role:'user',text:'Say hi to my workmate.'},{role:'model',text:'Hey!'}];
 let calls=0;
 const reply=await personalize({body:{action:'turn',message:'How cheeky',history},generate:async req=>{
   calls++;const data=JSON.parse(req.contents[0].parts[0].text);
   assert.equal(data.conversation.at(-1).text,'Hey!');assert.equal(data.previousAssistantReply,undefined);
   assert.ok(data.personalityPassages.some(p=>p.kind==='owner-calibration'));
   return {answer:JSON.stringify({route:'reply',answer:'Who, me?',expression:'amused_interest'})};
 }});
 assert.equal(calls,1);assert.equal(reply.answer,'Who, me?');assert.equal(reply.expression,'amused_interest');
});

test('delegation infers note retrieval without a manual mode and still inspects attachments',async()=>{
 for(const [choice,hasAttachments] of [['vault',false],['reply',true]]){
  const result=await personalize({body:{action:'turn',message:'Take a look.',mode:'general',hasAttachments,settings:{memory:false}},generate:async()=>({answer:JSON.stringify({route:choice,answer:'premature',expression:'unknown'})})});
  assert.equal(result.route,choice==='vault'?'vault':'reasoning');assert.equal(result.answer,'');assert.equal(result.expression,'neutral_attention');
 }
});

test('researched replies separate expression from citation-bearing dialogue',async()=>{
 const result=await personalize({body:{action:'rewrite',sprite:true,message:'What did the note say?',answer:'Tuesday [S1].',settings:{memory:false,web:'off'}},generate:async()=>({answer:'{"answer":"Tuesday [S1].","expression":"focused_analysis"}'})});
 assert.equal(result.answer,'Tuesday [S1].');assert.equal(result.expression,'focused_analysis');assert.ok(result.personalityResearch.passages.length);
});

test('a quick note keeps its document purpose with a conversational voice snapshot',()=>{
 const text=quickRequest({text:'Check the time.',personality:'Always greet the owner.'},[]).systemInstruction.parts[0].text;
 assert.ok(text.indexOf('standalone documentation')<text.indexOf('Always greet'));assert.match(text,/Ignore conversational/);
});
