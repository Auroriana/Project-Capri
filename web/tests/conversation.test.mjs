import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIntent,scheduledTime} from '../public/capture.js';
import {messageBlocks,BLOCK_SEPARATOR,splitReply} from '../public/message-blocks.js';
import {reminderOverview} from '../lib/reminder-overview.js';
import {deliverReminders} from '../lib/reminder-push.js';
import {personalize} from '../lib/personality.js';
import {mergeMessages} from '../public/timeline.js';
test('capture accepts explicit conversational requests and preserves ordinary quoted discussion',()=>{
 assert.deepEqual(captureIntent('Hey Capri, could you remind me to stretch in five minutes'),{kind:'reminder',text:'stretch in five minutes'});
 assert.deepEqual(captureIntent('Carpi note this route 42'),{kind:'note',text:'route 42'});
 for(const s of ['She said remind me tomorrow','What does “note this” mean?','My note says: remind me to call'])assert.equal(captureIntent(s),null);
 const now=new Date(2026,10,6,12);assert.equal(scheduledTime('in five minutes',now).getTime()-now.getTime(),300000);
 assert.equal(scheduledTime('in 90 mins',now).getTime()-now.getTime(),5400000);
 assert.equal(scheduledTime('2026-11-07 at 13:40',now).getHours(),13);
 assert.equal(scheduledTime('2026-11-31 at 13:40',now),null);
 assert.equal(scheduledTime('at 3 pm',now).getHours(),15);
 assert.equal(scheduledTime('stretch at 3 pm',now).getHours(),15);
 assert.equal(scheduledTime('14:30',now).getHours(),14);
 assert.equal(scheduledTime('next Friday at 3 pm',now),null);
 assert.equal(scheduledTime('next week sometime',now),null);
});
test('model chooses message blocks in the existing turn call',async()=>{
 let calls=0;const result=await personalize({body:{action:'turn',message:'that was funny',mode:'general'},generate:async()=>{calls++;return {answer:JSON.stringify({route:'reply',messages:['ha','okay, fair.'],expression:'amused_interest'})};}});
 assert.equal(calls,2);assert.deepEqual(result.blocks,['ha','okay, fair.']);assert.deepEqual(splitReply(result.answer),result.blocks);
 assert.throws(()=>messageBlocks(['okay',{}]));assert.deepEqual(messageBlocks(undefined,'A long explanation.\n\nStill related.'),['A long explanation.\n\nStill related.']);assert.ok(BLOCK_SEPARATOR);
});
test('today overview uses requested timezone and preserves completed entries',()=>{
 const rows=[{id:'a',text:'Breakfast',due_at:'2026-11-06T01:00:00Z',completed_at:null},{id:'b',text:'Old task',due_at:'2026-11-05T01:00:00Z',completed_at:null},{id:'c',text:'Done task',due_at:'2026-11-06T00:00:00Z',completed_at:'2026-11-06T00:10:00Z'}];
 const result=reminderOverview(rows,'Asia/Shanghai',new Date('2026-11-06T02:00:00Z'));assert.match(result.answer,/Breakfast/);assert.match(result.answer,/\[x\] Done task/);assert.doesNotMatch(result.answer,/Old task/);assert.match(result.content,/Old task/);assert.match(result.content,/Snapshot: 2026-11-06T02:00:00.000Z/);assert.throws(()=>reminderOverview(rows,'bad-zone'));
});
test('message merge retains unrelated turns and ignores stale edits',()=>{
 const a={id:'a',turn:'a',started:1,edited:2,role:'model',text:'new'},b={id:'b',turn:'b',started:2,edited:0,role:'model',text:'later'};
 assert.deepEqual(mergeMessages([a,b],[{...a,edited:1,text:'old'}]),[a,b]);
});
test('push retries only failed devices; in-app delivery works without push keys',async()=>{
 const make=key=>({endpoint:'https://fcm.googleapis.com/'+key,keys:{auth:'a'.repeat(22),p256dh:'b'.repeat(87)}}),a=make('a'),b=make('b'),sent=new Set(),attempts=[];
 let pass=0;const rpc=async(name,args)=>{if(name==='aria_reminder_claim')return [{id:'job',push_lease:'lease',text:'Tea',due_at:new Date().toISOString()}];if(name==='aria_notification_targets')return [a,b].filter(x=>!sent.has(x.endpoint)).map(subscription=>({subscription}));if(name==='aria_notification_ack')sent.add(args.p_target);};
 const deliver=async(sub,payload)=>{attempts.push(sub.endpoint);assert.equal(JSON.parse(payload).version,1);if(sub.endpoint===b.endpoint&&!pass)throw {statusCode:503};};
 const env={VAPID_PUBLIC_KEY:'p',VAPID_PRIVATE_KEY:'s',VAPID_SUBJECT:'mailto:owner@example.com'};
 await deliverReminders({rpc,deliver,env});pass++;await deliverReminders({rpc,deliver,env});assert.equal(attempts.filter(x=>x===a.endpoint).length,1);assert.equal(attempts.filter(x=>x===b.endpoint).length,2);
 assert.equal((await deliverReminders({rpc,env:{}})).inApp,1);
});
test('delivery releases unstarted jobs when the worker time budget is exhausted',async()=>{
 const calls=[];let clock=0;const result=await deliverReminders({now:()=>clock,budgetMs:10,env:{VAPID_PUBLIC_KEY:'p',VAPID_PRIVATE_KEY:'s',VAPID_SUBJECT:'mailto:a@example.com'},rpc:async(name,b)=>{calls.push({name,b});if(name==='aria_reminder_claim'){clock=11;return [{id:'a',push_lease:'lease'}];}},deliver:async()=>assert.fail('Must not start an expired job')});
 assert.equal(result.deferred,1);assert.ok(calls.some(x=>x.name==='aria_reminder_release'&&x.b.p_lease==='lease'));
});
