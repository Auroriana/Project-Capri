import {freshReminder,reminderId} from './reminder-actions.js';
import {spokenText,reminderPresentation} from './spoken-text.js';
export function mountNotifications({api,container,onError,owner=()=>''}){
 const button=document.createElement('button');button.type='button';button.id='notification-toggle';
 let enabled=localStorage.getItem('capri.notifications')==='on',audio,registration,lastSound=0;
 let account='',seen=new Set();const load=()=>{if(account===owner())return;account=owner();try{seen=new Set(JSON.parse(localStorage.getItem('capri.alerts.'+account)||'[]'));}catch{seen=new Set();}};
 const refresh=()=>{button.textContent=enabled?'Notifications on':'Enable notifications';button.setAttribute('aria-pressed',String(enabled));};
 const unlock=()=>{try{audio??=new (window.AudioContext||window.webkitAudioContext)();void audio.resume();}catch{}};
 document.addEventListener('pointerdown',()=>{if(enabled)unlock();});
 const sound=()=>{if(!audio||audio.state!=='running'||Date.now()-lastSound<2500)return;lastSound=Date.now();const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.frequency.value=660;gain.gain.setValueAtTime(.08,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.25);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.25);};
 async function setup(){
  if(!('serviceWorker' in navigator))return;
  registration=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
  const {publicKey}=await api('push-config');
  if(publicKey&&registration.pushManager){const bytes=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(publicKey.length/4)*4,'=')),c=>c.charCodeAt(0));const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});await api('push-subscribe',{subscription:subscription.toJSON()});}
  else onError('Reply alerts are enabled. Closed-app reminders need server push configuration.');
 }
 button.onclick=async()=>{try{
  unlock();if(enabled){const sub=await registration?.pushManager?.getSubscription();if(sub){await api('push-unsubscribe',{endpoint:sub.endpoint});await sub.unsubscribe();}enabled=false;}
  else{if(!('Notification' in window))throw Error('This browser does not support desktop notifications.');if(await Notification.requestPermission()!=='granted')throw Error('Allow notifications for this site in browser settings.');enabled=true;localStorage.setItem('capri.notifications','on');await setup();sound();}
  localStorage.setItem('capri.notifications',enabled?'on':'off');refresh();
 }catch(e){refresh();onError(e.message);}};
 refresh();container.append(button);
 return {async restore(){if(enabled&&globalThis.Notification?.permission==='granted')try{await setup();}catch(e){onError('Notification setup pending: '+e.message);}},notify(message){
  load();const id=reminderId(message);if(id&&(message.reminderCompleted||!freshReminder(message.started??message.sentAt)))return;
  if(!enabled||message.role!=='model'||seen.has(message.id))return;seen.add(message.id);try{localStorage.setItem('capri.alerts.'+account,JSON.stringify([...seen].slice(-1000)));}catch{}
  const body=reminderPresentation(message).text||spokenText(message.text);sound();
  if(!document.hidden&&document.hasFocus())return;
  if(globalThis.Notification?.permission!=='granted')return;
  const options={body:body.slice(0,250),tag:message.id,icon:'/capri-profile.avif',silent:false,data:{message:message.id}};
  if(registration)void registration.showNotification('Capri',options).catch(()=>{});else{const n=new Notification('Capri',options);n.onclick=()=>{window.focus();n.close();};}
 }};
}
