import {completionIntent,reminderId} from '/reminder-actions.js';
import {requestErrorText} from '/request-error.js';
import {mountNotifications} from '/notifications.js';
import {spokenText,reminderPresentation} from '/spoken-text.js';
import {createTimeline,mergeMessages} from '/timeline.js';
import {mountTerminals} from '/terminals.js';
import {splitReply} from '/message-blocks.js';
import {bubbleDelay,turnHistory} from '/conversation-flow.js';
import {scheduledTime} from '/capture.js';
import {mountAgenda} from '/agenda.js';
import {captureIntent,reminderQuery} from '/capture.js';
import {queueJump,clearScan,showScan,stopFlight} from '/scan-path.js';
import {readChatStream} from '/chat-stream.js';
import {setExpression} from '/expression.js';
import {personalityHandoff} from '/personality-handoff.js';
import {mountCoreSettings} from '/core-settings.js';
import {addUsage} from '/token-usage.js';
import {estimateQuestion,usageTitle,usageDetails} from '/token-usage.js';
import {renderMarkdown,highlightClaim} from '/note-renderer.js';
import {mountWorkspace} from '/workspace.js';
import {mountQuick} from '/quick.js';
import {conversationMemory,chatRows} from '/chat-store.js';

const $=id=>document.getElementById(id),el=(t,x)=>{const n=document.createElement(t);if(x!==undefined)n.textContent=x;return n};
let booting=true,hardStopping=false,workController=new AbortController(),workEpoch=0;
let history=[],signedIn=false,busy=false,cfg,first=true,owner="",currentChat=null,chatController=null;
const terminals=mountTerminals($('terminals'),$('pt'));
const timeline=createTimeline({api,owner:()=>owner,legacy:chatRows});
const notifications=mountNotifications({api,owner:()=>owner,container:document.querySelector('.chat-options'),onError:message=>err(message)});
const core=mountCoreSettings({api,owner:()=>owner,busy:()=>busy,onSaved:refreshPendingSettings,onWelcome:()=>loadWelcome(owner,true),onArchive:()=>syncHistory(true)});
const agenda=mountAgenda({api,owner:()=>owner,busy:()=>busy,ready:()=>!booting,model:()=>$('model').value,settings:()=>core.get(),onCompleted:completeReminderUI,onError:message=>err(message),save:async()=>{},open:async()=>tab(false),reply:text=>{$('q').value=text;$('f').requestSubmit();},onDue:rows=>{for(const r of rows)notifications.notify({id:r.id+'/opening',role:'model',event:'reminder.due',text:r.notification||'Time to '+r.text,reminder:r.id,started:Date.parse(r.due_at)});scheduleSync();},openOverview:async note=>{await loadVaults();tab(true);await workspace.open(note.path,note.vault);}});
function showPersonality(it,m,animate=true){
 if(m.personalityPending&&!m.personality){
   setStatus(it,'This earlier reply was interrupted.');
   if(m.webContext){
     const retry=el('button','Finish Capri’s reply');it.append(retry);
     retry.onclick=async()=>{if(busy)return;lockChat(true);try{
       const r=await personalityCall({...m.webContext,settings:core.get(),sprite:true});m.personalityPending=false;
       Object.assign(m,{text:r.answer,blocks:r.blocks,personality:r.answer,edited:Date.now(),expression:r.expression,personalityResearch:r.personalityResearch,usage:addUsage(m.usage,r.usage),sources:[...(m.sources||[]),...(r.sources||[])]});
       retry.remove();showPersonality(it,m);showUsage(it,m.usage);await persistChat();
     }catch(e){err(e.message)}finally{lockChat(false)}};
   }
   return;
 }
 setExpression(m.expression);
 renderBlocks(it,m);
 it.querySelector('.personality-research')?.remove();

 if(m.citationWarning){const w=el('small','An unrecognized source marker was removed.');w.className='cite-warn';it.append(w);}
}
function webPanel(it,m){
 it.querySelector('.web-panel')?.remove();if(!m.web&&!m.webRequest)return;const panel=el('div');panel.className='web-panel';
 if(m.web){const d=el('details');d.append(el('summary','Web research'));const content=el('div');md(content,m.web.answer);d.append(content);for(const source of m.web.sources){const a=el('a',source.title);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';d.append(a,el('br'));}if(m.web.entryPoint){const frame=el('iframe');frame.title='Google Search suggestions';frame.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');frame.srcdoc=m.web.entryPoint;frame.style.cssText='width:100%;height:120px;border:0';d.append(frame)}panel.append(d)}
 if(m.webRequest&&m.webContext){panel.append(el('p',m.webRequest.question),el('small','Public search: '+m.webRequest.query));const yes=el('button','Search the web'),no=el('button','Not now');panel.append(yes,no);no.onclick=async()=>{m.webRequest=null;webPanel(it,m);await persistChat()};yes.onclick=async()=>{if(busy)return;lockChat(true);chatController=new AbortController();yes.disabled=true;try{const styled=await personalityCall({...m.webContext,settings:core.get(),approvedWebQuery:m.webRequest.query},chatController.signal);m.edited=Date.now();m.text=styled.answer;m.blocks=styled.blocks;m.expression=styled.expression;delete m.personality;m.personalityResearch=styled.personalityResearch;m.citationWarning=styled.citationWarning;m.web=styled.web;m.webRequest=null;m.usage=addUsage(m.usage,styled.usage);m.sources=[...(m.sources||[]).filter(s=>!s.id.startsWith('P')),...(styled.sources||[])];it.querySelectorAll('.refs,.personality-toggle,.cite-warn').forEach(n=>n.remove());refs(it,m.sources);showPersonality(it,m);webPanel(it,m);showUsage(it,m.usage);history=conversationMemory(currentChat.messages);await persistChat()}catch(e){err(e.message);yes.disabled=false}finally{chatController=null;lockChat(false)}};}(it.querySelector('.message-menu')||it).append(panel);
}
async function personalityCall(body,signal=workController.signal){body={...body,settings:body.settings??core.get()};const r=await fetch('/api/personality',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify(body),signal});return readChatStream(r,e=>{if(e.stage==='model-output')err(e.message);if(e.stage==='web-search')terminals.open({id:'web-search',kind:'retrieval',title:'PUBLIC WEB',text:e.query,state:'reading'});if(e.stage==='personality-scan'){setExpression('focused_analysis');}if(e.stage==='quota-wait'){const it=$('msgs').querySelector('[data-pending]');if(it)setStatus(it,e.message);}});}
const workspace=mountWorkspace($("notes"),{api,ask,confirm:confirmAction,model:()=>$("model").value});
const quick=mountQuick($('quick'),{api,confirm:confirmAction,voice:()=>{const s=core.get();return s?.enabled?s.prompts.personality:null;},move:(path,vault,version)=>workspace.move(path,vault,version),open:async(path,vault)=>{tab(true);await workspace.open(path,vault);}});
async function api(p,b){const r=await fetch('/api/'+p,{signal:['capture','reminder-overview'].includes(p)?AbortSignal.any([workController.signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000),method:b?'POST':'GET',headers:b?{'Content-Type':'application/json'}:{},body:b?JSON.stringify(b):undefined});const d=await r.json().catch(()=>({}));if(r.status===401){signedIn=false;$('login').showModal()}if(!r.ok)throw Object.assign(new Error(d.error||'Request failed.'),{status:r.status});return d}
async function chat(body,on){
 const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify(body),signal:chatController?.signal});
 if(r.status===401){signedIn=false;$('login').showModal()}
 if(!r.ok||!r.headers.get('content-type')?.includes('ndjson')){const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||'Request failed.'),{status:r.status});return d}
 const rd=r.body.getReader(),dec=new TextDecoder();let buf='',res;
 const eat=l=>{if(!l.trim())return;const e=JSON.parse(l);if(e.type==='error')throw Object.assign(new Error(e.error),{status:e.status});if(e.type==='progress')on(e);if(e.type==='result')res=e};
 for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){eat(buf.slice(0,i));buf=buf.slice(i+1)}}
 eat(buf);if(!res)throw new Error('Connection ended before Capri finished.');return res}
