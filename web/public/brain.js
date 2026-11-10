// BRAIN — pipeline visualizer for the permanent right-side neural panel.
// Ingests the structured event log emitted by /api/chat and /api/personality
// (NDJSON progress events with stage:'pipeline'), draws the neural map, and
// replays saved logs without ever re-calling a model.
//
// DOM contract (site.css): #brain[data-phase][data-replay], .dendrite /
// .model-node[data-state], .bolt[data-dir], .hud[data-state],
// .meter[data-stage], #brain-glitch[data-active]. The core and every node sit
// inside a plain positioning <g transform=…> so CSS transform animations on
// #brain-core / .model-node never fight the layout transform. The core is a
// pure-SVG pulsing soma (shell + rings + gradient); no image is involved.

export const STAGE_ORDER=['routing','scope','search','evidence','planning','answering','verifying','council','personality','web'];
export const STAGE_LABELS={routing:'ROUTE',scope:'SCOPE',search:'SEARCH',evidence:'EVIDENCE',planning:'PLAN',answering:'ANSWER',verifying:'VERIFY',council:'COUNCIL',personality:'PERSONA',web:'WEB',merge:'MERGE'};
export const AGENT_LABELS={core:'CORE',planner:'PLANNER',answerer:'ANSWERER',verifier:'VERIFIER',summarizer:'SUMMARIZER',council:'COUNCIL',personality:'PERSONA',web:'WEB SEARCH',retrieval:'RETRIEVAL',merger:'MERGE'};
// Pure helpers (unit-tested in Node without a DOM).
export function modelShort(id){
  let s=String(id||'').replace(/^[a-z]+:/,'').replace(/^nvidia\//,'');
  const free=s.endsWith(':free');if(free)s=s.slice(0,-5);
  if(s.length>30)s=s.slice(0,29)+'…';
  return s+(free?' (free)':'');
}
export const redact=raw=>String(raw??'')
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'‹id›')
  .replace(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g,'‹email›')
  .replace(/\b(?:\d[ -]?){12,18}\d\b/g,'‹card›')
  .replace(/\b\d{6,}\b/g,'‹#›')
  .replace(/\b[A-Za-z0-9_-]{20,}\b/g,'‹key›');
