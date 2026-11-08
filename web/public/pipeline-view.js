// Uses persisted per-message usage.calls, so reopening a chat also restores replay.
export function pipelineView(usage){
 const root=document.createElement('details');root.className='pipeline-view';
 const title=document.createElement('summary');title.textContent='Pipeline · '+(usage.totalTokenCount||0)+' tokens';root.append(title);
 const toolbar=document.createElement('div'),play=document.createElement('button'),speed=document.createElement('select'),path=document.createElement('ol');
 play.type='button';play.textContent='Replay';speed.setAttribute('aria-label','Pipeline replay speed');
 for(const [label,value] of [['Slow · 2 seconds',2000],['Normal · 1 second',1000],['Fast · ½ second',500]]){const o=document.createElement('option');o.textContent=label;o.value=value;speed.append(o);}
 toolbar.append(play,speed);root.append(toolbar,path);path.setAttribute('aria-live','polite');
 for(const c of usage.calls||[]){const row=document.createElement('li');
  const role=['route','capri-turn'].includes(c.phase)?'CORE AI':c.role;
  row.textContent=`${role} → ${c.phase} · ${c.model} · input ${c.promptTokenCount??'?'} / output ${c.candidatesTokenCount??'?'}${c.estimated?' (estimated)':''}`;
  if(c.routing){const decision=document.createElement('div');decision.textContent='Route: '+JSON.stringify(c.routing);row.append(decision);}
  const components=document.createElement('small');components.textContent=Object.entries(c.promptEstimates||{}).map(([k,v])=>k+': '+(typeof v==='object'?JSON.stringify(v):v)).join(' · ');row.append(components);path.append(row);
 }
 let timer=null,index=0;const stop=()=>{clearTimeout(timer);timer=null;play.textContent='Replay';};
 play.onclick=()=>{if(timer){stop();return;}index=0;play.textContent='Stop replay';for(const row of path.children)row.removeAttribute('data-active');
  const step=()=>{if(!root.isConnected||!root.open||index>=path.children.length){stop();return;}for(const row of path.children)row.removeAttribute('data-active');path.children[index++].dataset.active='true';timer=setTimeout(step,Number(speed.value));};step();
 };root.addEventListener('toggle',()=>{if(!root.open)stop();});return root;
}