function setStatus(it,text){const n=it.querySelector('.md');n.replaceChildren(...Array.from({length:3},()=>el('i')));n.classList.add('status');n.setAttribute('aria-label',text||'Capri is typing');n.title=text||'Capri is typing';}
function md(root,text){root.classList.remove('status');root.removeAttribute('aria-label');renderMarkdown(root,spokenText(text),{citations:false,notes:workspace.notes,onLink:(link)=>{if(link.resolved){tab(true);workspace.open(link.resolved)}}});}
let renderingHistory=false;
function renderBlocks(it,m){
 const view=reminderPresentation(m);
 const blocks=(m.event==='reminder.due'?[view.text]:m.blocks?.length?m.blocks:splitReply(m.personality||m.text)).map(t=>t.replace(/^\s*\[sprite:[^\]]*\]\s*/i,''));md(it.querySelector('.md'),blocks[0]||'');
 const group=it.dataset.message=m.id||'';
 for(const sibling of [...$('msgs').querySelectorAll('.block-followup')])if(sibling.dataset.parent===group)sibling.remove();
 let last=it;for(const text of blocks.slice(1)){const extra=el('article');extra.className='m model block-followup';extra.style.animationDelay=(Math.min(blocks.indexOf(text),8)*180)+'ms';extra.style.animationFillMode='backwards';extra.dataset.parent=group;const body=el('div');body.className='md';md(body,text);extra.append(body);messageTools(extra,m);last.after(extra);last=extra;}
 messageTools(it,m);it.querySelector('.note-chip')?.remove();
 const note=m.note||(m.captureJob&&currentChat?.messages.find(x=>x.note?.id===m.captureJob)?.note);
 if(note){const button=el('button',m.reminder||m.event==='reminder.due'?'♧':'▤');button.setAttribute('aria-label',m.reminder?'Open reminder note':'Open note');button.className='note-chip';button.innerHTML=m.reminder||m.event==='reminder.due'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/></svg>';button.onclick=async()=>{await loadVaults();tab(true);await workspace.open(note.path,note.vault);};(it.querySelector('.message-menu')||it).append(button);}
 else if(m.captureJob){const chip=el('button','▤');chip.setAttribute('aria-label','Note status');chip.className='note-chip';chip.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/></svg>';chip.onclick=()=>captureStatus(m.captureJob);it.append(chip);}
}
async function captureStatus(id){try{const {note}=await api('quick-status?id='+encodeURIComponent(id));if(note.status==='filed'){await loadVaults();tab(true);await workspace.open(note.path,note.vault);return;}const d=el('dialog'),close=el('button','Close');d.append(el('h3','Quick note · '+note.status),el('p',note.error||'Your original is saved. Filing continues in the background.'));close.onclick=()=>d.close();if(note.status==='failed'){const retry=el('button','Retry filing');retry.onclick=async()=>{retry.disabled=true;try{await api('quick-retry',{id});void api('quick-kick',{}).then(scheduleSync).catch(e=>err(e.message));d.close();}catch(e){retry.disabled=false;err(e.message);}};d.append(retry);}d.append(close);d.onclose=()=>d.remove();document.body.append(d);d.showModal();}catch(e){err(e.message);}}
// ---- messages, references (collapsed), citation highlight
function msg(role,text){const it=el('article');it.className='m '+role;const w=el('div','YOU');if(role!=='user')w.textContent='Capri';w.className='who';const b=el('div');b.className='md';if(role==='user')b.textContent=text;else b.textContent=text;it.append(w,b);$('msgs').append(it);$('welcome').hidden=true;if(!renderingHistory)$('scroll').scrollTop=1e9;return it}
function refs(it,src){if(!src.length)return;const d=el('details');d.className='refs';d.append(el('summary','References ('+src.length+')'));
 for(const x of src){const e=el('details');e.className='src';e.dataset.s=x.id;e.dataset.path=x.path;e.dataset.vault=x.vault||'';const p=el('div');p.className='ex';p.dataset.t=x.excerpt;
 renderMarkdown(p,x.excerpt,{path:x.path,notes:workspace.notes,onLink:async link=>{tab(true);const v=[...document.querySelector('#nv').options].find(o=>o.textContent===x.vault);await workspace.openReference(link,x.path,v?.value);}});
 const sm=el('small',(x.vault?x.vault+' / ':'')+x.path.replace(/\.md$/i,'')),open=el('button','Open note ↗');open.className='open-source';open.onclick=()=>openSource(x.path,x.vault);
 if(x.snapshotCapturedAt)sm.append(' · Earlier snapshot: '+new Date(x.snapshotCapturedAt).toLocaleString());
 e.append(el('summary','['+x.id+'] '+x.title),sm,p,open);d.append(e)}(it.querySelector('.message-menu')||it).append(d)}
async function openSource(path,vaultName){tab(true);const opts=[...document.querySelector('#nv').options],v=opts.find(o=>o.textContent===vaultName);await workspace.open(path,v?.value);}
const hl=highlightClaim;
$('msgs').onclick=e=>{const b=e.target.closest('.c');if(!b)return;const bubble=b.closest('.m'),it=bubble.classList.contains('block-followup')?[...$('msgs').querySelectorAll('[data-message]')].find(n=>n.dataset.message===bubble.dataset.parent):bubble,src=it?.querySelector('.src[data-s="'+b.dataset.s+'"]');if(!src)return;
 src.closest('.refs').open=true;it.querySelectorAll('.src').forEach(x=>x.open=x===src);it.querySelectorAll('.c').forEach(x=>x.classList.toggle('on',x===b));
 const mk=hl(src.querySelector('.ex'),b.dataset.claim);src.querySelector('.warn')?.remove();
 const lg=s=>new Set((s.match(/\b(and|or)\b/gi)||[]).map(x=>x.toLowerCase())),c=lg(b.dataset.claim),g=lg([...src.querySelectorAll('mark')].map(m=>m.textContent).join(' '));
 if(c.size&&g.size&&![...c].some(x=>g.has(x))){const w=el('div','Check: the answer says “'+[...c].join('/')+'” but this passage says “'+[...g].join('/')+'”.');w.className='warn';src.querySelector('small').after(w)}
 lit(src.dataset.vault,src.dataset.path);(mk||src).scrollIntoView({block:'center',behavior:'smooth'})};
// ---- PATH sidebar: vault -> folder -> note, with a search log and the state of every note
const trail=$('trail'),nodes=new Map(),dirs=new Map(),boxes=new Map(),slog=el('div');let order=0;slog.id='slog';$('cur').after(slog);
const key=(v,p)=>(v||'')+'\u0000'+p;
function box(v){let b=boxes.get(v);if(!b){const w=el('div'),h=el('div',v||'Vault');h.className='vn';b=el('div');b.head=h;w.append(h,b);trail.append(w);boxes.set(v,b)}return b}
function dir(v,path){if(!path)return box(v);const k=key(v,path);if(dirs.has(k))return dirs.get(k);const i=path.lastIndexOf('/'),par=dir(v,i<0?'':path.slice(0,i)),f=el('div'),h=el('div',path.slice(i+1)),kids=el('div');h.className='fh';kids.className='fk';kids.head=h;f.append(h,kids);par.append(f);dirs.set(k,kids);return kids}
function file(n){const k=key(n.vault,n.path);let d=nodes.get(k);
 if(d){d.hits++;d.classList.remove('hot');void d.offsetWidth;d.classList.add('hot');d.lastChild.textContent='matched ×'+d.hits;return}
 const i=n.path.lastIndexOf('/'),parent=dir(n.vault,i<0?'':n.path.slice(0,i));
 d=el('div');d.className='fi hot';d.hits=1;d.title=n.title;d.append(el('span',n.path.slice(i+1).replace(/\.md$/i,'')),el('b','matched'));parent.append(d);nodes.set(k,d);
 for(let p=parent;p&&p!==trail;p=p.parentElement)p.head?.classList.add('used');d.scrollIntoView({block:'nearest',behavior:'smooth'})}
function scope(ev){$('cur').textContent=ev.reason||ev.intent;for(const v of ev.vaults){const b=box(v.name);b.head.classList.toggle('skip',v.state!=='search');b.head.dataset.s=v.state==='search'?'searching':v.state==='skip'?'skipped':'not searchable';for(const f of v.folders)dir(v.name,f).head.classList.add('dim')}}
// After the answer: each note ends as cited, read-but-not-cited, or not read (over the context budget).
function markUsed(src){terminals.finish(src);
 const best=new Map();
 for(const s of src){const rank=s.cited?3:s.read?2:1,k=key(s.vault,s.path),cur=best.get(k);if(!cur||rank>cur.rank)best.set(k,{rank,id:s.id})}
 for(const [k,b] of best){const d=nodes.get(k);if(!d)continue;d.classList.remove('hot','rd','ct');
  if(b.rank===3){d.classList.add('ct');d.lastChild.textContent='cited ['+b.id+']'}
  else if(b.rank===2){d.classList.add('rd');d.lastChild.textContent='read, not cited'}
  else d.lastChild.textContent='not read (over budget)'}}
const cool=()=>trail.querySelectorAll('.hot').forEach(n=>n.classList.remove('hot'));
function lit(v,path){nodes.forEach(n=>n.classList.remove('lit','hot'));const n=nodes.get(key(v,path));if(n){n.classList.add('lit');n.scrollIntoView({block:'nearest',behavior:'smooth'})}}
function onProgress(it,ev){
 if(ev.stage==='evidence'){terminals.read(ev.notes||[]);return;}
 if(ev.stage==='results')for(const n of ev.notes||[])terminals.open({id:'note:'+n.vault+':'+n.path,kind:'retrieval',title:n.path,text:n.excerpt||'Matched passage · reading…',state:'reading'});
 if(ev.stage==='searching')terminals.open({id:'retrieval',kind:'retrieval',title:'RETRIEVAL',text:'Searching '+ev.vault+'\n'+(ev.sent||''),state:'reading'});
 if(ev.stage==='quota-wait'){setStatus(it,ev.message);return;}if(ev.stage==='usage'){showUsage(it,ev.usage);return;}
 if(ev.stage==='search'){cool()}
 else if(ev.stage==='scope')scope(ev);
 else if(ev.stage==='searching'){$('cur').textContent='⌕ '+ev.vault;slog.append(el('div',(slog.children.length+1)+'. '+ev.vault+' · '+ev.sent))}
 else if(ev.stage==='results'){if(slog.lastChild)slog.lastChild.textContent+=' → '+ev.notes.length+(ev.notes.length===1?' passage':' passages');for(const n of ev.notes)file(n)}
 else if(ev.stage==='routing'||ev.stage==='planning'||ev.stage==='answering'||ev.stage==='verifying'){setStatus(it,ev.message);if(ev.stage==='answering'){cool();$('cur').textContent='composing answer'}}
 else if(false&&ev.stage==='thought-summary'){let t=it.querySelector('.th');if(!t){t=el('details');t.className='th';t.append(el('summary','Thinking'),el('div'));it.querySelector('.who').after(t)}t.lastChild.append(ev.text)}}
function showUsage(it,usage){if(!usage)return;it.dataset.tokens=String(usage.totalTokenCount||0);const n=it.querySelector('.message-tokens');if(n){n.textContent=`${usage.estimated?'≈ ':''}Input ${usage.promptTokenCount??'—'} · Output ${usage.candidatesTokenCount??'—'} · Total ${usage.totalTokenCount||0}`;n.title=usageTitle(usage);}const menu=it.querySelector('.message-menu');if(menu){menu.querySelector('.token-breakdown')?.remove();const d=el('details');d.className='token-breakdown';d.append(el('summary','Token details'),el('pre',usageDetails(usage)));menu.append(d);}}
let replyTarget=null;
async function completeReminderUI(id){
 for(const m of currentChat?.messages||[])if(reminderId(m)===id){m.reminderCompleted=true;m.edited=Date.now();const node=[...$('msgs').children].find(n=>n.dataset.message===m.id);if(node)messageTools(node,m);}
 const registration=await navigator.serviceWorker?.getRegistration();for(const notice of await registration?.getNotifications({tag:id+'/opening'})||[])notice.close();await persistChat();
}
function messageTools(it,m){
 it.querySelector('.reminder-done')?.remove();const rid=reminderId(m);if(rid){const done=el('button',m.reminderCompleted?'Done':'Mark done');done.className='reminder-done';done.disabled=!!m.reminderCompleted;done.onclick=async()=>{done.disabled=true;try{await agenda.complete(rid);}catch(e){done.disabled=false;err(e.message);}};it.append(done);}
 it.dataset.message=m.id;const metadata=[...it.querySelectorAll('.refs,.web-panel,.note-chip')];it.querySelector('.message-menu')?.remove();
 it.querySelector('.message-reply')?.remove();
 const menu=el('details'),toggle=el('summary','•••');menu.className='message-menu';toggle.setAttribute('aria-label','Message options');
 const date=el('time',new Date(m.sentAt||m.started).toLocaleString(undefined,{month:'long',day:'numeric',hour:'numeric',minute:'2-digit'}));
 menu.append(toggle,date);
 if(m.role==='model'){const count=el('span',m.usage||it.dataset.tokens?String(m.usage?.totalTokenCount||it.dataset.tokens):'No token usage recorded for this bubble');count.className='message-tokens';const reply=el('button','↩');reply.type='button';reply.className='message-reply';reply.setAttribute('aria-label','Reply');reply.title='Reply';reply.onclick=()=>{replyTarget={id:m.id,text:(it.querySelector('.md')?.textContent||m.text).slice(0,1000)};const preview=$('reply-preview');preview.hidden=false;preview.firstChild.textContent=replyTarget.text;menu.open=false;$('q').focus();};menu.append(count);it.append(reply);}
 menu.addEventListener('toggle',()=>{if(menu.open){for(const other of $('msgs').querySelectorAll('.message-menu[open]'))if(other!==menu)other.open=false;const bounds=$('scroll').getBoundingClientRect(),parent=it.getBoundingClientRect();menu.style.maxHeight=Math.max(80,bounds.height-16)+'px';menu.style.top='0px';const height=menu.getBoundingClientRect().height;menu.style.top=Math.max(bounds.top+8-parent.top,Math.min(0,bounds.bottom-8-parent.top-height))+'px';}},true);
 menu.append(...metadata);it.append(menu);
 if(m.reminder||m.event==='reminder.due'){const d=el('details');d.className='reminder-details';d.append(el('summary','Reminder details'),el('p',reminderPresentation(m).details||m.reminder?.text||'Saved reminder'));menu.append(d);}
 showUsage(it,m.usage);
 if(m.replyTo&&!it.querySelector('.reply-quote')){const quote=el('blockquote',m.replyTo.text);quote.className='reply-quote';it.prepend(quote);}
}
const replyPreview=el('div'),replyCancel=el('button','×');replyPreview.id='reply-preview';replyPreview.hidden=true;replyCancel.type='button';replyCancel.setAttribute('aria-label','Cancel reply');replyCancel.onclick=()=>{replyTarget=null;replyPreview.hidden=true;};replyPreview.append(el('span'),replyCancel);$('f').before(replyPreview);
document.addEventListener('click',e=>{if(!e.target.closest('.message-menu'))$('msgs').querySelectorAll('.message-menu[open]').forEach(n=>n.open=false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('msgs').querySelectorAll('.message-menu[open]').forEach(n=>n.open=false);});

function estimateDraft(){if(busy)return;const n=$('token-count');n.textContent='≈ input '+String(estimateQuestion($('q').value.trim()||(files.length?'Read the text in this attachment and help me with it.':''),history,files));n.title='Estimated tokens for question, conversation history and attachments. Attachments use a rough allowance of 4096 tokens each.';n.setAttribute('aria-label',n.title);}
$('q').addEventListener('input',estimateDraft);
// ---- ui
const err=m=>{$('err').textContent=m;$('err').hidden=!m};
function reset(){clearScan();setExpression('neutral_attention');showWelcome();history=[];$('msgs').replaceChildren();$('welcome').hidden=false;err('');nodes.clear();dirs.clear();boxes.clear();slog.replaceChildren();order=0;trail.replaceChildren();$('cur').textContent='';estimateDraft()}
const GEM='<svg viewBox="0 0 24 24"><path d="M12 2c.5 5.5 4.5 9.5 10 10-5.5.5-9.5 4.5-10 10-.5-5.5-4.5-9.5-10-10 5.5-.5 9.5-4.5 10-10z"/></svg>',DS='<svg viewBox="0 0 24 24"><path d="M2 14c0-4 4-8 10-8 4 0 7 2 8 5l2-2-.5 6c-1 3-5 5-10 5-5 0-9.5-2-9.5-6z"/><circle cx="9" cy="12" r=".8"/></svg>';
function buildModels(){const p=$('pm');p.replaceChildren();const g=el('div');g.className='pg';g.innerHTML=GEM+'GEMINI';p.append(g);
 for(const m of cfg.models){const b=el('button',m.name);b.type='button';b.className='po'+(m.id===$('model').value?' on':'');b.dataset.id=m.id;b.append(el('small',m.rpm+'/min · '+m.rpd+'/day'));p.append(b)}
 const d=el('div');d.className='pg off';d.innerHTML=DS+'DEEPSEEK · OFF';p.append(d)}
function upd(){const m=cfg?.models.find(m=>m.id===$('model').value);$('mp').title=m?.name||'';}
function bootFailure(error,retry){
 $('capri-loading').hidden=false;$('loading-status').textContent='Could not finish syncing: '+error.message;
 const button=$('loading-retry');button.hidden=false;button.onclick=()=>{button.hidden=true;retry();};
}
async function acct(email){
 booting=true;clearTimeout(syncTimer);$('capri-loading').hidden=false;$('loading-status').textContent='Syncing your conversations…';$('loading-retry').hidden=true;
 try{
 syncInbox=[];timeline.clear();terminals.clear();currentChat=null;reset();tab(false);$('resume-chat').hidden=true;signedIn=true;owner=email;$('out').hidden=false;if($('login').open)$('login').close();
 await restoreChats();booting=false;$('capri-loading').hidden=true;
 void Promise.allSettled([core.load(),loadVaults(),syncHistory(true),agenda.check(false)]).then(()=>{quick.init(owner);loadWelcome(owner);scheduleSync();});

 }catch(e){bootFailure(e,()=>acct(email));}
}

async function loadVaults(){try{const{vaults}=await api('vaults');const v=$('vault');v.replaceChildren(new Option('All vaults','all'));for(const x of vaults)v.append(new Option(x.name,x.id));await workspace.init(vaults,owner);}catch(e){err(e.message)}}
function setMode(v){$('mode').value=v;$('mc').classList.toggle('on',v==='general');$('mv').classList.toggle('on',v==='vault');$('vault').hidden=v!=='vault';if(currentChat){currentChat.mode=v;persistChat();}}
$('mc').onclick=()=>!busy&&setMode('general');$('mv').onclick=()=>!busy&&setMode('vault');
$('mp').onclick=()=>{if(cfg)$('pm').hidden=!$('pm').hidden};
$('pm').onclick=e=>{const b=e.target.closest('.po');if(!b)return;$('model').value=b.dataset.id;buildModels();upd();$('pm').hidden=true};
document.addEventListener('click',e=>{if(!e.target.closest('.pick'))$('pm').hidden=true});

$('skip').onclick=()=>$('login').close();
$('lf').onsubmit=async e=>{e.preventDefault();$('lb').disabled=true;$('le').textContent='';try{await acct((await api('login',{email:$('email').value,password:$('pw').value,remember:$('remember-device').checked})).email);$('pw').value=''}catch(x){$('le').textContent=x.message}finally{$('lb').disabled=false}};
$('out').onclick=async()=>{try{await api('logout',{});signedIn=false;syncInbox=[];agenda.clear();timeline.clear();terminals.clear();welcomeLines=[];reset();workspace.clear();quick.clear();owner='';core.clear();currentChat=null;$('chat-history').replaceChildren();$('out').hidden=true;$('login').showModal()}catch(x){err(x.message)}};
$('q').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('f').requestSubmit()}};

