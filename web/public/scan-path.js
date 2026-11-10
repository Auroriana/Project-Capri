const ns='http://www.w3.org/2000/svg';
let lastTarget,queue=[],timer;
function jump(target){
 if(!target.isConnected)return;
 const end=target.getBoundingClientRect(),start=(lastTarget?.isConnected?lastTarget:document.querySelector('#capri-face')).getBoundingClientRect();
 lastTarget=target;document.querySelector('#tt').classList.add('scan-active');
 if(!end.width||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const x=start.left+start.width/2,y=start.top+start.height/2,a=end.left+10,b=end.top+end.height/2;
 const svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');svg.setAttribute('class','jump-wire');svg.setAttribute('aria-hidden','true');
 path.setAttribute('d',`M ${x} ${y} L ${x+(a-x)*.46+11} ${y+(b-y)*.4} l -9 9 15 -2 L ${a} ${b} l -7 -4`);
 svg.append(path);document.body.append(svg);setTimeout(()=>svg.remove(),750);
}
function next(){if(!queue.length){timer=null;document.querySelector('#tt').classList.remove('scan-active');return;}jump(queue.shift());timer=setTimeout(next,230);}
export function queueJump(target){queue.push(target);queue=queue.slice(-14);if(!timer)next();}
export function stopFlight(){clearTimeout(timer);timer=null;queue=[];lastTarget=null;document.querySelector('#capri-face')?.getAnimations().filter(a=>a.id==='scan-flight').forEach(a=>a.cancel());document.querySelectorAll('.jump-wire').forEach(svg=>svg.remove());document.querySelector('#tt').classList.remove('scan-active');}
window.addEventListener('resize',stopFlight);
export function clearScan(){stopFlight();document.querySelector('#personality-path').replaceChildren();}
export function showScan(passages,animate=true){
 const panel=document.querySelector('#personality-path');panel.replaceChildren();
 if(!passages?.length)return;
 const title=document.createElement('h5');title.className='scope-title';title.textContent='Personality / scan';panel.append(title);
 for(const p of passages){const row=document.createElement('div'),eye=document.createElement('i');row.className='scan-row';eye.className='scan-eye';row.append(eye,document.createTextNode(p.path));panel.append(row);if(animate)queueJump(row);}
}
