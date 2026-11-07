self.addEventListener('push',event=>{
 let data;try{data=event.data.json();}catch{return;}
 event.waitUntil((async()=>{const time=Date.parse(data.occurredAt);if(!Number.isFinite(time)||Date.now()-time>900000)return;try{const response=await fetch('/api/reminder-status?key='+encodeURIComponent(data.id),{credentials:'same-origin'});if(!response.ok)return;const status=await response.json();if(!status.active)return;}catch{return;}await self.registration.showNotification('Capri',{body:data.body,tag:data.messageId||data.id,icon:'/capri-profile.avif',data:{message:data.messageId||data.id+'/opening'},requireInteraction:true,silent:false,vibrate:[160,80,160]});})());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const id=event.notification.data?.message||(event.notification.data?.chat&&event.notification.data.chat+'/opening');
 if(typeof id!=='string'||id.length>100)return;
 event.waitUntil((async()=>{const windows=await clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(w=>new URL(w.url).origin===self.location.origin);if(existing){await existing.focus();existing.postMessage({type:'capri:notification',messageId:id});}else await clients.openWindow('/?message='+encodeURIComponent(id));})());
});