function blankChat(){return {id:crypto.randomUUID(),title:'New conversation',updated:Date.now(),messages:[],mode:$('mode').value,vault:$('vault').value||'all',model:$('model').value,pending:null};}
async function refreshHistory(){$('older-messages').hidden=!timeline.hasMore;}
const closeHist=()=>{};
async function openChat(){tab(false);}
async function persistChat(){if(!owner||!currentChat)return;currentChat.updated=Date.now();await timeline.save(currentChat);scheduleSync();await refreshHistory();}
function displayChat(c){const wasNearBottom=$('scroll').scrollHeight-$('scroll').scrollTop-$('scroll').clientHeight<100,oldTop=$('scroll').scrollTop;renderingHistory=true;reset();currentChat=c;$('mode').value='general';$('mc').classList.toggle('on',c.mode!=='vault');$('mv').classList.toggle('on',c.mode==='vault');$('vault').hidden=true;$('vault').value=c.vault||'all';if(cfg.models.some(m=>m.id===c.model))$('model').value=c.model;buildModels();upd();
 for(const m of c.messages){const it=msg(m.role,m.text);messageTools(it,m);if(m.role==='model'){md(it.querySelector('.md'),m.text);refs(it,m.sources||[]);showUsage(it,m.usage);showPersonality(it,m,false);webPanel(it,m);}}
 renderingHistory=false;if(wasNearBottom)$('scroll').scrollTop=1e9;else $('scroll').scrollTop=oldTop;
 history=conversationMemory(c.messages);$('resume-chat').hidden=!(c.pending||c.capture);$('resume-chat').textContent='Resume reply';estimateDraft();
}
let syncTimer,syncRunning=false,syncInbox=[];
function scheduleSync(){if(booting)return;clearTimeout(syncTimer);syncTimer=setTimeout(syncHistory,400);}
async function syncHistory(manual=false){
 while(manual&&syncRunning)await new Promise(resolve=>setTimeout(resolve,50));
 const account=owner;if(!account||!signedIn||syncRunning||(!manual&&document.hidden))return;
 syncRunning=true;const active=()=>account===owner&&signedIn;
 try{
   const incoming=await timeline.sync();
   if(active()&&currentChat&&incoming.length){
    const knownIds=new Set(currentChat.messages.map(m=>m.id));for(const message of incoming)if(!knownIds.has(message.id))notifications.notify(message);
    if(busy){const known=new Set(currentChat.messages.map(m=>m.id));currentChat.messages=mergeMessages(currentChat.messages,incoming);for(const m of incoming)if(!known.has(m.id)){const item=msg(m.role,m.text);if(m.role==='model'){renderBlocks(item,m);refs(item,m.sources||[]);}}}
    else{syncInbox.push(...incoming);applySyncInbox();}
   }
   if(active())$('sync-status').textContent='';
 }catch(e){if(active())$('sync-status').textContent='Chat sync pending · '+e.message;if(manual)throw e;}
 finally{syncRunning=false;if(active())await refreshHistory();}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleSync()});
