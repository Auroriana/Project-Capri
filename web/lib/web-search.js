import {gemini} from './providers.js';
export async function webSearch(query,{reserve,generate=gemini,model}={}){
 if(typeof query!=='string'||!query.trim()||query.length>300)throw Object.assign(new Error('Invalid web query.'),{status:400});
 const searchModel=model&&model!=='auto'?model:process.env.WEB_SEARCH_MODEL||'gemini-2.5-flash';
 const request={contents:[{role:'user',parts:[{text:'Search the public web for this topic. Give a short factual briefing with sources. Separate synopsis/facts from reviews and subjective opinions. Do not invent having personally read or experienced the work. Topic: '+query}]}],tools:[{google_search:{}}],generationConfig:{maxOutputTokens:2048}};
 let result,lastError;
 const candidates=[...new Set([searchModel,'gemini-3.5-flash-lite','gemini-3.1-flash-lite'])];
 for(const candidate of candidates){
  try{await reserve(candidate,4096);result=await generate(candidate,request);break;}
  catch(e){lastError=e;if(e.invalidKey||![400,404,429,500,502,503,504].includes(e.providerStatus||e.status))throw e;}
 }
 if(!result)throw lastError;

 const meta=result.grounding,sources=(meta?.groundingChunks??[]).filter(c=>/^https:\/\//.test(c.web?.uri??'')).map(c=>({title:c.web.title||'Web source',url:c.web.uri}));
 if(!sources.length)throw Object.assign(new Error('Web search returned no verifiable sources. Try a more specific query.'),{status:502});
 return {answer:result.answer,sources,entryPoint:meta.searchEntryPoint?.renderedContent||'',usage:result.usage};
}
