import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIntent,scheduledTime} from '../public/capture.js';
import {agendaRoutes} from '../lib/agenda.js';
import {deliverReminders,validSubscription} from '../lib/reminder-push.js';
const key=crypto.randomUUID(),fail=(message,status=400)=>Object.assign(Error(message),{status});
test('explicit capture, relative time, local tomorrow and invalid time',()=>{
 assert.deepEqual(captureIntent('Note this for me, buy tea'),{kind:'note',text:'buy tea'});assert.equal(captureIntent('She said "remind me about tea"'),null);
 const now=new Date(2026,10,5,15);assert.equal(scheduledTime('tea in 10 minutes',now).getTime(),now.getTime()+600000);assert.equal(scheduledTime('tea tomorrow at 9 am',now).getHours(),9);assert.equal(scheduledTime('tea today at 9 am',now),null);assert.equal(scheduledTime('tea tomorrow at 29:70',now),null);
});
test('note success follows durable queue acknowledgement',async()=>{
 let result;const args={req:{method:'POST'},route:'/api/capture',token:'owner',fail,readBody:async()=>({key,message:'Note this for me, buy tea'}),send:(_,r)=>result=r,sb:async(url,token,b)=>{assert.equal(token,'owner');assert.match(url,/aria_quick_enqueue$/);assert.equal(b.p_text,'buy tea');return {ok:true};}};
 await agendaRoutes(args);assert.equal(result.kind,'note');await assert.rejects(agendaRoutes({...args,sb:async()=>({ok:false})}),/could not be queued/);
});
test('reminders validate dates and retries reuse persisted records',async()=>{
 const due=new Date(Date.now()+3600000).toISOString();let writes=0,result;const args={req:{method:'POST'},route:'/api/capture',token:'owner',fail,readBody:async()=>({key,message:'Remind me about tea',due,timezone:'Asia/Shanghai'}),send:(_,r)=>result=r,sb:async(url)=>{if(url.endsWith('aria_reminder_list'))return [{id:key,text:'tea',due_at:due,timezone:'Asia/Shanghai'}];writes++;return {ok:true};}};
 await agendaRoutes(args);assert.equal(writes,0);assert.equal(result.kind,'reminder');await assert.rejects(agendaRoutes({...args,readBody:async()=>({key,message:'Remind me about tea',due:'yesterday',timezone:'UTC'})}),/future time/);
});
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/token',keys:{auth:'a'.repeat(22),p256dh:'a'.repeat(87)}};
test('push restricts destinations and encryption keys',()=>{assert.equal(validSubscription(subscription),true);for(const endpoint of ['https://localhost/private','http://fcm.googleapis.com/token','https://fcm.googleapis.com.evil.test/token','https://x@y.example/a'])assert.equal(validSubscription({...subscription,endpoint}),false);});
test('delivery includes personality, removes expired devices, and acknowledges success',async()=>{
 const calls=[],rpc=async(name,b)=>{calls.push({name,b});if(name==='aria_reminder_claim')return [{id:key,text:'Tea',notification:'Kettle time, choom.'}];if(name==='aria_notification_targets')return [{subscription}];},env={VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private',VAPID_SUBJECT:'mailto:test@example.com'};
 let payload;await deliverReminders({rpc,env,deliver:async(_,p)=>payload=JSON.parse(p)});assert.equal(payload.body,'Kettle time, choom.');assert.equal(calls.at(-1).b.p_delivered,true);
 calls.length=0;await deliverReminders({rpc,env,deliver:async()=>{throw {statusCode:410};}});assert.ok(calls.some(c=>c.name==='aria_push_remove'));assert.equal(calls.at(-1).b.p_delivered,true,'an expired device does not need delivery retries');
});
test('scheduled push voice comes from configured personality and is persisted with original reminder',async t=>{
 const oldKey=process.env.GEMINI_API_KEY,oldTier=process.env.GEMINI_FREE_TIER_CONFIRMED;process.env.GEMINI_API_KEY='fixture';process.env.GEMINI_FREE_TIER_CONFIRMED='true';
 t.after(()=>{for(const [k,v] of [['GEMINI_API_KEY',oldKey],['GEMINI_FREE_TIER_CONFIRMED',oldTier]])if(v===undefined)delete process.env[k];else process.env[k]=v;});
 let saved;await agendaRoutes({req:{method:'POST'},route:'/api/capture',token:'owner',model:'fixture',fail,readBody:async()=>({key,message:'Remind me about tea',due:new Date(Date.now()+3600000).toISOString(),timezone:'Asia/Shanghai',settings:{prompts:{personality:'Be quietly playful.'}}}),send(){},sb:async(url,token,body)=>{if(url.endsWith('aria_reminder_list')||url.endsWith('aria_reminder_overview_rows'))return [];if(url.endsWith('aria_reserve'))return true;if(url.endsWith('aria_reminder_save'))saved=body;return {ok:true};},generate:async()=>assert.fail('Saving must not wait for a model')});
 assert.equal(saved.p_notification,'tea');assert.equal(saved.p_text,'tea');
});