window.addEventListener('online',scheduleSync);
navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='capri:notification'){tab(false);scheduleSync();}});
setInterval(()=>{if(!$('chat').hidden)scheduleSync()},30000);
async function restoreChats(){void notifications.restore();const restored=await timeline.load();if(!restored)return;displayChat({...blankChat(),...restored});$('scroll').scrollTop=1e9;await refreshHistory();}
let loadingOlder=false;
async function loadOlder(){if(loadingOlder||!timeline.hasMore||busy)return;loadingOlder=true;$('older-messages').disabled=true;const account=owner;try{const height=$('scroll').scrollHeight,top=$('scroll').scrollTop;const older=await timeline.older();if(account!==owner)return;displayChat({...currentChat,messages:mergeMessages(older,currentChat.messages)});$('scroll').scrollTop=top+$('scroll').scrollHeight-height;await refreshHistory();}catch(e){err('Could not load older messages: '+e.message);}finally{loadingOlder=false;$('older-messages').disabled=false;}}
$('older-messages').onclick=loadOlder;$('scroll').addEventListener('scroll',()=>{if($('scroll').scrollTop<70)void loadOlder();},{passive:true});

$('new-chat').onclick=()=>{if(busy)return;reset();currentChat=null;$('resume-chat').hidden=true;refreshHistory();closeHist();$('q').focus()};
$('resume-chat').onclick=()=>{if(currentChat?.pending){delete currentChat.pending.retryAt;currentChat.pending.retryCount=0;}if(!busy&&currentChat?.capture)runCapture();else if(!busy&&currentChat?.pending)runPending();};
function applySyncInbox(){
 if(!currentChat||!syncInbox.length)return;
 const old=new Map(currentChat.messages.map(m=>[m.id,m])),merged=mergeMessages(currentChat.messages,syncInbox);syncInbox=[];currentChat.messages=merged;
 for(const m of merged){const previous=old.get(m.id);if(previous&&JSON.stringify({...previous,seq:0})===JSON.stringify({...m,seq:0}))continue;
 let node=[...$('msgs').children].find(n=>n.dataset.message===m.id&&!n.classList.contains('block-followup'));
 if(node){if(m.role==='model'){showPersonality(node,m);showUsage(node,m.usage);}else{node.querySelector('.md').textContent=m.text;messageTools(node,m);}}
 else{node=msg(m.role,m.text);messageTools(node,m);if(m.role==='model'){showPersonality(node,m);refs(node,m.sources||[]);}}
 }
 history=conversationMemory(merged);
}

