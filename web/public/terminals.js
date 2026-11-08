const element=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
function groupNotes(notes){const groups=new Map();for(const n of notes){const key=n.vault+':'+n.path,old=groups.get(key);groups.set(key,{...n,read:n.read!==false||old?.read===true,cited:n.cited||old?.cited,excerpt:[old?.excerpt,n.excerpt].filter(Boolean).join('\n\n').slice(0,18000)});}return [...groups.values()];}
export function mountTerminals(root,toggle){
 const windows=new Map();let z=1,eyeTimer,dismissed=false;const reading=[];
 root.className='terminals';root.setAttribute('aria-label','Capri terminals');
 const toolbar=element('div'),title=element('strong','TERMINALS / LIVE'),hide=element('button','Hide');toolbar.className='terminal-toolbar';hide.type='button';hide.onclick=()=>{dismissed=true;show(false);};toolbar.append(title,hide);root.append(toolbar);
 const stage=element('div');stage.className='terminal-stage';root.append(stage);
 const picker=element('select');picker.setAttribute('aria-label','Focus terminal');picker.append(new Option('Focus terminal…',''));toolbar.insertBefore(picker,hide);
 picker.onchange=()=>{const entry=windows.get(picker.value);if(entry){entry.card.style.zIndex=String(++z);entry.card.classList.remove('minimized');entry.bar.focus();}};
 function refreshPicker(){const selected=picker.value;picker.replaceChildren(new Option('Focus terminal…',''));for(const [id,w] of windows)picker.add(new Option(w.title+' · '+w.state,id));picker.value=selected;}
 const eye=document.getElementById('capri-face');eye.classList.add('terminal-eye');eye.hidden=true;root.append(eye);
 function lightning(card){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),bolt=document.createElementNS(ns,'path'),branch=document.createElementNS(ns,'path'),bounds=stage.getBoundingClientRect(),from=eye.getBoundingClientRect();
  const x=eye.hidden?16:from.left-bounds.left+from.width/2,y=eye.hidden?4:from.top-bounds.top+from.height/2,tx=card.offsetLeft+card.offsetWidth/2,ty=card.offsetTop+14;
  svg.setAttribute('class','terminal-lightning');svg.setAttribute('aria-hidden','true');svg.setAttribute('viewBox',`0 0 ${stage.clientWidth} ${stage.clientHeight}`);
  const points=[[x,y]];let path=`M ${x} ${y}`;for(let i=1;i<7;i++){const t=i/7,jitter=(i%2?1:-1)*(7+Math.random()*14),px=x+(tx-x)*t+jitter,py=y+(ty-y)*t-jitter/2;points.push([px,py]);path+=` L ${px} ${py}`;}path+=` L ${tx} ${ty}`;
  bolt.setAttribute('d',path);bolt.setAttribute('pathLength','1');bolt.setAttribute('class','bolt-main');svg.append(bolt);
  if(points.length>4){const origin=points[2+Math.floor(Math.random()*2)],dx=origin[0]<tx?1:-1,len=40+Math.random()*70;let bpath=`M ${origin[0]} ${origin[1]}`;for(let i=1;i<3;i++)bpath+=` L ${origin[0]+dx*i*len/3+(Math.random()*14-7)} ${origin[1]+i*len/3}`;branch.setAttribute('d',bpath);branch.setAttribute('pathLength','1');branch.setAttribute('class','bolt-branch');svg.append(branch);}
  stage.append(svg);setTimeout(()=>svg.remove(),1100);
 }
 function focus(entry){if(!entry||entry.state==='skipped')return;const from=eye.getBoundingClientRect();eye.hidden=false;entry.bar.prepend(eye);eye.setAttribute('aria-label','Capri reading '+entry.title);entry.card.dataset.active='true';for(const w of windows.values())if(w!==entry)delete w.card.dataset.active;
  const to=eye.getBoundingClientRect();if(from.width&&to.width&&!matchMedia('(prefers-reduced-motion: reduce)').matches)eye.animate([{transform:`translate(${from.left-to.left}px,${from.top-to.top}px)`},{transform:'translate(0,0)'}],{duration:450,easing:'ease-in-out'});
 }
 function nextEye(){const entry=reading.shift();if(entry)focus(entry);eyeTimer=reading.length?setTimeout(nextEye,1000):null;}
 function readNotes(notes){clearTimeout(eyeTimer);reading.length=0;for(const note of groupNotes(notes)){const w=open({id:'note:'+note.vault+':'+note.path,kind:'retrieval',title:note.path,text:note.excerpt,state:note.read===false?'skipped':'reading'});if(note.read!==false)reading.push(w);}if(reading.length)nextEye();}
 function show(visible){document.getElementById('app').classList.toggle('terminals-open',visible);toggle.setAttribute('aria-expanded',String(visible));toggle.hidden=!windows.size;}
 toggle.onclick=()=>{const visible=!document.getElementById('app').classList.contains('terminals-open');dismissed=!visible;show(visible);};
 function open({id,kind='activity',title='Activity',text='',state='reading',time}){
  let entry=windows.get(id);if(entry){entry.update({text,state,time});return entry;}
  // Bound active visual windows. Stored notes and chat messages remain available.
  if(windows.size>=8){const old=[...windows.values()].find(w=>w.state!=='reading')||windows.values().next().value;old.close();}
  const card=element('section'),bar=element('div'),label=element('strong',title),status=element('span',state),body=element('pre'),clock=element('time');
  card.className='terminal-window';card.dataset.kind=kind;card.dataset.state=state;card.tabIndex=0;bar.className='terminal-title';bar.tabIndex=0;bar.setAttribute('aria-label',title+'; arrow keys move this terminal');body.className='terminal-content';status.className='terminal-status';clock.className='terminal-clock';
  card.style.zIndex=String(++z);card.style.animationDelay='120ms';
  card.addEventListener('pointerdown',()=>card.style.zIndex=String(++z));card.addEventListener('focusin',()=>card.style.zIndex=String(++z));
  const mini=element('button','−'),full=element('button','⛶'),close=element('button','×');
  for(const [b,name] of [[mini,'Minimize'],[full,'Expand'],[close,'Close']]){b.type='button';b.setAttribute('aria-label',name+' '+title);}
  mini.onclick=()=>{card.classList.toggle('minimized');mini.setAttribute('aria-pressed',String(card.classList.contains('minimized')));};
  full.onclick=()=>{card.classList.toggle('expanded');full.setAttribute('aria-pressed',String(card.classList.contains('expanded')));};
  bar.append(label,mini,full,close);card.append(bar,status,clock,body);stage.append(card);
  let timer,drag,content='';
  function move(x,y){card.style.left=Math.max(0,Math.min(x,stage.clientWidth-card.offsetWidth))+'px';card.style.top=Math.max(0,Math.min(y,stage.clientHeight-card.offsetHeight))+'px';}
  move(8+Math.random()*Math.max(0,stage.clientWidth-card.offsetWidth-16),8+Math.random()*Math.max(0,stage.clientHeight-card.offsetHeight-16));
  const bounds=new ResizeObserver(()=>{if(!card.classList.contains('expanded'))move(card.offsetLeft,card.offsetTop);});bounds.observe(stage);bounds.observe(card);
  bar.onpointerdown=e=>{if(e.target.closest('button')||card.classList.contains('expanded'))return;drag={x:e.clientX,y:e.clientY,left:card.offsetLeft,top:card.offsetTop};bar.setPointerCapture(e.pointerId);card.style.zIndex=String(++z);};
  bar.onpointermove=e=>{if(drag)move(drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);};bar.onpointerup=bar.onpointercancel=()=>drag=null;
  bar.onkeydown=e=>{const delta={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]}[e.key];if(delta&&e.target===bar){e.preventDefault();move(card.offsetLeft+delta[0],card.offsetTop+delta[1]);}};
  entry={state,card,bar,title,close(){clearTimeout(timer);bounds.disconnect();if(card.contains(eye)){eye.hidden=true;root.append(eye);}const queued=reading.indexOf(entry);if(queued>=0)reading.splice(queued,1);card.remove();windows.delete(id);refreshPicker();if(!windows.size){dismissed=false;show(false);}},update(next){
   if(next.state){entry.state=next.state;card.dataset.state=next.state;status.textContent=next.state;refreshPicker();}
   if(next.time){clock.dateTime=next.time;clock.textContent=new Date(next.time).toLocaleString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit',month:'short',day:'numeric'});clock.classList.add('setting');setTimeout(()=>clock.classList.remove('setting'),700);}
   if(typeof next.text==='string'&&next.text!==content){clearTimeout(timer);content=next.text.slice(0,18000);body.textContent='';let count=0;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const type=()=>{const nearBottom=body.scrollHeight-body.scrollTop-body.clientHeight<40;count=reduced?content.length:Math.min(content.length,count+Math.max(3,Math.ceil(content.length/160)));body.textContent=content.slice(0,count);if(nearBottom)body.scrollTop=body.scrollHeight;if(count<content.length)timer=setTimeout(type,count%7===0?180:22);};type();
   }
  }};close.onclick=entry.close;windows.set(id,entry);entry.update({text,state,time});refreshPicker();toggle.hidden=false;if(!dismissed)show(true);lightning(card);return entry;
 }
 return {open,show,read:readNotes,clear(){clearTimeout(eyeTimer);reading.length=0;for(const w of [...windows.values()])w.close();},finish(sources){clearTimeout(eyeTimer);reading.length=0;let active;for(const source of groupNotes(sources)){const id='note:'+source.vault+':'+source.path,w=windows.get(id);if(w){w.update({state:source.read===false?'skipped':source.cited?'accessed':'read',text:source.excerpt});if(source.read!==false)active=w;}}if(active)focus(active);}};
}
