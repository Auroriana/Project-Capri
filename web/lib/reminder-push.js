import webpush from 'web-push';
import {workerAuthorized} from './quick-api.js';
import {reminderEvent,mapConcurrent} from './notification-events.js';
import {archiveReminderOverview} from './reminder-overview.js';
// Exact vendor hosts only. Do not allow client-supplied arbitrary HTTP targets.
export function validSubscription(value){
 if(!value||typeof value.endpoint!=='string'||value.endpoint.length>2048)return false;
 let url;try{url=new URL(value.endpoint);}catch{return false;}
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash)return false;
 if(!['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname)&&!/^([a-z0-9-]+\.)?notify\.windows\.com$/.test(url.hostname))return false;
 return typeof value.keys?.p256dh==='string'&&/^[A-Za-z0-9_-]{87}$/.test(value.keys.p256dh)&&typeof value.keys?.auth==='string'&&/^[A-Za-z0-9_-]{22}$/.test(value.keys.auth);
}
export async function pushRoutes({req,route,token,sb,send,fail,readBody}){
 if(route==='/api/push-config'&&req.method==='GET'){send(200,{publicKey:process.env.VAPID_PUBLIC_KEY||null});return true;}
 if(route==='/api/push-unsubscribe'&&req.method==='POST'){const {endpoint}=await readBody(req,3000);if(typeof endpoint!=='string'||endpoint.length>2048)throw fail('Invalid endpoint.');await sb('/rest/v1/rpc/aria_push_remove',token,{p_endpoint:endpoint});send(200,{ok:true});return true;}
 if(route!=='/api/push-subscribe')return false;
 if(req.method!=='POST')throw fail('Method not allowed.',405);
 const {subscription}=await readBody(req,5000);if(!validSubscription(subscription))throw fail('Unsupported or invalid push subscription.');
 await sb('/rest/v1/rpc/aria_push_subscribe',token,{p_subscription:subscription});send(200,{ok:true});return true;
}
export async function deliverReminders({rpc,deliver=webpush.sendNotification.bind(webpush),env=process.env,now=Date.now,budgetMs=75000,isActive=async()=>true}){
 const start=now(),jobs=await rpc('aria_reminder_claim',{});let delivered=0,failed=0,deferred=0;
 // Claim also materializes in-app messages, independently of push configuration.
 if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return {delivered:0,failed:0,inApp:jobs.length,pushConfigured:false};
 for(const job of jobs){
  if(now()-start>=budgetMs){await rpc('aria_reminder_release',{p_id:job.id,p_lease:job.push_lease});deferred++;continue;}
  const due=Date.parse(job.due_at);if(Number.isFinite(due)&&now()-due>900000){await rpc('aria_reminder_delivery',{p_id:job.id,p_lease:job.push_lease,p_delivered:true});continue;}
  if(!await isActive(job.id))continue;
  const payload=JSON.stringify(reminderEvent(job));
  const subscriptions=await rpc('aria_notification_targets',{p_id:job.id});let success=false,retry=false;
  await mapConcurrent(subscriptions,4,async sub=>{
   if(!validSubscription(sub.subscription))return;
   const remaining=budgetMs-(now()-start);if(remaining<=0){retry=true;return;}
   try{await deliver(sub.subscription,payload,{TTL:900,urgency:'high',timeout:Math.min(15000,remaining),...(env.HTTPS_PROXY?{proxy:env.HTTPS_PROXY}:{}),vapidDetails:{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY}});await rpc('aria_notification_ack',{p_id:job.id,p_lease:job.push_lease,p_target:sub.subscription.endpoint});success=true;}
   catch(e){if([404,410].includes(e.statusCode))await rpc('aria_push_remove',{p_endpoint:sub.subscription.endpoint});else retry=true;}
  });
  await rpc('aria_reminder_delivery',{p_id:job.id,p_lease:job.push_lease,p_delivered:!retry});
  if(success)delivered++;if(retry)failed++;
 }
 return {delivered,failed,deferred};
}
export async function reminderWorker({req,sb,fail,send}){
 if(!workerAuthorized(req.headers.authorization,process.env.REMINDER_WORKER_SECRET))throw fail('Access denied.',403);
 if(!process.env.ARIA_EMAIL||!process.env.ARIA_PASSWORD)throw fail('Reminder worker account is not configured.',503);
 const session=await sb('/auth/v1/token?grant_type=password',null,{email:process.env.ARIA_EMAIL,password:process.env.ARIA_PASSWORD});
 if(session.user?.id!==process.env.OWNER_USER_ID)throw fail('Worker account does not own Capri.',403);
 const token=session.access_token,rpc=(name,body)=>sb('/rest/v1/rpc/'+name,token,body);
 const result=await deliverReminders({rpc,isActive:async id=>(await rpc('aria_reminder_list',{})).some(r=>r.id===id&&!r.completed_at)}),reminders=await rpc('aria_reminder_list',{}),archiveWarnings=[];
 await mapConcurrent([...new Set(reminders.map(r=>r.timezone))],3,async timezone=>{try{await archiveReminderOverview({sb,token,timezone});}catch(e){archiveWarnings.push(e.message);}});
 send(200,{...result,...(archiveWarnings.length?{archiveWarnings}:{})});
}