function lockChat(value){busy=value;for(const id of ['mc','mv','mp','concise','new-chat','vault','aria-settings','overclock'])$(id).disabled=value;$('resume-chat').hidden=value||!(currentChat?.pending||currentChat?.capture);$('pause-chat').hidden=false;if(!value){applySyncInbox();scheduleSync();}}
function refreshPendingSettings(){
 const pending=currentChat?.pending;if(!pending)return;
 pending.body.settings=core.get();delete pending.continuation;delete pending.decision;delete pending.report;delete pending.retryAt;pending.retryCount=0;void persistChat();
}
async function hardStop(){
 if(hardStopping)return;hardStopping=true;$('pause-chat').disabled=true;
 workEpoch++;workController.abort();chatController?.abort();
 if(currentChat){currentChat.stopped=true;if(currentChat.pending)currentChat.pending.cancelled=true;currentChat.pending=null;delete currentChat.capture;delete currentChat.delivery;delete currentChat.delayed;delete currentChat.activeBatch;currentChat.inputQueue=[];}
 $('msgs').querySelectorAll('[data-pending],[data-delivery]').forEach(node=>node.remove());stopFlight();cool();$('resume-chat').hidden=true;
 err('Stopping pending replies…');
 try{await api('stop',{});err('Stopped pending chat work on this server. Queued replies cleared.');}catch(error){err('Local replies stopped. Server cancellation could not be confirmed: '+error.message);}
 try{await persistChat();}finally{hardStopping=false;$('pause-chat').disabled=false;}
}
$('pause-chat').onclick=()=>void hardStop();
async function runCapture(){
 const capture=currentChat.capture,account=owner,epoch=workEpoch;
 const intent=captureIntent(capture.message),terminal=terminals.open({id:capture.key,kind:intent.kind,title:intent.kind==='note'?'QUICK NOTE / COMPOSING':'REMINDER / SETTING TIME',text:intent.text,time:capture.due,state:'reading'});
 lockChat(true);try{const data=await api('capture',capture);if(owner!==account)return;
 const styled=await styleAction(capture.message,data.answer);if(epoch!==workEpoch)return;data.answer=styled.answer;data.blocks=styled.blocks;
 const answer={id:crypto.randomUUID(),turn:capture.key,started:Date.now(),edited:Date.now(),role:'model',text:data.answer,blocks:data.blocks,usage:styled.usage,reminder:data.kind==='reminder'?{id:capture.key,text:intent.text,due:capture.due}:undefined,...(data.job?{captureJob:data.job}:{}),...(data.note?{note:data.note}:{})};
 queueReply(answer,false);delete currentChat.capture;await persistChat();
 terminal.update({state:data.kind==='note'?'queued':'saved',text:data.answer,time:capture.due});if(data.archiveWarning)err('Reminder saved. Overview sync pending: '+data.archiveWarning);
 if(data.kind==='note'){void watchNote(data.job,terminal,account);api('quick-kick',{}).then(()=>scheduleSync()).catch(e=>terminal.update({state:'queued',text:'Original saved. Filing will retry: '+e.message}));}
 }catch(e){terminal.update({state:'failed',text:e.message});err('Could not confirm saving: '+e.message+' Use Resume reply to retry safely.');}
 finally{lockChat(false);}
}
async function watchNote(id,terminal,account){
 if(!id)return;for(let attempt=0;attempt<120&&owner===account;attempt++){
  try{const {note}=await api('quick-status?id='+encodeURIComponent(id));if(owner!==account)return;
   if(note.status==='filed'){terminal.update({state:'saved',text:note.content||note.title});scheduleSync();return;}
   if(note.status==='failed'){terminal.update({state:'failed',text:note.error||'Filing failed. Your original is saved.'});return;}
   terminal.update({state:note.status==='processing'?'reading':'queued'});
  }catch(e){terminal.update({state:'queued',text:'Your note is queued. '+e.message});return;}
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
}
function queueReply(message,interruptible=true){const blocks=message.blocks?.length?message.blocks:splitReply(message.text);const messages=blocks.map((text,index)=>({...message,id:index?crypto.randomUUID():message.id,text,blocks:[text],usage:index?undefined:message.usage,deliveryInterruptible:interruptible}));if(currentChat.delivery?.messages.length)currentChat.delivery.messages.push(...messages);else currentChat.delivery={messages,due:Date.now()+bubbleDelay(blocks[0])};syncDeliveryStatus();}
async function localReply(text,extras={}){const m={id:crypto.randomUUID(),turn:currentChat.activeBatch?.at(-1)?.id||currentChat.messages.at(-1)?.id||crypto.randomUUID(),started:Date.now(),edited:Date.now(),role:'model',text,...extras};queueReply(m,false);await persistChat();}
async function styleAction(message,answer){try{return await personalityCall({action:'rewrite',message,answer,history:conversationMemory(currentChat.messages),settings:{...core.get(),memory:false,web:'off'},sprite:true,concise:true,operational:true});}catch{return {answer:answer.startsWith('Today')?'I couldn’t read back your schedule just now. Your reminders are still saved.':answer};}}
async function showTodayReminders(){const r=await api('reminder-overview',{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});terminals.open({id:'today-reminders',kind:'reminder',title:'REMINDERS / LIVE SERVER',text:r.answer,state:'read'});const styled=await styleAction('What reminders do I have today?',r.answer);await localReply(styled.answer,{blocks:styled.blocks,note:r.note,reminder:{overview:true},usage:styled.usage});}
async function runPending(){
 if(!currentChat?.pending)return;if(workController.signal.aborted)workController=new AbortController();delete currentChat.pending.retryAt;chatController=new AbortController();lockChat(true);err('');
 const pending=currentChat.pending,it=$('msgs').querySelector('[data-pending]')||msg('model','');it.dataset.pending='true';clearScan();setStatus(it,pending.continuation?'Continuing research…':'Thinking…');first=true;
 const body=pending.body,signal=AbortSignal.any([chatController.signal,workController.signal]);
 if(JSON.stringify(body.settings)!==JSON.stringify(core.get())){body.settings=core.get();delete pending.continuation;delete pending.decision;delete pending.report;}
 showUsage(it,pending.usage||{totalTokenCount:estimateQuestion(body.message,body.history,body.files),estimated:true});
 try{
   if(!pending.decision){
     // Older in-flight checkpoints already have a reasoning route.
     pending.decision=pending.continuation?{route:body.mode==='vault'?'vault':'reasoning'}:
       await personalityCall({action:'turn',message:body.message,mode:body.mode,history:body.history,
         settings:body.settings,pendingReplies:currentChat.delayed?.map(x=>x.message.text),hasAttachments:!!body.files?.length},signal);
     await persistChat();
   }
   const first=pending.decision;
   let reply=first,extraSources=[],followupCache=null,webContext=null,usage=first.usage;
   if(first.route==='agenda'){const overview=await api('reminder-overview',{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});reply={...await styleAction(body.message,overview.answer),note:overview.note,reminder:{overview:true}};usage=addUsage(first.usage,reply.usage);terminals.open({id:'today-reminders',kind:'reminder',title:'REMINDERS / LIVE SERVER',text:overview.answer,state:'read'});}
   else if(first.route!=='reply'){
     if(!['reasoning','vault'].includes(first.route))throw Error('Invalid conversation route.');
     setExpression('focused_analysis');
     if(!pending.report){
       for(;;){
         const result=await chat({...body,mode:first.route==='vault'?'vault':'general',researchTool:true,resumable:true,
           ...(pending.continuation?{continuation:pending.continuation}:{})},ev=>{
           if(ev.stage==='usage'){pending.usage=addUsage(first.usage,ev.usage);showUsage(it,pending.usage);}else onProgress(it,ev);
         });
         if(!result.continuation){pending.report=result;break;}
         pending.continuation=result.continuation;await persistChat();if(result.retryStatus)throw Object.assign(Error('The model is temporarily unavailable.'),{status:result.retryStatus});
       }
       await persistChat();
     }
     const report=pending.report;
     setStatus(it,'Preparing Capri’s response…');
     webContext={...personalityHandoff(body,report),sprite:true};
     reply=await personalityCall(webContext,signal);
     extraSources=(report.sources||[]).filter(s=>s.cited!==false);markUsed(report.sources||[]);
     followupCache=report.followupCache??null;usage=addUsage(addUsage(first.usage,report.usage),reply.usage);
   }
   signal.throwIfAborted();
   if(typeof reply.answer!=='string'||!reply.answer.trim())throw Error('Capri returned an empty reply.');
   const turn=currentChat.messages.find(m=>m.id===pending.turnId)||currentChat.messages.at(-1);
   const saved={id:crypto.randomUUID(),turn:turn.id,started:Date.now(),sentAt:Date.now(),edited:Date.now(),role:'model',
     text:reply.answer,blocks:reply.blocks,note:reply.note,reminder:reply.reminder,expression:reply.expression,sources:[...extraSources,...(reply.sources||[])],personalityResearch:reply.personalityResearch,
     citationWarning:reply.citationWarning,usage,followupCache,web:reply.web,webRequest:reply.webRequest,
     ...(reply.webRequest?{webContext}:{})};
   delete it.dataset.pending;currentChat.pending=null;
   // A casual answer composed before a follow-up is already stale. The next
   // turn sees the original user messages and all new messages in order.
   if(first.route==='reply'&&currentChat.inputQueue?.length){it.remove();await persistChat();return;}
   it.remove();queueReply(saved,first.route==='reply');cool();await persistChat();
 }catch(x){if(pending.cancelled||signal.aborted){delete pending.retryAt;if(!pending.cancelled)err('Paused by you. Use Resume reply to continue.');return;}const transient=![400,413].includes(x.status)&&x.name!=='AbortError'&&([429,502,503,504].includes(x.status)||/quota|limit|timed out|connection|fetch/i.test(x.message));pending.retryCount=(pending.retryCount||0)+1;const retrying=transient&&pending.retryCount<=5;if(retrying)pending.retryAt=Date.now()+Math.min(180000,15000*2**(pending.retryCount-1));else delete pending.retryAt;
 const text=requestErrorText(x.status,retrying);it.remove();err('');
 let failure=currentChat.messages.find(m=>m.id===pending.failureId);
 if(!failure){failure={id:crypto.randomUUID(),turn:pending.turnId,role:'model',event:'request.error',started:Date.now(),text};pending.failureId=failure.id;currentChat.messages.push(failure);const node=msg('model',text);messageTools(node,failure);}
 else{failure.text=text;failure.edited=Date.now();const node=[...$('msgs').children].find(n=>n.dataset.message===failure.id);if(node)showPersonality(node,failure);}
 await persistChat();cool();}
 finally{chatController=null;lockChat(false);$('q').focus();}
}
async function processBatch(batch){const epoch=workEpoch;let text=batch.map(x=>x.replyTo?'[Reply to Capri: '+x.replyTo.text+']\n'+x.text:x.text).join('\n\n[Next message]\n');
 lockChat(true);
 try{
 currentChat??=blankChat();const context=await timeline.context();if(epoch!==workEpoch)throw new DOMException('Stopped by you.','AbortError');history=conversationMemory(turnHistory(mergeMessages(context,currentChat.messages),batch,currentChat.inputQueue));
 const sent=batch.flatMap(x=>x.files);nodes.clear();dirs.clear();boxes.clear();slog.replaceChildren();order=0;trail.replaceChildren();$('cur').textContent='';
 currentChat.mode=$('mode').value;currentChat.vault=$('vault').value;currentChat.model=$('model').value;
 if(!sent.length&&currentChat.reminderDraft&&!captureIntent(text)){
  const due=scheduledTime(text)||scheduledTime('in '+text);if(due){currentChat.capture={...currentChat.reminderDraft,due:due.toISOString()};delete currentChat.reminderDraft;await persistChat();await runCapture();return;}
  if(/^(?:cancel|never mind|nevermind|forget it)[.!]?$/i.test(text)){delete currentChat.reminderDraft;await localReply('Okay, that reminder is cancelled.');return;}
 }
 const completion=completionIntent(text);
 if(!sent.length&&completion){const quoted=batch.at(-1)?.replyTo?.id;const reference=reminderId(currentChat.messages.find(m=>m.id===quoted))||reminderId([...currentChat.messages].reverse().find(m=>m.role==='model'&&!m.reminderCompleted));
 const {matches}=await api('reminder-resolve',{message:text,reference});if(epoch!==workEpoch)return;
 if(matches.length===1){await agenda.complete(matches[0].id);await localReply('Done — '+matches[0].text+' is checked off.');}
 else{await localReply(matches.length?'I found more than one matching reminder. Pick the one you finished in Reminders.':'Which reminder did you finish? Open Reminders and pick it, or tell me its name.');await agenda.show();}return;}
 if(!sent.length&&!captureIntent(text)&&reminderQuery(text)==='today'){await showTodayReminders();return;}
 if(!sent.length&&captureIntent(text)){
  const capture=await agenda.capture(text,batch.at(-1).id);if(epoch!==workEpoch)throw new DOMException('Stopped by you.','AbortError');
  if(capture.needsTime){currentChat.reminderDraft=capture;terminals.open({id:capture.key,kind:'reminder',title:'REMINDER / CHOOSE TIME',text:captureIntent(text).text,state:'waiting'});await localReply('When should I remind you? Nothing is scheduled yet.');if(!captureIntent(text).followup)return;}
  if(capture.cancelled){const answer='No reminder set. Tell me when you’re ready.';currentChat.messages.push({role:'model',text:answer});msg('model',answer);await persistChat();return;}
  if(!capture.needsTime){currentChat.capture=capture;await persistChat();await runCapture();}
  const followup=captureIntent(text).followup;if(!followup)return;text=followup;
 }
 if(epoch!==workEpoch)throw new DOMException('Stopped by you.','AbortError');
 const overview=[];const olderReminders=reminderQuery(text)==='older';
 const retrying=/\b(again|retry)\b/i.test(text)&&/\b(mir|age|search|do it|try)\b/i.test(text);const priorQuestion=[...history].reverse().find(m=>m.role==='user'&&!/\b(again|retry)\b/i.test(m.text))?.text;
 currentChat.pending={...(olderReminders?{decision:{route:'vault'}}:{}),turnId:batch.at(-1).id,body:{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,message:retrying&&priorQuestion?priorQuestion:text,model:$('model').value,mode:olderReminders?'vault':$('mode').value,vault:olderReminders?'all':$('vault').value||'all',history,followupCache:[...currentChat.messages].reverse().find(m=>m.role==='model')?.followupCache??null,concise:$('concise').checked,depth:$('concise').checked?'age':'mir',settings:core.get(),pendingReplies:currentChat.delayed?.map(x=>x.message.text),overview,files:sent.map(({mime,data})=>({mime,data}))}}
 await persistChat();await runPending();
 }catch(e){if(e.name!=='AbortError')err(e.message);throw e;}finally{lockChat(false);}}

let queueWorking=false,queueRetryAt=0;
async function pumpConversation(){
 if(queueWorking||hardStopping||busy||booting||!signedIn||!currentChat||currentChat.stopped||Date.now()<queueRetryAt)return;
 queueWorking=true;const account=owner;
 try{
  if(currentChat.pending?.retryAt&&currentChat.pending.retryAt<=Date.now()){delete currentChat.pending.retryAt;await runPending();return;}
  // Migrate old minute-delayed replies. New input supersedes any unseen draft.
  if(currentChat.delayed?.length){if(!currentChat.inputQueue?.length&&!currentChat.delivery){const messages=currentChat.delayed.flatMap(({message})=>(message.blocks?.length?message.blocks:splitReply(message.text)).map((text,index)=>({...message,id:index?crypto.randomUUID():message.id,text,blocks:[text]})));currentChat.delivery={messages,due:Date.now()};}delete currentChat.delayed;await persistChat();}
  while(!currentChat.stopped&&currentChat.inputQueue?.length&&!currentChat.pending&&!currentChat.capture){
   // Keep completed actions/research; only unseen casual text is superseded.
   if(currentChat.delivery){currentChat.delivery.messages=currentChat.delivery.messages.filter(m=>m.deliveryInterruptible===false);if(!currentChat.delivery.messages.length)delete currentChat.delivery;}
   syncDeliveryStatus();
   const first=currentChat.inputQueue[0],batch=[];let length=0;
   while(currentChat.inputQueue.length){const next=currentChat.inputQueue[0];if(batch.length&&(length+next.text.length+(next.replyTo?.text.length||0)+40>3800||batch.flatMap(x=>x.files).length+next.files.length>4||batch.flatMap(x=>x.files).reduce((n,f)=>n+f.data.length,0)+next.files.reduce((n,f)=>n+f.data.length,0)>3900000||captureIntent(first.text)||captureIntent(next.text)))break;batch.push(currentChat.inputQueue.shift());length+=next.text.length+(next.replyTo?.text.length||0)+40;}
   currentChat.activeBatch=batch;await persistChat();await processBatch(batch);if(owner!==account)return;delete currentChat.activeBatch;await persistChat();
  }
  if(!busy&&!currentChat.pending&&currentChat.delivery?.messages.length&&currentChat.delivery.due<=Date.now()){
   $('msgs').querySelector('[data-delivery]')?.remove();
   const message=currentChat.delivery.messages.shift();delete message.deliveryInterruptible;message.started=message.sentAt=message.edited=Date.now();currentChat.messages.push(message);const it=msg('model','');showPersonality(it,message);refs(it,message.sources||[]);webPanel(it,message);showUsage(it,message.usage);notifications.notify(message);
   if(currentChat.delivery.messages.length)currentChat.delivery.due=Date.now()+bubbleDelay(currentChat.delivery.messages[0].text);else delete currentChat.delivery;
   history=conversationMemory(currentChat.messages);await persistChat();
  }
  syncDeliveryStatus();
 }catch(e){if(e.name==='AbortError'||currentChat?.stopped)return;err(e.message);queueRetryAt=Date.now()+30000;if(owner===account&&currentChat.activeBatch&&!currentChat.pending&&!currentChat.capture){currentChat.inputQueue=[...currentChat.activeBatch,...(currentChat.inputQueue||[])];delete currentChat.activeBatch;await persistChat();}}finally{queueWorking=false;}
}
function syncDeliveryStatus(){const pending=$('msgs').querySelector('[data-pending]');let it=$('msgs').querySelector('[data-delivery]');if(currentChat?.delivery?.messages.length&&!pending){if(!it){it=msg('model','');it.dataset.delivery='true';setStatus(it,'Capri is typing');}}else it?.remove();}
setInterval(()=>void pumpConversation(),250);
$('f').onsubmit=async e=>{e.preventDefault();if(!signedIn){$('login').showModal();return;}
 if(workController.signal.aborted)workController=new AbortController();if(currentChat)currentChat.stopped=false;
 const text=$('q').value.trim()||(files.length?'Read this attachment.':'');if(!text)return;
 if(text.length+(replyTarget?.text.length||0)>3500){err('Please keep each message under 3,500 characters.');return;}
 currentChat??=blankChat();const id=crypto.randomUUID(),now=Date.now(),sent=files;files=[];renderAtt();$('q').value='';resizeComposer();
 const m={id,turn:id,started:now,edited:now,role:'user',text,replyTo:replyTarget};replyTarget=null;replyPreview.hidden=true;currentChat.messages.push(m);messageTools(msg('user',text),m);
 const queue=currentChat.inputQueue??=[];queue.push({id,text,files:sent,replyTo:m.replyTo,due:now});
 await persistChat();void pumpConversation();
};
// ---- attachments (images are shrunk to JPEG <=1600px; PDFs sent as-is; ~2.8 MB total)
let files=[];
const b64=blob=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result.split(',')[1]);r.onerror=no;r.readAsDataURL(blob)});
async function shrink(f){const bmp=await createImageBitmap(f),k=Math.min(1,1600/Math.max(bmp.width,bmp.height)),c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(bmp,0,0,c.width,c.height);return new Promise(ok=>c.toBlob(ok,'image/jpeg',.85))}
function renderAtt(){const a=$('att');a.replaceChildren();files.forEach((f,i)=>{const d=el('span');d.className='at';if(f.mime!=='application/pdf'){const im=el('img');im.src='data:'+f.mime+';base64,'+f.data;im.alt='';d.append(im)}d.append(el('span',f.name));const x=el('button','×');x.type='button';x.setAttribute('aria-label','Remove');x.onclick=()=>{files.splice(i,1);renderAtt()};d.append(x);a.append(d)});estimateDraft()}
async function addFiles(list){for(const f of list){if(files.length>=4){err('Up to 4 attachments.');break}
 try{let mime=f.type,blob=f;if(mime.startsWith('image/')){if(!['image/png','image/jpeg','image/webp'].includes(mime)||f.size>2_800_000){blob=await shrink(f);mime='image/jpeg'}}else if(mime!=='application/pdf'){err('Only images and PDFs are supported.');continue}
  const data=await b64(blob);if(files.reduce((n,x)=>n+x.data.length,0)+data.length>3.9e6){err('Attachments are too large (about 2.8 MB total).');continue}
  files.push({mime,data,name:f.name||'screenshot'});err('')}catch{err('Could not read '+(f.name||'that file')+'.')}}
 renderAtt()}
