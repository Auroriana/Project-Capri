export function mountCoreSettings({api,owner,busy,onSaved,onArchive,onWelcome}){
 const dialog=document.createElement('dialog');dialog.id='core-settings';dialog.innerHTML=`
<form>
 <div class="settings-heading"><h2>CAPRICORN // SETTINGS</h2><button type="button" data-close aria-label="Close settings" class="cp-close">×</button></div>
 <div class="settings-scan"></div>
 <details class="terminal-section"><summary class="section-label">> PROVIDER UPLINK</summary>
  <p class="settings-help">Encrypted HttpOnly credentials for this browser, valid for 30 days. Background workers still use server environment keys.</p>
  <div class="provider-row">
   <select name="credentialProvider"><option value="groq">GROQ</option><option value="nim">NVIDIA NIM</option><option value="deepseek">DEEPSEEK</option><option value="openrouter">OPENROUTER</option><option value="anthropic">CLAUDE</option><option value="zai">Z.AI // GLM</option></select>
   <input name="providerKey" type="password" autocomplete="off" placeholder="PASTE API KEY // BLANK REMOVES">
  </div>
  <label class="check-row"><input type="checkbox" name="freeAccess"><span>FREE/TIER ACCESS CONFIRMED // NO BILLING</span></label>
  <button type="button" data-save-key class="cp-btn">SAVE KEY</button>
 </details>
 <section class="terminal-section"><h3 class="section-label">> CORE MODULES</h3>
  <p class="settings-help">Gemini handles understanding and research first. GPT-OSS voices smaller reports; oversized Groq stages use Gemini with the full context preserved.</p>
  <button type="button" data-all-model class="cp-btn cp-btn-dim">SYNC ALL STAGES → PERSONALITY MODEL</button>
  <div class="core-models"></div>
 </section>
 <section class="terminal-section"><h3 class="section-label">> REVIEW COUNCIL</h3>
  <label class="check-row"><input type="checkbox" name="councilEnabled"><span>CROSS-CHECK DELEGATED RESEARCH // UP TO 2 PASSES PER MODEL</span></label>
  <p class="settings-help council-help">SELECT 2–4 REVIEW MODELS <span class="council-count" data-count>0/4</span></p>
  <div class="council-chips" data-chips></div>
 </section>
 <section class="terminal-section"><h3 class="section-label">> WEB SEARCH</h3>
  <div class="web-row">
   <label>MODE<select name="web"><option value="auto">CAPRI DECIDES</option><option value="off">OFF</option><option value="ask">ASK ME FIRST</option></select></label>
   <label>MODEL<select name="webModel"></select></label>
  </div>
  <p class="settings-help">Capri can independently search public information when it helps the conversation. Only the proposed query is sent to search. Public web research may incur provider charges.</p>
 </section>
 <section class="terminal-section"><h3 class="section-label">> PERSONALITY LAYER</h3>
  <label class="check-row"><input type="checkbox" name="enabled" checked disabled><span>PERSONALITY LAYER // ALWAYS ON</span></label>
  <label class="check-row"><input type="checkbox" name="memory"><span>ADDITIONAL PERSONALITY LOOKUPS IN AI-ENABLED NOTES</span></label>
  <p class="settings-help">Capri checks her personality database on every turn. She speaks directly or asks for reasoning and note searches when needed. Direct requests for saved notes automatically use retrieval.</p>
  <p><a href="/personality-vault.html" target="_blank" rel="noopener" class="cp-link">→ OPEN PERSONALITY VAULT</a></p>
 </section>
 <section class="terminal-section"><h3 class="section-label">> SYSTEM PROMPTS</h3>
  <div class="core-prompts"></div>
  <button type="button" data-welcome class="cp-btn">REGENERATE WELCOME LINES</button>
 </section>
 <section class="terminal-section"><h3 class="section-label">> HISTORY OPS</h3>
  <button type="button" data-sync class="cp-btn">SYNC RECENT CHATS NOW</button>
  <p class="settings-help">Your conversation syncs as individual messages across devices. Scroll up to load older messages. Unfinished research stays on the browser where you started it. Reminder snapshots are saved in their own searchable vault.</p>
 </section>
 <p class="settings-status" role="status"></p>
 <div class="settings-actions"><button type="button" data-reset class="cp-btn cp-btn-dim">RESTORE DEFAULTS</button><button type="submit" class="cp-btn cp-btn-primary">SAVE SETTINGS</button></div>
</form>`;
 document.body.append(dialog);let catalog,value,baseline,account='',councilSet=new Set();const form=dialog.querySelector('form'),status=dialog.querySelector('.settings-status'),chipBox=dialog.querySelector('[data-chips]'),chipCount=dialog.querySelector('[data-count]');
 const key=()=> 'aria.core.'+account;
 const isStock=p=>typeof p==='string'&&/^You are Aria, (?:with|voiced with) a Phrolova-inspired manner/.test(p)&&p.endsWith('Keep concise answers concise.');
 async function load(){account=owner();catalog=await api('core-settings');if(!catalog.defaults)return;value=structuredClone(catalog.defaults);try{const saved=JSON.parse(localStorage.getItem(key()));if(saved)value={...value,...saved,prompts:{...value.prompts,...saved.prompts}};}catch{}if(catalog.legacyPersonalities?.includes(value.prompts.personality)||value.prompts.personality===catalog.legacyPersonality||isStock(value.prompts.personality))value.prompts.personality=catalog.defaults.prompts.personality;if(!value.autonomousWebV1){value.web='auto';value.autonomousWebV1=true;}if(!value.contextRoutingV2){if(value.router==='groq:openai/gpt-oss-120b')value.router='gemini-3.5-flash-lite';value.contextRoutingV2=true;}value.enabled=true;return value;}
 function updateChipCount(){chipCount.textContent=councilSet.size+'/4';chipCount.classList.toggle('ok',councilSet.size>=2&&councilSet.size<=4);}
 function render(){
  const models=dialog.querySelector('.core-models');models.replaceChildren();
  for(const [key,label] of [['router','CORE AI'],['reasoning','REASONING'],['analyzing','ANALYZING'],['personality','PERSONALITY LAYER']]){const l=document.createElement('label');l.className='model-label';l.innerHTML='<span>'+label+'</span>';const select=document.createElement('select');select.name=key;if(['router','reasoning'].includes(key))select.add(new Option(key==='router'?'USE PERSONALITY MODEL':'USE CHAT MODEL', ''));for(const m of catalog.models){const option=new Option(m.name,m.id);option.disabled=m.available===false||(m.id.startsWith('claude-')&&!catalog.claudeReady);select.add(option)}select.value=value[key];l.append(select);models.append(l)}
  form.elements.councilEnabled.checked=value.councilEnabled;councilSet=new Set(value.councilModels||[]);chipBox.replaceChildren();
  for(const m of catalog.models){const chip=document.createElement('button');chip.type='button';chip.className='chip';chip.textContent=m.name;chip.dataset.id=m.id;if(councilSet.has(m.id))chip.classList.add('on');if(m.available===false)chip.classList.add('off');chip.onclick=()=>{if(chip.classList.contains('off'))return;if(councilSet.has(m.id)){councilSet.delete(m.id);chip.classList.remove('on');}else if(councilSet.size<4){councilSet.add(m.id);chip.classList.add('on');}else{status.textContent='Council is full (4). Remove one before adding another.';}updateChipCount();};chipBox.append(chip);}
  updateChipCount();
  form.elements.web.value=value.web;const webModel=form.elements.webModel;webModel.replaceChildren();webModel.add(new Option('AUTO // DEFAULT','auto'));for(const m of catalog.models){if(m.available===false)continue;const option=new Option(m.name,m.id);webModel.add(option)}webModel.value=value.webModel||'auto';
  for(const k of ['enabled','memory'])form.elements[k].checked=value[k];
  const prompts=dialog.querySelector('.core-prompts');prompts.replaceChildren();
  for(const [k,label] of [['personality','PERSONALITY INSTRUCTIONS'],['routing','UNDERSTANDING + INITIAL VAULT SEARCH'],['search','FOLLOW-UP VAULT SEARCHES'],['answer','RESEARCH REPORT'],['lookup','DIRECT LOOKUP ANSWERS'],['general','GENERAL CHAT'],['concise','CONCISE OUTPUT']]){const d=document.createElement('details'),summary=document.createElement('summary'),area=document.createElement('textarea');summary.textContent='> '+label;area.name='prompt-'+k;area.value=value.prompts[k];area.maxLength=16000;area.required=true;area.rows=9;area.setAttribute('aria-label',label);d.append(summary,area);prompts.append(d)}
 }
 document.getElementById('aria-settings').onclick=async()=>{if(busy())return;try{if(!value)await load();if(!value)throw new Error('Settings are unavailable.');baseline=structuredClone(value);render();status.textContent='';dialog.showModal()}catch(e){alert(e.message)}};
 dialog.querySelector('[data-save-key]').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{await api('provider-key',{provider:form.elements.credentialProvider.value,key:form.elements.providerKey.value.trim(),freeAccess:form.elements.freeAccess.checked});form.elements.providerKey.value='';catalog=await api('core-settings');render();status.textContent='CREDENTIAL SAVED // MODEL CATALOG REFRESHED';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
 dialog.querySelector('[data-all-model]').onclick=()=>{const model=form.elements.personality.value;for(const key of ['router','reasoning','analyzing','personality'])form.elements[key].value=model;form.elements.councilEnabled.checked=false;status.textContent='ALL STAGES SYNCED // SAVE TO APPLY';};
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-reset]').onclick=()=>{value=structuredClone(catalog.defaults);render();status.textContent='DEFAULTS RESTORED // SAVE TO APPLY';};
 dialog.onclose=()=>{if(baseline)value=baseline};
 dialog.querySelector('[data-welcome]').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{await onWelcome();status.textContent='WELCOME LINES REGENERATED';}catch(error){status.textContent=error.message}finally{b.disabled=false}};
 dialog.querySelector('[data-sync]').onclick=async()=>{status.textContent='SYNCING RECENT CHATS…';try{await onArchive();status.textContent='SYNC COMPLETE // HISTORY ARCHIVE REFRESHED';}catch(e){status.textContent=e.message}};
 form.onsubmit=e=>{e.preventDefault();const next=structuredClone(value);next.councilEnabled=form.elements.councilEnabled.checked;next.councilModels=[...councilSet];if(next.councilModels.length<2||next.councilModels.length>4){status.textContent='SELECT 2–4 REVIEW MODELS.';return;}next.web=form.elements.web.value;next.webModel=form.elements.webModel.value;for(const k of ['router','reasoning','analyzing','personality'])next[k]=form.elements[k].value;for(const k of ['enabled','memory'])next[k]=form.elements[k].checked;for(const k of Object.keys(next.prompts))next.prompts[k]=form.elements['prompt-'+k].value;try{localStorage.setItem(key(),JSON.stringify(next));value=next;baseline=next;onSaved?.();dialog.close()}catch{status.textContent='COULD NOT SAVE SETTINGS.'}};
 return {load,get:()=>value?structuredClone(value):undefined,clear:()=>{baseline=undefined;value=undefined;catalog=undefined;dialog.close()}};
}
