import {requestFetch as fetch} from './request-control.js';
import {ready,providers} from './multi-provider.js';
// Voice messages become text before they ever reach the persona model: the
// recording is transcribed on a free endpoint, then the transcript rides the
// normal text chain (Nemotron Ultra, with Gemini as the last resort). This
// keeps one voice path for every chat model instead of per-model audio taps.
const GROQ_TRANSCRIBE='groq:openai/whisper-large-v3-turbo',NIM_OMNI='nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
// Vercel serverless bodies cap at ~4.5 MB JSON; keep the base64 payload at
// 4.3 M chars (≈3.1 MB decoded) so the request envelope always fits.
const MAX_B64_CHARS=4_300_000;
const GROQ_FORMATS={'audio/webm':'webm','audio/ogg':'ogg','audio/opus':'opus','audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3','audio/mp3':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/flac':'flac'};
export const transcribeReady=()=>ready(GROQ_TRANSCRIBE)||ready(NIM_OMNI);
async function groqTranscribe(mime,data,{signal},fetcher){
 const form=new FormData();
 form.append('file',new Blob([Buffer.from(data,'base64')],{type:mime}),'voice.'+(GROQ_FORMATS[mime]||'webm'));
 form.append('model','whisper-large-v3-turbo');
 form.append('response_format','json');
 form.append('temperature','0');
 const response=await fetcher(providers.groq.base+'/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+(process.env[providers.groq.key]||'')},body:form,signal});
 if(!response.ok){
  let detail;try{detail=await response.json();}catch{}
  const message=String(detail?.error?.message||detail?.message||'').slice(0,300);
  throw Object.assign(new Error('Groq transcription failed (HTTP '+response.status+').'+(message?' '+message:'')),{status:response.status===429?429:response.status>=500?503:502,retryAfter:response.headers.get('retry-after')});
 }
 const out=await response.json();
 if(typeof out.text!=='string')throw Object.assign(new Error('Groq transcription returned no text.'),{status:502});
 return out.text;
}
async function nimOmniTranscribe(mime,data,{signal},fetcher){
 // Nano Omni accepts raw wav/mp3; used when Groq is down and for codecs it
 // cannot serve. A non-streaming call keeps this path simple and small.
 const response=await fetcher(providers.nim.base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(process.env[providers.nim.key]||'')},body:JSON.stringify({model:'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',messages:[{role:'user',content:[{type:'text',text:'Transcribe this audio recording. Return only the words that are spoken, with no commentary.'},{type:'input_audio',input_audio:{data,format:mime.includes('wav')?'wav':'mp3'}}]}],max_tokens:2048,stream:false}),signal});
 if(!response.ok){
  let detail;try{detail=await response.json();}catch{}
  const message=String(detail?.error?.message||detail?.detail||detail?.message||'').slice(0,300);
  throw Object.assign(new Error('NIM Omni transcription failed (HTTP '+response.status+').'+(message?' '+message:'')),{status:response.status===429?429:response.status>=500?503:502});
 }
 const out=await response.json(),text=out.choices?.[0]?.message?.content;
 if(typeof text!=='string'||!text.trim())throw Object.assign(new Error('NIM Omni transcription returned no text.'),{status:502});
 return text.trim();
}
export async function transcribeAudio(audio,{signal}={},fetcher=fetch){
 const mime=String(audio?.mime||''),data=String(audio?.data||'');
 if(!GROQ_FORMATS[mime]&&!(mime.startsWith('audio/')&&data))throw Object.assign(new Error('Unsupported audio format. Record as webm, ogg, wav, mp3 or m4a.'),{status:400});
 if(!data||data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw Object.assign(new Error('The audio payload is not valid base64.'),{status:400});
 if(data.length>MAX_B64_CHARS)throw Object.assign(new Error('The recording is too long (about 3.5 MB of audio). Trim it and try again.'),{status:413});
 const groqReady=ready(GROQ_TRANSCRIBE),nimReady=ready(NIM_OMNI);
 if(!groqReady&&!nimReady)throw Object.assign(new Error('Voice transcription needs the Groq free tier or an NVIDIA key. Neither is enabled.'),{status:503});
 let groqError;
 if(groqReady){
  try{return (await groqTranscribe(mime,data,{signal},fetcher)).trim();}
  catch(error){groqError=error;if(signal?.aborted)throw error;}
 }
 const omniEligible=mime.includes('wav')||mime.includes('mpeg')||mime.includes('mp3');
 if(nimReady&&omniEligible){
  try{return await nimOmniTranscribe(mime,data,{signal},fetcher);}
  catch(error){if(signal?.aborted)throw error;if(!groqReady)throw error;}
 }
 throw groqError||Object.assign(new Error('No transcription provider accepted this recording. Try again or record as wav/mp3.'),{status:502});
}
// Mounts POST /api/transcribe. Returns true when the route was handled.
export async function transcribeRoute({req,route,readBody,send,fail,signal}){
 if(route!=='/api/transcribe')return false;
 if(req.method!=='POST')throw fail('Use POST to transcribe audio.',405);
 if(!transcribeReady())throw fail('Voice transcription is not enabled. Confirm the Groq free tier or add an NVIDIA key.',503);
 const body=await readBody(req,5_000_000);
 if(!body||typeof body!=='object'||!body.audio||typeof body.audio.mime!=='string'||typeof body.audio.data!=='string')throw fail('Send {audio:{mime,data}} with base64 audio.');
 const text=await transcribeAudio(body.audio,{signal});
 return send(200,{text});
}
