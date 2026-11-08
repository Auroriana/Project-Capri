import test from 'node:test';
import assert from 'node:assert/strict';
import {externalGenerate,supportsVision,supportsAudio,providers} from '../lib/multi-provider.js';
import {validateChat} from '../lib/models.js';
import {transcribeAudio,transcribeReady} from '../lib/transcribe.js';

const keys=()=>{const snapshot={};for(const provider of ['groq','nim','openrouter']){const k=providers[provider].key;snapshot[k]=process.env[k];process.env[k]='fixture';}for(const k of ['CAPRI_FREE_ONLY','NVIDIA_FREE_ACCESS_CONFIRMED','GROQ_FREE_TIER_CONFIRMED']){snapshot[k]=process.env[k];process.env[k]=k==='CAPRI_FREE_ONLY'?'false':'true';}return snapshot;};
const restore=snapshot=>{for(const [k,v] of Object.entries(snapshot)){if(v===undefined)delete process.env[k];else process.env[k]=v;}};
const sse=chunks=>new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(chunk)+'\n\n'));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
const textRequest=files=>({systemInstruction:{parts:[{text:'system'}]},contents:[{role:'user',parts:[{text:'what is this?'},...files]}],generationConfig:{maxOutputTokens:100}});
const png={inlineData:{mimeType:'image/png',data:'aWNvbg=='}};
const wav={inlineData:{mimeType:'audio/wav',data:'YXVkaW8='}};

test('capability flags mark the multimodal legs and keep the text core plain',()=>{
 assert.equal(supportsVision('nim:nvidia/nemotron-3.5-super-vl-120b-a12b'),true);
 assert.equal(supportsVision('nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'),true);
 assert.equal(supportsAudio('nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'),true);
 assert.equal(supportsVision('openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'),true);
 assert.equal(supportsVision('nim:nvidia/nemotron-3-ultra-550b-a55b'),false);
 assert.equal(supportsAudio('nim:nvidia/nemotron-3-ultra-550b-a55b'),false);
 assert.equal(supportsVision('nim:nvidia/nemotron-3-super-120b-a12b'),false);
});

test('image attachments become image_url data URIs on a vision model',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 const result=await externalGenerate('nim:nvidia/nemotron-3.5-super-vl-120b-a12b',textRequest([png]),{},(url,options)=>{
  assert.equal(url,providers.nim.base+'/chat/completions');
  const body=JSON.parse(options.body);
  assert.equal(body.model,'nvidia/nemotron-3.5-super-vl-120b-a12b');
  const content=body.messages[1].content;
  assert.deepEqual(content[0],{type:'text',text:'what is this?'});
  assert.equal(content[1].type,'image_url');
  assert.equal(content[1].image_url.url,'data:image/png;base64,aWNvbg==');
  return sse([{choices:[{delta:{content:'a photo'}}]},{choices:[{finish_reason:'stop'}]}]);
 });
 assert.equal(result.answer,'a photo');
});

test('wav audio becomes an input_audio part only on omni models',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 const result=await externalGenerate('nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',textRequest([wav]),{},(url,options)=>{
  const body=JSON.parse(options.body);
  assert.deepEqual(body.messages[1].content[1],{type:'input_audio',input_audio:{data:'YXVkaW8=',format:'wav'}});
  return sse([{choices:[{delta:{content:'transcript'}}]},{choices:[{finish_reason:'stop'}]}]);
 });
 assert.equal(result.answer,'transcript');
 await assert.rejects(externalGenerate('nim:nvidia/nemotron-3.5-super-vl-120b-a12b',textRequest([wav]),{},async()=>{throw new Error('must not reach the network');}),error=>error.status===400&&/wav or mp3/.test(error.message));
});

test('text-only external models still refuse attachments before any network call',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 await assert.rejects(externalGenerate('nim:nvidia/nemotron-3-ultra-550b-a55b',textRequest([png]),{},async()=>{throw new Error('must not reach the network');}),error=>error.status===400&&/text only/.test(error.message));
 await assert.rejects(externalGenerate('nim:nvidia/nemotron-3.5-super-vl-120b-a12b',textRequest([{inlineData:{mimeType:'application/pdf',data:'JVBERi0='}}]),{},async()=>{throw new Error('must not reach the network');}),error=>error.status===400&&/PDF/.test(error.message));
});

test('quick-chat validation allows image attachments on vision models only',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 const file={mime:'image/png',data:'iVBORw0KGgo='};
 const ok=validateChat({model:'nim:nvidia/nemotron-3.5-super-vl-120b-a12b',message:'look',mode:'general',files:[file]});
 assert.equal(ok.files[0].inlineData.mimeType,'image/png');
 assert.throws(()=>validateChat({model:'groq:openai/gpt-oss-120b',message:'look',mode:'general',files:[file]}),error=>error.status===400&&/text only/.test(error.message));
 assert.throws(()=>validateChat({model:'nim:nvidia/nemotron-3.5-super-vl-120b-a12b',message:'look',mode:'general',files:[{mime:'application/pdf',data:'JVBERi0='}]}),/PDF/);
});

test('voice transcription rides Groq whisper and returns the text',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 const result=await transcribeAudio({mime:'audio/webm',data:'YXVkaW8='},{},async(url,options)=>{
  assert.equal(url,providers.groq.base+'/audio/transcriptions');
  assert.equal(options.method,'POST');
  assert.ok(options.body instanceof FormData);
  assert.equal(options.body.get('model'),'whisper-large-v3-turbo');
  return new Response(JSON.stringify({text:' hello there '}),{headers:{'content-type':'application/json'}});
 });
 assert.equal(result,'hello there');
});

test('when Groq fails, wav and mp3 fall back to the NIM Omni transcriber',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 const calls=[];let step=0;
 const result=await transcribeAudio({mime:'audio/wav',data:'YXVkaW8='},{},async(url,options)=>{
  calls.push(url);step++;
  if(step===1)return new Response(JSON.stringify({error:{message:'overloaded'}}),{status:500,headers:{'content-type':'application/json'}});
  assert.equal(url,providers.nim.base+'/chat/completions');
  const body=JSON.parse(options.body);
  assert.equal(body.model,'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
  assert.equal(body.messages[0].content[1].type,'input_audio');
  return new Response(JSON.stringify({choices:[{message:{content:'spoken words'}}]}),{headers:{'content-type':'application/json'}});
 });
 assert.equal(result,'spoken words');
 assert.equal(calls.length,2);
});

test('transcription is rejected cleanly when nothing is enabled or input is bad',async t=>{
 const snapshot=keys();t.after(()=>restore(snapshot));
 process.env.GROQ_API_KEY='';process.env.NVIDIA_API_KEY='';
 delete process.env.GROQ_FREE_TIER_CONFIRMED;delete process.env.NVIDIA_FREE_ACCESS_CONFIRMED;
 assert.equal(transcribeReady(),false);
 await assert.rejects(transcribeAudio({mime:'audio/wav',data:'YXVkaW8='}),error=>error.status===503&&/free tier/.test(error.message));
 process.env.GROQ_API_KEY='fixture';process.env.GROQ_FREE_TIER_CONFIRMED='true';
 await assert.rejects(transcribeAudio({mime:'audio/flac',data:'!!!'}),error=>error.status===400&&/base64/.test(error.message));
 await assert.rejects(transcribeAudio({mime:'audio/webm',data:'YWFh'.repeat(4_000_000)}),error=>error.status===413&&/too long/.test(error.message));
});