$('add').onclick=()=>$('file').click();
$('file').onchange=async e=>{await addFiles([...e.target.files]);e.target.value=''};
document.addEventListener('paste',e=>{if($('chat').hidden||$('login').open)return;const fs=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/')||f.type==='application/pdf');if(fs.length){e.preventDefault();addFiles(fs)}});
$('f').addEventListener('dragover',e=>e.preventDefault());
$('f').addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();addFiles([...e.dataTransfer.files])}});
// in-page replacement for prompt(): resolves to the text, or null if cancelled
function ask(label,val=''){return new Promise(ok=>{const d=$('ask');let v=null;$('al').textContent=label;$('av').value=val;d.onclose=()=>ok(v);$('af').onsubmit=e=>{e.preventDefault();v=$('av').value.trim()||null;d.close()};$('ac').onclick=()=>d.close();d.showModal();$('av').select()})}
function confirmAction(label,okText='Confirm'){return new Promise(ok=>{const d=$('ask');let v=false;$('al').textContent=label;$('av').hidden=true;$('ao').textContent=okText;
 d.onclose=()=>{$('av').hidden=false;$('ao').textContent='OK';ok(v)};$('af').onsubmit=e=>{e.preventDefault();v=true;d.close()};$('ac').onclick=()=>d.close();d.showModal()})}
