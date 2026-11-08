import {capHistory} from '../public/context-budget.js';
import {isUuid} from './notes.js';
import {externalModels, isExternal, ready} from './multi-provider.js';
export const models = [
  {id:'gemini-3.5-flash-lite',name:'Gemini 3.5 Flash Lite',purpose:'Everyday · recommended',rpm:15,rpd:500},
  {id:'gemini-3.1-flash-lite',name:'Gemini 3.1 Flash Lite',purpose:'Everyday · alternative',rpm:15,rpd:500},
  {id:'gemini-3.8-flash',name:'Gemini 3.8 Flash',purpose:'Complex synthesis',rpm:5,rpd:20},
  {id:'gemini-3.6-flash',name:'Gemini 3.6 Flash',purpose:'Compare complex answers',rpm:5,rpd:20},
  {id:'gemini-3-flash',name:'Gemini 3 Flash',purpose:'Compatibility / comparison',rpm:5,rpd:20},
  {id:'gemini-2.5-flash',name:'Gemini 2.5 Flash',purpose:'Earlier-model comparison',rpm:5,rpd:20}
];
// External models (Groq, NIM, DeepSeek, OpenRouter, Z.ai, Anthropic) that are ready
export function getExternalModels() {
  return externalModels.filter(m => isExternal(m.id) && ready(m.id)).map(m => ({
    id: m.id,
    name: m.name,
    purpose: m.provider === 'nim' ? 'NVIDIA NIM' : m.provider === 'groq' ? 'Groq' : m.provider === 'deepseek' ? 'DeepSeek' : m.provider === 'openrouter' ? 'OpenRouter' : m.provider === 'zai' ? 'Z.ai' : 'Claude',
    rpm: 0, rpd: 0
  }));
}
export function allChatModels() {
  return [...models, ...getExternalModels()];
}
export function validateChat(body) {
  const model = allChatModels().find(m => m.id === body.model);
  if(!model) throw new Error('Choose a supported chat model.');
  if(typeof body.message!=='string'||!body.message.trim()||body.message.length>4000) throw new Error('Enter a question of 1–4,000 characters.');
  if(!['general','vault'].includes(body.mode)) throw new Error('Choose general chat or vault search.');
  const vault=body.vault===undefined||body.vault==='all'?null:body.vault;
  if(vault!==null&&!isUuid(vault)) throw new Error('Choose a valid vault.');
  if(body.concise!==undefined&&typeof body.concise!=='boolean')throw Object.assign(new Error('Concise must be a boolean.'),{status:400});
  const conciseFlag=body.concise??false;
  if(body.depth!==undefined&&!['age','mir'].includes(body.depth))throw Object.assign(new Error('Depth must be age or mir.'),{status:400});
  const depth=body.depth??'age';
  const concise=body.depth===undefined?conciseFlag:body.depth==='age';
  if(body.followupCache!==undefined&&body.followupCache!==null&&(typeof body.followupCache!=='string'||body.followupCache.length>200000))throw Object.assign(new Error('Invalid follow-up cache.'),{status:400});
  const history=body.history??[];
  if(!Array.isArray(history)||history.length>200||history.some(m=>!['user','model'].includes(m.role)||typeof m.text!=='string'||m.text.length>40000)||JSON.stringify(history).length>180000) throw new Error('Conversation memory is too large for one request. Start a new chat.');
  const files = body.files ?? [];
  const badFile = () => Object.assign(new Error('Attach up to 4 PNG, JPEG, WebP or PDF files (about 2.8 MB total).'), {status:400});
  if (!Array.isArray(files) || files.length > 4) throw badFile();
  let bytes = 0;
  for (const f of files) {
    if (!f || !['image/png','image/jpeg','image/webp','application/pdf'].includes(f.mime) || typeof f.data !== 'string' || !f.data.length || f.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(f.data)) throw badFile();
    bytes += f.data.length;
    const b = Buffer.from(f.data, 'base64');
    const valid = f.mime === 'image/png' ? b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : f.mime === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255 : f.mime === 'image/webp' ? b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP' : b.toString('ascii',0,5) === '%PDF-';
    if (!valid || bytes > 3_900_000) throw badFile();
  }
  const isExt = isExternal(model.id);
  if (isExt && files.length > 0) {
    throw Object.assign(new Error('External models do not support file attachments. Use a Gemini model for images/PDFs.'), {status: 400});
  }
  return {model:model.id,message:body.message.trim(),mode:body.mode,history:capHistory(history,body.settings?.max_history_tokens||3000),vault,concise,depth,...(body.followupCache?{followupCache:body.followupCache}:{}),files:files.map(({mime,data})=>({inlineData:{mimeType:mime,data}}))};
}