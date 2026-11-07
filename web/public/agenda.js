import {freshReminder} from './reminder-actions.js';
import {captureIntent,relativeTime,scheduledTime,localDateTime} from './capture.js';
export function reminderChat(r,model){
 const started=Date.parse(r.due_at),text=(r.notification||'Hey, this is your reminder.')+'\n\n'+r.text+'\n\n'+new Date(r.due_at).toISOString()+' ('+r.timezone+')';
 return {id:r.id,title:'Reminder · '+r.text.slice(0,50),updated:started,mode:'general',vault:'all',model,messages:[{id:r.id+'/opening',turn:r.id+'/opening',started,edited:0,role:'model',text}]};
}
async function dailyId(owner){
 const day=localDateTime(new Date()).slice(0,10),bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('capri-agenda:'+owner+':'+day))).slice(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
export function mountAgenda({api,owner,busy,ready=()=>true,model,save,open,reply,onError,settings,onDue=()=>{},onCompleted=()=>{},openOverview=()=>{}}){
 let checking=false,seen=new Set(),account='';
 const key=()=> 'capri.reminder-alerts.'+owner();
 const dialog=document.createElement('dialog');dialog.className='agenda-dialog';document.body.append(dialog);
 const button=document.createElement('button');button.type='button';button.textContent='Reminders';button.onclick=()=>show().catch(e=>onError(e.message));document.querySelector('.chat-options')?.append(button);
 async function complete(id){const result=await api('reminder-complete',{key:id,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});if(!result.ok)throw Error('Could not complete reminder.');seen.add(id);await onCompleted(id);return result;}
 async function show(){const who=owner();const {reminders}=await api('agenda');if(who!==owner())return;dialog.replaceChildren();const heading=document.createElement('h2');heading.textContent='Reminders';dialog.append(heading);
 if(!reminders.length){const empty=document.createElement('p');empty.textContent='All caught up. No outstanding reminders.';dialog.append(empty);}
 for(const r of reminders){const row=document.createElement('p'),done=document.createElement('button');row.textContent=r.text+' — '+new Date(r.due_at).toLocaleString()+' ';done.textContent='Mark done';done.onclick=async()=>{done.disabled=true;try{await complete(r.id);await show();}catch(e){done.disabled=false;onError(e.message);}};row.append(done);dialog.append(row);}
 const close=document.createElement('button');close.textContent='Close';close.onclick=()=>dialog.close();dialog.append(close);if(!dialog.open)dialog.showModal();
 }

 async function check(initial=false,all=false){
  const who=owner();if(!who||checking||(!initial&&(document.hidden||!ready())))return;
  checking=true;
  try{
   const {reminders,archiveWarning}=await api('agenda?timezone='+encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone));if(owner()!==who)return;if(archiveWarning)onError('Reminder overview sync pending: '+archiveWarning);
   if(account!==who){account=who;try{seen=new Set(JSON.parse(localStorage.getItem(key())||'[]'));}catch{seen=new Set();}}
   const now=Date.now(),due=reminders.filter(r=>!r.completed_at&&Date.parse(r.due_at)<=now);
   const fresh=due.filter(r=>!seen.has(r.id)&&freshReminder(r.due_at,now));if(fresh.length)onDue(fresh);for(const r of due)seen.add(r.id);try{localStorage.setItem(key(),JSON.stringify([...seen].slice(-1000)));}catch{}

  }catch(e){if(initial)throw e;if(owner()===who)onError('Could not load reminders: '+e.message);}finally{checking=false;}
 }
 setInterval(()=>check(),30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});window.addEventListener('online',()=>check());
 return {check,show,complete,clear(){seen.clear();account='';dialog.close();},async capture(message,key){
  const intent=captureIntent(message);if(!intent)return null;const due=intent.kind==='reminder'?scheduledTime(intent.text)?.toISOString():undefined;
  return {key,message,due,needsTime:intent.kind==='reminder'&&!due,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,settings:settings()};
 }};
}