// ---- app views; note drafts are kept independently of chat navigation.
function tab(n){stopFlight();const q=n==='quick',notes=n===true,other=q||notes;if(other)setExpression(q?'neutral_attention':'focused_analysis');else setExpression(currentChat?.messages.findLast(m=>m.role==='model')?.expression);$('ht').hidden=other;$('chat').hidden=other;$('notes').hidden=!notes;$('quick').hidden=!q;$('app').classList.toggle('nm',other);$('tc').classList.toggle('on',!other);$('tn').classList.toggle('on',notes);$('tq').classList.toggle('on',q);window.history.replaceState(null,'',location.pathname+location.search+(other?(q?'#quick':'#notes'):''));if(notes&&signedIn)workspace.refresh().catch(e=>err(e.message));if(q&&signedIn)quick.refresh();}
$('tc').onclick=()=>tab(false);$('tn').onclick=()=>tab(true);$('tq').onclick=()=>tab('quick');
try{$('concise').checked=localStorage.getItem('aria.mirage')!=='mir';}catch{$('concise').checked=true;}
$('overclock').setAttribute('aria-pressed',String(!$('concise').checked));
$('overclock').onclick=()=>{$('concise').checked=!$('concise').checked;$('concise').onchange();};
$('concise').onchange=()=>{$('overclock').setAttribute('aria-pressed',String(!$('concise').checked));try{localStorage.setItem('aria.mirage',$('concise').checked?'age':'mir');}catch{}};
const app=$('app');try{const s=localStorage.getItem('aria.history.collapsed');if(s===null?matchMedia('(max-width:860px)').matches:s==='true')app.classList.add('hc')}catch{}
$('ht').onclick=()=>{const c=app.classList.toggle('hc');try{localStorage.setItem('aria.history.collapsed',String(c))}catch{}};
$('voice').setAttribute('aria-disabled','true');
function resizeComposer(){const q=$('q');q.style.height='28px';q.style.height=Math.min(130,q.scrollHeight)+'px';q.style.overflowY=q.scrollHeight>130?'auto':'hidden';}
$('q').addEventListener('input',resizeComposer);
window.addEventListener('resize',resizeComposer);
resizeComposer();
estimateDraft();
const launchURL=new URL(location.href),openNotes=launchURL.searchParams.get('open')==='notes';launchURL.searchParams.delete('open');window.history.replaceState(null,'',launchURL.pathname+launchURL.search);
let welcomeLines=[];
function showWelcome(){
 const h=new Date().getHours();
 $('gr').textContent=welcomeLines.length?welcomeLines[Math.floor(Math.random()*welcomeLines.length)]:
   h>=5&&h<12?'Good morning.':h>=12&&h<18?'Good afternoon.':'Good evening.';
}
async function loadWelcome(account,refresh=false){
 const key='aria.welcome.'+account;
 const apply=pool=>{if(owner===account&&Array.isArray(pool?.lines)&&pool.lines.length){
   welcomeLines=pool.lines;showWelcome();try{localStorage.setItem(key,JSON.stringify(pool));}catch{}
 }};
 try{
   if(!refresh){try{apply(JSON.parse(localStorage.getItem(key)));}catch{}}
   let pool=await api('welcome');apply(pool);
   if(refresh||!pool.lines?.length||Date.parse(pool.generated_at)<Date.now()-7*86400000){
     if(owner!==account)return;
     pool=await api('welcome',{refresh,settings:core.get()});apply(pool);
   }
 }catch(e){if(refresh)throw e;}
}
showWelcome();
async function initialize(){
 try{
  cfg=await api('status');$('model').value=cfg.models[0].id;buildModels();upd();
  if(!cfg.configured||!cfg.geminiReady){$('setup').hidden=false;$('setup').textContent='Preview mode: finish Supabase and Gemini setup to enable answers.';}
  if(cfg.configured){
   try{const session=await api('session');await acct(session.email);if(!booting&&openNotes)tab(true);}
   catch(e){if(e.status!==401)throw e;booting=false;$('capri-loading').hidden=true;}
  }else{booting=false;$('capri-loading').hidden=true;}
 }catch(e){bootFailure(e,initialize);}
}
await initialize();