// Fixed ring slots (viewBox 1000x470, core at 500,235): no two nodes ever overlap.
export const SLOT_ANGLE=[-150,-90,-30,30,90,150].map(a=>a*Math.PI/180);
export function slotPoint(i){const R=172;return [500+Math.cos(SLOT_ANGLE[i%6])*R,235+Math.sin(SLOT_ANGLE[i%6])*R];}
// Bolt polyline with vertical jitter along the perpendicular; regenerated ~30fps.
export function boltPoints(x1,y1,x2,y2,jitter=7){
  const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1,px=-dy/len,py=dx/len,pts=[[x1,y1]];
  for(let i=1;i<9;i++){const t=i/9,w=Math.sin(t*Math.PI)*jitter*(0.4+Math.random())*(i%2?1:-1);
    pts.push([x1+dx*t+px*w,y1+dy*t+py*w]);}
  pts.push([x2,y2]);return pts;
}
export const boltWidth=tokens=>1.1+Math.min(1,(Number(tokens)||120)/500)*2.4;
// Meter aggregation from a structured log: tokens land on output/decision events.
export function aggregateMeters(log){
  const rows=new Map();
  for(const ev of log||[]){
    if(ev.tokens_in==null&&ev.tokens_out==null)continue;
    const stage=STAGE_LABELS[ev.stage]?ev.stage:'answering',row=rows.get(stage)||{tin:0,tout:0,latency:0};
    row.tin+=Number(ev.tokens_in)||0;row.tout+=Number(ev.tokens_out)||0;
    if(Number.isFinite(ev.t_start)&&Number.isFinite(ev.t_end))row.latency+=Math.max(0,ev.t_end-ev.t_start);
    rows.set(stage,row);
  }
  let tin=0,tout=0,latency=0;for(const row of rows.values()){tin+=row.tin;tout+=row.tout;latency+=row.latency;}
  return {rows:[...STAGE_ORDER,'merge'].filter(s=>rows.has(s)).map(stage=>({stage,...rows.get(stage)})),total:{tin,tout,latency}};
}
const NS='http://www.w3.org/2000/svg',svgEl=(tag,attrs={})=>{const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
const HTML_LINES=6; // HUD panes show only the last ~6 lines; JS trims (CSS clips from the top).

export function mountBrain(root,{terminals}={}){
  const $=id=>root.querySelector('#'+id);
  const brain=$('brain'),map=$('brain-map'),layer={dendrites:$('brain-dendrites'),pulses:$('brain-pulses'),nodes:$('brain-nodes'),bolts:$('brain-bolts'),sparks:$('brain-sparks')};
  const coreGroup=$('brain-core'),glitch=$('brain-glitch'),speech=root.querySelector('.core-speech');
  const nodeSpeeches=$('node-speeches'),drawer=root.querySelector('#detail-drawer'),drawerText=drawer.querySelector('.drawer-text'),drawerLabel=drawer.querySelector('header b'),drawerHint=drawer.querySelector('.drawer-hint');
  const metersBox=$('token-meters'),tt=document.getElementById('tt');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const corePoint=[500,235];
  let viewVisible=!root.hidden,paused=false,replaying=false,replayLog=null,replayIdx=0,replayTimer=null,speed=1;
  let turn=0,turnOpen=false,seq=0;
  const log=[],records=[],waves=new Map(),nodes=new Map(),slots=new Map(),meters=new Map(),bolts=[];
  let boltsRaf=0,lastBoltFrame=0,glitchRaf=0,detailRevealed=false,detailRaw='';

  const data=(el,k,v)=>{if(v===undefined)el.removeAttribute(k);else el.setAttribute(k,v);};
  const phase=p=>data(brain,'data-phase',p);
  const active=()=>viewVisible&&!document.hidden&&!(replaying&&paused);
  const trim6=pre=>{const lines=pre.textContent.split('\n');if(lines.length>HTML_LINES)pre.textContent=lines.slice(-HTML_LINES).join('\n');};

  // ---------- detail drawer ----------
  function showDetail(label,text){
    detailRaw=String(text??'');detailRevealed=false;drawerLabel.textContent=label;
    drawerHint.textContent='TAP TO '+(drawer.dataset.open==='true'?'HIDE':'EXPAND')+' · IDS MASKED';
    drawerText.textContent=redact(detailRaw);data(drawer,'data-open','true');
    drawer.querySelector('header').setAttribute('aria-expanded','true');
  }
  const drawerHead=drawer.querySelector('header');
  const toggleDrawer=()=>{const open=drawer.dataset.open!=='true';data(drawer,'data-open',open);drawerHead.setAttribute('aria-expanded',String(open));};
  drawerHead.onclick=toggleDrawer;
  drawerHead.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleDrawer();}};
  const reveal=document.createElement('button');reveal.type='button';reveal.textContent='REVEAL';reveal.className='drawer-reveal';reveal.onclick=e=>{e.stopPropagation();detailRevealed=!detailRevealed;reveal.textContent=detailRevealed?'MASK':'REVEAL';drawerText.textContent=detailRevealed?detailRaw:redact(detailRaw);};
  drawerHead.append(reveal);
  root.addEventListener('click',e=>{
    const pane=e.target.closest('.log-pane');
    if(pane&&root.contains(pane))showDetail(pane.querySelector('.log-title')?.firstChild?.textContent||'LOG',pane.dataset.raw||pane.querySelector('.log-content')?.textContent||'');
  });

  // ---------- HUD (typewriter) ----------
  function hudSet(hud,text,{state='writing'}={}){
    data(hud,'data-state',state);hud.hidden=false;
    hud.querySelector('.hud-state').textContent=state==='writing'?'STREAMING':state==='done'?'COMPLETE':'IDLE';
    const pre=hud.querySelector('pre');
    if(text!==undefined){
      const stamp=state==='writing'?text:'▸ '+text;
      pre.textContent=(pre.textContent?pre.textContent+'\n':'')+stamp;trim6(pre);
    }
  }
  function type(hud,text){ // typewriter drain into a HUD buffer
    const pre=hud.querySelector('pre'),full=(pre.dataset.buf||'')+text;pre.dataset.buf=full;
    if(reduced){pre.textContent=full.split('\n').slice(-HTML_LINES).join('\n');delete pre.dataset.buf;return;}
    if(pre.dataset.typing)return;
    pre.dataset.typing='1';
    const tick=()=>{
      if(!active()){setTimeout(tick,220);return;}
      const buf=pre.dataset.buf||'';
      if(buf){const take=Math.min(buf.length,3);pre.textContent=(pre.textContent+buf.slice(0,take)).split('\n').slice(-HTML_LINES).join('\n');pre.dataset.buf=buf.slice(take);}
      if(pre.dataset.buf){setTimeout(tick,24);}else delete pre.dataset.typing;
    };
    setTimeout(tick,24);
  }
  function hudDone(hud){data(hud,'data-state','done');hud.querySelector('.hud-state').textContent='COMPLETE';}

  // ---------- core speech ----------
  function coreSay(text,state='writing'){
    speech.hidden=false;hudSet(speech,undefined,{state});
    type(speech,redact(text)); // personal data stays masked until the drawer reveal
  }

  // ---------- dendrites + nodes ----------
  function dendritePath(slot){
    const [nx,ny]=slotPoint(slot),dx=nx-corePoint[0],dy=ny-corePoint[1],len=Math.hypot(dx,dy)||1;
    const sx=corePoint[0]+dx/len*88,sy=corePoint[1]+dy/len*88,ex=nx-dx/len*46,ey=ny-dy/len*46;
    const mx=(sx+ex)/2-dy/len*26,my=(sy+ey)/2+dx/len*26;
    const bx=sx+(ex-sx)*0.55,by=sy+(ey-sy)*0.55,tx=bx-dy/len*34,ty=by+dx/len*34;
    return {main:`M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
      twig:`M ${bx.toFixed(1)} ${by.toFixed(1)} q ${(tx-bx).toFixed(1)} ${(ty-by).toFixed(1)} ${(tx-bx+18).toFixed(1)} ${(ty-by+10).toFixed(1)}`,ex,ey};
  }
  function spawnNode(agent,model){
    const key=agent+'|'+model;
    if(nodes.has(key))return nodes.get(key);
    let slot=slots.size<6?[...Array(6).keys()].find(i=>!slots.has(i)):Math.min(...[...slots.entries()].sort((a,b)=>a[1].ts-b[1].ts).map(([s])=>s));
    if(slot===undefined)slot=0;
    const old=slots.get(slot);if(old)retireNode(old.node,true);
    const g=svgEl('g',{transform:`translate(${slotPoint(slot)[0].toFixed(1)},${slotPoint(slot)[1].toFixed(1)})`});
    const inner=svgEl('g',{class:'model-node','data-slot':slot,'data-state':'spawning',tabindex:'0',role:'button','aria-label':(AGENT_LABELS[agent]||agent)+' node'});
    const box=svgEl('rect',{class:'node-box',x:-86,y:-30,width:172,height:60,rx:2});
    const name=svgEl('text',{class:'node-name',x:0,y:-4,'text-anchor':'middle'});
    const subText=modelShort(model);
    // Long model ids are squeezed into the box (spacingAndGlyphs) instead of
    // clipping at the node edge; short names keep their natural spacing.
    const sub=svgEl('text',{class:'node-model',x:0,y:18,'text-anchor':'middle',...(subText.length>18?{textLength:158,lengthAdjust:'spacingAndGlyphs'}:{})});
    name.textContent=AGENT_LABELS[agent]||agent.toUpperCase();sub.textContent=subText;
    inner.append(box,name,sub);g.append(inner);layer.nodes.append(g);
    const den=svgEl('g',{class:'dendrite','data-slot':slot,'data-state':'growing'});
    const d=dendritePath(slot),main=svgEl('path',{class:'dendrite-main',d:d.main,pathLength:1200}),twig=svgEl('path',{class:'dendrite-twig',d:d.twig,pathLength:1200});
    den.append(main,twig);layer.dendrites.append(den);
    const hud=document.createElement('div');hud.className='hud node-speech';hud.dataset.speaker=agent;data(hud,'data-state','idle');
    hud.append(Object.assign(document.createElement('header'),{}));
    hud.querySelector('header').append(Object.assign(document.createElement('b'),{textContent:name.textContent}),Object.assign(document.createElement('span'),{className:'hud-state',textContent:'IDLE'}));
    hud.append(document.createElement('pre'),Object.assign(document.createElement('i'),{className:'cursor'}));
    hud.querySelector('pre').addEventListener('click',()=>{selectNode(inner);showDetail(name.textContent+' // '+modelShort(model),entry.full);});
    inner.addEventListener('click',()=>{selectNode(inner);showDetail(name.textContent+' // '+modelShort(model),entry.full);});
    inner.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showDetail(name.textContent+' // '+modelShort(model),entry.full);}});
    nodeSpeeches.append(hud);
    setTimeout(()=>{data(inner,'data-state','live');data(den,'data-state','live');},reduced?0:380);
    const entry={key,agent,model,slot,g,inner,den,hud,full:'',ts:Date.now()};
    nodes.set(key,entry);slots.set(slot,{node:entry,ts:Date.now()});
    return entry;
  }
  function selectNode(inner){for(const n of nodes.values())data(n.inner,'data-selected',n.inner===inner);}
  function retireNode(entry,instant=false){
    if(!nodes.has(entry.key))return;
    slots.delete(entry.slot);nodes.delete(entry.key);
    if(instant||reduced){entry.g.remove();entry.den.remove();entry.hud.remove();return;}
    data(entry.den,'data-state','retracting');data(entry.inner,'data-state','leaving');
    setTimeout(()=>{entry.g.remove();entry.den.remove();},380);
    setTimeout(()=>entry.hud.remove(),1400); // streams stay readable a moment, then fold
  }
  function retractNodes(){for(const entry of [...nodes.values()])retireNode(entry);}

  // ---------- bolts + sparks ----------
  function fireBolt(ev,dir){
    const node=nodes.get(ev.agent+'|'+ev.model);
    if(!node)return;
    const [nx,ny]=slotPoint(node.slot),from=dir==='out'?corePoint:[nx,ny],to=dir==='out'?[nx,ny]:corePoint;
    const width=boltWidth(dir==='out'?ev.tokens_in:ev.tokens_out);
    const g=svgEl('g',{class:'bolt','data-dir':dir});
    const glow=svgEl('polyline',{class:'bolt-glow','stroke-width':(width+1.6).toFixed(1)}),core=svgEl('polyline',{class:'bolt-core','stroke-width':width.toFixed(1)});
    g.append(glow,core);layer.bolts.append(g);
    const bolt={g,glow,core,from,to,born:performance.now(),life:640,dir};
    bolts.push(bolt);drawBolt(bolt);
    if(!boltsRaf)boltsRaf=requestAnimationFrame(boltFrame);
    if(dir==='in')setTimeout(()=>{data(g,'class','bolt impact');spark(corePoint[0],corePoint[1],2);},reduced?0:600);
    else if(Math.random()<0.35)spark(from[0]+(to[0]-from[0])*0.3,from[1]+(to[1]-from[1])*0.3,1);
  }
  function drawBolt(bolt){
    const pts=boltPoints(bolt.from[0],bolt.from[1],bolt.to[0],bolt.to[1],reduced?0:7);
    const d=' '+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
    bolt.glow.setAttribute('points',d.trim());bolt.core.setAttribute('points',d.trim());
  }
  function boltFrame(now){
    boltsRaf=0;
    if(!active()){if(bolts.length)boltsRaf=requestAnimationFrame(boltFrame);return;} // frozen while hidden/paused
    if(now-lastBoltFrame>=33){lastBoltFrame=now;
      for(let i=bolts.length-1;i>=0;i--){const b=bolts[i];
        if(now-b.born>b.life){b.g.remove();bolts.splice(i,1);continue;}
        if(!reduced)drawBolt(b);}
    }
    if(bolts.length)boltsRaf=requestAnimationFrame(boltFrame);
  }
  function spark(x,y,n){
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2,l=14+Math.random()*26,line=svgEl('line',{class:'spark',x1:x,y1:y,x2:x+Math.cos(a)*l,y2:y+Math.sin(a)*l});
      layer.sparks.append(line);setTimeout(()=>line.remove(),reduced?0:480);
    }
  }

  // ---------- token meters ----------
  function meterRow(stage){
    if(meters.has(stage))return meters.get(stage);
    const row=document.createElement('div');row.className='meter';row.dataset.stage=stage;
    const label=document.createElement('span');label.className='meter-label';label.textContent=STAGE_LABELS[stage]||stage.toUpperCase();
    const mi=document.createElement('span');mi.className='meter-in';mi.textContent='in 0';
    const mo=document.createElement('span');mo.className='meter-out';mo.textContent='out 0';
    const lat=document.createElement('span');lat.className='meter-latency';lat.textContent='—';
    row.append(label,mi,mo,lat);
    metersBox.insertBefore(row,metersBox.querySelector('.meter[data-stage="total"]'));
    meters.set(stage,{row,mi,mo,lat,tin:0,tout:0});return meters.get(stage);
  }
  function ensureTotal(){
    let total=metersBox.querySelector('.meter[data-stage="total"]');
    if(!total){total=document.createElement('div');total.className='meter';total.dataset.stage='total';
      total.append(Object.assign(document.createElement('span'),{className:'meter-label',textContent:'TOTAL'}),
        Object.assign(document.createElement('span'),{className:'meter-in',textContent:'in 0'}),
        Object.assign(document.createElement('span'),{className:'meter-out',textContent:'out 0'}),
        Object.assign(document.createElement('span'),{className:'meter-latency',textContent:'—'}));
      metersBox.append(total);meters.set('total',{row:total,mi:total.children[1],mo:total.children[2],lat:total.children[3],tin:0,tout:0});}
    return meters.get('total');
  }
  function refreshMeter(m,max){
    m.mi.textContent='in '+m.tin;m.mo.textContent='out '+m.tout;
    m.mi.style.setProperty('--v',max.in?Math.min(1,m.tin/max.in):0);
    m.mo.style.setProperty('--v',max.out?Math.min(1,m.tout/max.out):0);
  }
  function touchMeter(ev){
    for(const [stage,m] of meters)if(m.row.dataset.active)data(m.row,'data-active','false');
    if(ev.tokens_in==null&&ev.tokens_out==null){
      const m=meterRow(ev.stage);data(m.row,'data-active','true');
      if(Number.isFinite(ev.t_start)&&!Number.isFinite(ev.t_end))m.lat.textContent=(Math.round((Date.now()-ev.t_start)/100)/10)+'s…';
      return;
    }
    const m=meterRow(ev.stage);m.tin+=Number(ev.tokens_in)||0;m.tout+=Number(ev.tokens_out)||0;
    if(Number.isFinite(ev.t_start)&&Number.isFinite(ev.t_end))m.lat.textContent=((ev.t_end-ev.t_start)/1000).toFixed(1)+'s';
    data(m.row,'data-active','true');
    const max={in:0,out:0};for(const x of meters.values())if(x!==meters.get('total')&&x.tin!==undefined){max.in=Math.max(max.in,x.tin);max.out=Math.max(max.out,x.tout);}
    for(const [stage,x] of meters)if(stage!=='total'&&x.tin!==undefined)refreshMeter(x,max);
    const t=ensureTotal();t.tin+=Number(ev.tokens_in)||0;t.tout+=Number(ev.tokens_out)||0;
    if(Number.isFinite(ev.t_start)&&Number.isFinite(ev.t_end))t.lat.textContent=((t.latencyMs=(t.latencyMs||0)+(ev.t_end-ev.t_start))/1000).toFixed(1)+'s';
    refreshMeter(t,{in:Math.max(1,t.tin),out:Math.max(1,t.tout)});
  }

  // ---------- rag log highlight ----------
  function highlightLog(stage){
    if(!terminals?.active)return;
    if(['search','searching','results'].includes(stage))terminals.active('search');
    else if(terminals.activeMap?.[stage])terminals.active(terminals.activeMap[stage]);
    else terminals.active(stage);
  }

  // ---------- apply one structured event ----------
  function apply(ev,paced){
    if(!ev||typeof ev!=='object')return;
    const stage=STAGE_LABELS[ev.stage]?ev.stage:'answering';
    phase('working');
    if(ev.event_type==='merge')phase('merging');
    touchMeter(ev);highlightLog(stage);
    const wave=waves.get(ev.request_id)||{merged:false};waves.set(ev.request_id,wave);
    if(ev.agent==='core'||!ev.agent||ev.agent==='retrieval'){
      if(ev.text)coreSay((ev.event_type==='decision'?'▸ ':'⇢ ')+String(ev.text),ev.event_type==='output'?'done':'writing');
      if(ev.event_type==='decision'&&ev.text)wave.decided=true;
      return;
    }
    const entry=spawnNode(ev.agent,ev.model||'');
    data(entry.hud,'data-state',ev.event_type==='output'||ev.event_type==='merge'?'done':'writing');
    entry.hud.querySelector('.hud-state').textContent=ev.event_type==='output'||ev.event_type==='merge'?'COMPLETE':'STREAMING';
    if(ev.text){
      entry.full+=(entry.full?'\n':'')+'['+(ev.event_type||'event')+'] '+ev.text;
      type(entry.hud,redact(ev.event_type==='prompt'?'⇢ '+String(ev.text).slice(0,160):String(ev.text).slice(0,400)));
    }
    if(ev.event_type==='prompt')fireBolt(ev,'out');
    else if(['output','merge','decision'].includes(ev.event_type))fireBolt(ev,'in');
    if(ev.event_type==='merge')wave.merged=true;
  }
  function ingest(ev){
    if(replaying)stopReplay();
    ev.seq=++seq;log.push(ev);apply(ev,true);
  }

  // ---------- completion sequence (Blackwall glitch → triple pulse → shockwave) ----------
  function complete(){
    phase('merging');
    const finish=()=>{phase('done');retractNodes();};
    if(reduced){finish();return;}
    setTimeout(()=>{
      runGlitch(1500);
      setTimeout(()=>pulse('in'),120);setTimeout(()=>pulse('in'),380);setTimeout(()=>pulse('in'),640);
      setTimeout(()=>pulse('out'),1050);
      setTimeout(finish,2400);
    },420);
  }
  function pulse(kind){
    const c=svgEl('circle',{class:'core-pulse '+kind,r:64,cx:corePoint[0],cy:corePoint[1]});
    layer.pulses.append(c);setTimeout(()=>c.remove(),1300);
  }
  function runGlitch(ms){
    if(!glitch.getContext)return finish();
    const ctx=glitch.getContext('2d');
    const dpr=Math.min(2,devicePixelRatio||1);
    const size=()=>{const r=brain.getBoundingClientRect();glitch.width=r.width*dpr;glitch.height=r.height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);return r;};
    let r=size(),start=performance.now();
    data(glitch,'data-active','true');
    const hex='0123456789ABCDEF';
    const draw=now=>{
      const t=now-start;
      ctx.clearRect(0,0,r.width,r.height);
      if(t>ms){data(glitch,'data-active','false');glitchRaf=0;return;}
      // torn horizontal bands with RGB separation
      for(let i=0;i<7;i++){
        const y=Math.random()*r.height,h=3+Math.random()*24,off=(Math.random()-0.5)*26*(1-t/ms);
        ctx.fillStyle=`rgba(255,42,95,${0.12+Math.random()*0.3})`;ctx.fillRect(off,y,r.width,h);
        ctx.fillStyle=`rgba(25,255,138,${0.05+Math.random()*0.12})`;ctx.fillRect(-off,y+r.height*0.01,r.width,h*0.6);
        if(Math.random()<0.3){ctx.fillStyle='rgba(255,255,255,0.75)';ctx.fillRect(Math.random()*r.width*0.7,y,r.width*0.3,1.4);}
      }
      // scrolling hex dumps
      ctx.font='11px "JetBrains Mono",monospace';
      for(let col=0;col<3;col++){
        const x=60+col*(r.width-160)/2;let s='';
        for(let i=0;i<4;i++)s+=hex[Math.floor(Math.random()*16)]+hex[Math.floor(Math.random()*16)]+' ';
        ctx.fillStyle=`rgba(255,10,69,${0.5+Math.random()*0.4})`;
        ctx.fillText(s+hex[Math.floor(Math.random()*16)]+hex[Math.floor(Math.random()*16)],x,(t*(0.4+col*0.2)+col*97)%r.height);
      }
      if(active())glitchRaf=requestAnimationFrame(draw);else{glitchRaf=requestAnimationFrame(draw);}
    };
    glitchRaf=requestAnimationFrame(draw);
  }

  // ---------- turn lifecycle (called by shell.js) ----------
  function begin(label){
    turn++;turnOpen=true;
    if(replaying)stopReplay();
    clearStage();log.length=0;
    phase('working');if(tt)tt.dataset.busy='true';
    speech.hidden=false;speech.querySelector('pre').textContent='';delete speech.querySelector('pre').dataset.buf;
    hudSet(speech,undefined,{state:'writing'});
    if(label)coreSay('TASK ▸ '+String(label).slice(0,140));
    ensureTotal();
  }
  function end({final=false}={}){
    if(tt)tt.dataset.busy='false';
    if(!turnOpen)return;turnOpen=false;
    if(replaying)return;
    if(log.length)records.push({at:Date.now(),log:[...log]});
    if(final)complete();else{retractNodes();for(const [stage,m] of meters)if(m.row.dataset.active)data(m.row,'data-active','false');}
  }
  function fail(message){
    if(tt)tt.dataset.busy='false';turnOpen=false;
    if(replaying)return;
    if(log.length)records.push({at:Date.now(),log:[...log]});
    retractNodes();phase('idle');
    if(message)coreSay('✕ '+message,'done');
  }
  function clearStage(){
    for(const entry of [...nodes.values()])retireNode(entry,true);
    layer.bolts.replaceChildren();layer.sparks.replaceChildren();layer.pulses.replaceChildren();
    for(const b of bolts)b.g.remove();bolts.length=0;
    nodeSpeeches.replaceChildren();metersBox.replaceChildren();meters.clear();
    speech.hidden=true;speech.querySelector('pre').textContent='';delete speech.querySelector('pre').dataset.buf;
    data(drawer,'data-open','false');data(brain,'data-replay','off');
  }

  // ---------- replay engine ----------
  function replay(saved){
    if(turnOpen)return false; // a live turn owns the stage
    replayLog=[...(saved||records.at(-1)?.log||[])];if(!replayLog.length)return false;
    clearStage();replaying=true;paused=false;replayIdx=0;phase('working');
    data(brain,'data-replay','playing');ensureTotal();
    coreSay('REPLAY ▸ '+replayLog.length+' events');
    tickReplay();return true;
  }
  function tickReplay(){
    if(!replaying||paused)return;
    if(replayIdx>=replayLog.length){replaying=false;data(brain,'data-replay','off');complete();return;}
    const ev=replayLog[replayIdx++];apply(ev,true);
    if(ev.event_type==='decision'){pause('DECISION ▸ inspect, then step or resume');return;}
    const next=replayLog[replayIdx];
    const gap=next&&Number.isFinite(ev.t_end)&&Number.isFinite(next.t_start)?Math.max(80,Math.min(1300,(next.t_start-ev.t_end)||520))/speed:520/speed;
    replayTimer=setTimeout(tickReplay,gap);
  }
  function pause(note){
    if(!replaying)return;paused=true;clearTimeout(replayTimer);
    data(brain,'data-replay','paused');
    if(note)coreSay(note,'idle');
  }
  function resume(){if(!replaying||!paused)return;paused=false;data(brain,'data-replay','playing');tickReplay();}
  function stopReplay(){replaying=false;paused=false;clearTimeout(replayTimer);data(brain,'data-replay','off');}
  function step(dir){
    if(!replayLog&&!records.length)return;
    if(!replaying&&!paused){if(replay(records.at(-1)?.log)){pause();step(dir);}return;}
    pause();
    const target=Math.max(0,Math.min(replayLog.length,replayIdx+dir));
    if(dir<0){clearStage();data(brain,'data-replay','paused');ensureTotal();replayIdx=0;for(let i=0;i<target;i++)apply(replayLog[i],false);}
    else for(let i=replayIdx;i<target;i++)apply(replayLog[i],false);
    replayIdx=target;
  }

  // ---------- wiring ----------
  $('rp-play').onclick=()=>replaying?(paused?resume():0):replay();
  $('rp-pause').onclick=()=>pause();
  $('rp-prev').onclick=()=>step(-1);
  $('rp-next').onclick=()=>step(1);
  $('rp-speed').onchange=e=>{speed=Number(e.target.value)||1;};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&replaying&&!paused)tickReplay();});
  const visObserver=new MutationObserver(()=>{viewVisible=!root.hidden;});
  visObserver.observe(root,{attributes:true,attributeFilter:['hidden']});

  // Manual demo (documented in docs/BRAIN-TERMINALS.md): window.brain.demo()
  function demo(){
    const rid='demo',now=Date.now(),ev=(stage,agent,event_type,text,extra={})=>ingest({request_id:rid,stage,agent,event_type,text,model:extra.model||'nim:nvidia/nemotron-3-ultra-550b-a55b',tokens_in:extra.in,tokens_out:extra.out,t_start:extra.t0,t_end:extra.t1});
    clearStage();turn++;turnOpen=true;phase('working');ensureTotal();
    coreSay('TASK ▸ demo of the full completion sequence');
    setTimeout(()=>ev('routing','core','decision','intent=case · 2 queries · split to planner',{in:210,out:38,t0:now,t1:now+420}),200);
    setTimeout(()=>ev('search','retrieval','prompt','keywords: policy state id verification'),500);
    setTimeout(()=>ev('search','retrieval','output','2 passages matched'),900);
    setTimeout(()=>ev('planning','planner','prompt','SYS Review evidence for gaps…',{model:'gemini-3.5-flash-lite'}),1100);
    setTimeout(()=>ev('planning','planner','output','1 more search: security controls',{in:1450,out:92,t0:now+500,t1:now+980,model:'gemini-3.5-flash-lite'}),1600);
    setTimeout(()=>ev('answering','answerer','prompt','SYS You are Capri… answer with citations',{model:'nim:nvidia/nemotron-3-super-120b-a12b'}),1900);
    setTimeout(()=>ev('answering','answerer','output','Draft with [S1] citations, discrepancies flagged.',{in:4120,out:680,t0:now+1000,t1:now+2400,model:'nim:nvidia/nemotron-3-super-120b-a12b'}),2600);
    setTimeout(()=>ev('verifying','verifier','prompt','SYS Verify the draft against evidence',{model:'gemini-3.5-flash-lite'}),2900);
    setTimeout(()=>ev('verifying','verifier','output','No blocking issues.',{in:2210,out:64,t0:now+2500,t1:now+2800,model:'gemini-3.5-flash-lite'}),3200);
    setTimeout(()=>ev('personality','personality','merge','Capri voice pass over the report.',{in:3800,out:520,t0:now+3000,t1:now+4100,model:'nim:nvidia/nemotron-3-ultra-550b-a55b'}),3500);
    setTimeout(()=>{turnOpen=false;complete();},4600);
  }
  root.addEventListener('capri:brain-demo',demo);

  return {
    begin,ingest,end,fail,replay,pause,resume,step,demo,
    stopReplay,setVisible:v=>{viewVisible=v;},
    recording:()=>records.at(-1)?.log||[],
    get replaying(){return replaying;}
  };
}
