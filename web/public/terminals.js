// Stacked RAG log panes for the permanent Terminals tab (replaces the old
// floating-window system). Each pane is a .log-pane[data-stage][data-state]
// from the site.css contract; brain.js toggles [data-active] while a stage
// runs, and clicking a pane opens it in the detail drawer.
const element=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function groupNotes(notes){const groups=new Map();for(const n of notes){const key=n.vault+':'+n.path,old=groups.get(key);groups.set(key,{...n,read:n.read!==false||old?.read===true,cited:n.cited||old?.cited,excerpt:[old?.excerpt,n.excerpt].filter(Boolean).join('\n\n').slice(0,18000)});}return [...groups.values()];}
const STATE_MAP={read:'done',accessed:'done',waiting:'reading',reading:'reading',skipped:'skipped',done:'done'};
export function mountTerminals(root,toggle){
 root.id='rag-logs';root.setAttribute('aria-label','Retrieval and pipeline logs');
 const panes=new Map();
 const stateOf=s=>STATE_MAP[s]||'reading';
 function open({id,kind='activity',title='ACTIVITY',text='',state='reading',time,stage}){
  let pane=panes.get(id);
  if(!pane){
   const card=element('section'),head=element('div'),label=element('strong',title),content=element('pre');
   card.className='log-pane';card.dataset.kind=kind||'activity';head.className='log-title';content.className='log-content';content.tabIndex=0;
   head.append(label);card.append(head,content);root.append(card);
   pane={card,label,content,update:update(id)};panes.set(id,pane);
  }
  if(stage!==undefined)pane.card.dataset.stage=stage;
  if(state)pane.card.dataset.state=stateOf(state);
  if(time){let clock=pane.card.querySelector('time');if(!clock){clock=element('time');pane.card.querySelector('.log-title').append(clock);}clock.dateTime=time;clock.textContent=new Date(time).toLocaleString(undefined,{hour:'2-digit',minute:'2-digit'});}
  if(typeof text==='string'&&text&&text!==pane.card.dataset.raw){pane.card.dataset.raw=text.slice(0,18000);pane.content.textContent=pane.card.dataset.raw;}
  return pane;
 }
 const update=id=>next=>open({id,title:panes.get(id)?.label.textContent,state:next.state,text:next.text,time:next.time,stage:next.stage});
 function readNotes(notes){for(const note of groupNotes(notes))open({id:'note:'+note.vault+':'+note.path,kind:'retrieval',title:note.path,text:note.excerpt,state:note.read===false?'skipped':'reading',stage:'evidence'});}
 function finish(sources){for(const source of groupNotes(sources)){const pane=panes.get('note:'+source.vault+':'+source.path);if(pane){pane.card.dataset.state=source.read===false?'skipped':'done';if(source.excerpt&&!pane.card.dataset.raw){pane.card.dataset.raw=source.excerpt.slice(0,18000);pane.content.textContent=pane.card.dataset.raw;}}}}
 // brain.js calls active(stage) while that stage runs; every other pane dims.
 function active(stage){
  for(const pane of panes.values()){
   if(stage&&pane.card.dataset.stage===stage){pane.card.dataset.active='true';if(pane.card.dataset.state==='reading')pane.card.scrollTop=pane.card.scrollHeight;}
   else if(pane.card.dataset.active)pane.card.dataset.active='false';
  }
 }
 function clear(){for(const pane of panes.values())pane.card.remove();panes.clear();}
 return {open,read:readNotes,finish,clear,active,
   activeMap:{search:'search',searching:'search',results:'search',evidence:'evidence',web:'web','web-search':'web',personality:'personality'},
   count:()=>panes.size};
}
