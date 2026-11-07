const totalFields=['promptTokenCount','candidatesTokenCount','thoughtsTokenCount','toolUsePromptTokenCount'];
const fields=[...totalFields,'cachedContentTokenCount','cacheCreationTokenCount'];
export const estimateText=text=>Math.ceil(new TextEncoder().encode(text||'').length/4);
// Attachment content cannot be tokenized locally; use a rough per-file allowance, never base64 length.
export function estimateQuestion(message,history=[],files=[]){return estimateText(message)+history.reduce((n,m)=>n+estimateText(m.text),0)+files.length*4096;}
export function normalizeUsage(usage,fallback=0){
  const out={};for(const key of fields)if(Number.isFinite(usage?.[key]))out[key]=usage[key];
  out.totalTokenCount=Number.isFinite(usage?.totalTokenCount)?usage.totalTokenCount:totalFields.reduce((n,k)=>n+(out[k]||0),0)||fallback;
  out.estimated=!Number.isFinite(usage?.totalTokenCount);return out;
}
export function addUsage(a,b){
  const out={totalTokenCount:(a?.totalTokenCount||0)+(b?.totalTokenCount||0),estimated:!!(a?.estimated||b?.estimated)};
  for(const key of fields)if(a?.[key]!==undefined||b?.[key]!==undefined)out[key]=(a?.[key]||0)+(b?.[key]||0);
  if(a?.calls||b?.calls)out.calls=[...(a?.calls||[]),...(b?.calls||[])];
  for(const key of ['ragSearches','semanticSearches','embeddingCalls','embeddingTokensEstimated','retrievalMs'])if(a?.[key]!==undefined||b?.[key]!==undefined)out[key]=(a?.[key]||0)+(b?.[key]||0);
  return out;
}
export function usageTitle(usage){return (usage.estimated?'Includes estimated tokens':'Tokens reported by models')+' · '+[['Input','promptTokenCount'],['Output','candidatesTokenCount'],['Thinking','thoughtsTokenCount'],['Tool prompt','toolUsePromptTokenCount'],['Cached input (included)','cachedContentTokenCount'],['Cache writes (included)','cacheCreationTokenCount']].map(([name,key])=>name+': '+(usage[key]??'unavailable')).join(' · ');}

// Numeric diagnostics only: never retain prompt text, queries, document titles or keys.
export function promptSizes(request){
  const size=v=>estimateText(typeof v==='string'?v:JSON.stringify(v??''));
  const sizes={system:size((request.systemInstruction?.parts??[]).map(p=>p.text||'').join('\n')),history:0,retrieved:0,personality:0,overview:0,draft:0};
  const contents=request.contents??[];
  for(const c of contents.slice(0,-1))sizes.history+=size(c.parts?.map(p=>p.text||'').join('\n'));
  for(const p of contents.at(-1)?.parts??[]){
    if(!p.text)continue;
    let data;try{data=JSON.parse(p.text);}catch{continue;}
    if(!data||typeof data!=='object')continue;
    for(const key of ['conversationMemory','conversation'])if(data[key])sizes.history+=size(data[key]);
    for(const key of ['evidence','memories','web'])if(data[key])sizes.retrieved+=size(data[key]);
    if(data.personalityPassages)sizes.personality+=size(data.personalityPassages);
    if(data.recentChats)sizes.overview+=size(data.recentChats);
    if(data.original)sizes.draft+=size(data.original);
  }
  sizes.input=estimateText(JSON.stringify(request,(key,value)=>key==='inlineData'?{mimeType:value.mimeType}:value));
  sizes.input+=contents.reduce((n,c)=>n+(c.parts??[]).filter(p=>p.inlineData).length*4096,0);
  return sizes;
}
export function callUsage(usage,request,answer,{model,role,phase,latencyMs}){
  const sizes=promptSizes(request),normalized=normalizeUsage(usage,sizes.input+estimateText(answer));
  normalized.estimated ||= !Number.isFinite(usage?.promptTokenCount)||!Number.isFinite(usage?.candidatesTokenCount);
  normalized.promptTokenCount??=sizes.input;normalized.candidatesTokenCount??=estimateText(answer);
  return {...normalized,calls:[{model,role,phase,latencyMs,...normalized,promptEstimates:sizes}]};
}
export function usageDetails(usage){
  const lines=[usageTitle(usage)];
  const totals=new Map();for(const c of usage.calls??[]){const row=totals.get(c.model)||{input:0,output:0,calls:0};row.input+=c.promptTokenCount||0;row.output+=c.candidatesTokenCount||0;row.calls++;totals.set(c.model,row);}
  for(const [model,row] of totals)lines.push((model.startsWith('nim:')?'NVIDIA NIM · ':'')+model+': '+row.calls+' calls · Input '+row.input+' · Output '+row.output);
  lines.push('Per-reply usage only; not your provider account balance or daily quota.');
  for(const [i,c] of (usage.calls??[]).entries()){
    lines.push(`${i+1}. ${c.role} / ${c.phase} · ${c.model}: ${c.totalTokenCount} tokens${c.estimated?' (estimate)':''} · ${c.latencyMs} ms`, '   '+usageTitle(c));
    if(c.promptEstimates)lines.push('   Approximate prompt tokens (UTF-8 bytes / 4): '+Object.entries(c.promptEstimates).map(([k,v])=>`${k} ${v}`).join(' · '));
  }
  lines.push(`RAG searches: ${usage.ragSearches??'unavailable'} · semantic: ${usage.semanticSearches??'unavailable'} · retrieval: ${usage.retrievalMs??'unavailable'} ms`, `Embedding calls: ${usage.embeddingCalls??'unavailable'} · embedding tokens (separate estimate): ${usage.embeddingTokensEstimated??'unavailable'}`);
  lines.push('Cache counts are included in input. Prompt component estimates are diagnostic, not provider billing counts. Only completed calls are itemized; interrupted or failed calls may incur unreported usage.');
  return lines.join('\n');
}
