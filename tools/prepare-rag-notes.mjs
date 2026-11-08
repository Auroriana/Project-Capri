// node --env-file=web/.env.local tools/prepare-rag-notes.mjs [--apply] [--limit=5]
// Requires a current SUPABASE_ACCESS_TOKEN belonging to the note owner.
import fs from 'node:fs/promises';
import {prepareNote} from '../web/lib/note-preparation.js';
import {gemini,embed} from '../web/lib/providers.js';
const apply=process.argv.includes('--apply'),limit=Number(process.argv.find(a=>a.startsWith('--limit='))?.split('=')[1]||5);
if(!Number.isInteger(limit)||limit<1)throw Error('Positive --limit required');
if(!process.env.SUPABASE_ACCESS_TOKEN)throw Error('Set SUPABASE_ACCESS_TOKEN to the signed-in owner access token. Never put it in a report.');
const headers={apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'};
async function db(path,body){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+path,{headers:{...headers,...(body?{Prefer:'resolution=merge-duplicates,return=representation'}:{})},method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Database HTTP '+r.status);return r.status===204||r.headers.get('content-length')==='0'?null:r.json();}
await fs.mkdir('artifacts/rag-preparation',{recursive:true});
let processed=0,offset=0;
while(processed<limit){
 const notes=await db('aria_notes?select=id,owner_id,title,content,content_hash&ai_enabled=eq.true&deleted=eq.false&order=id&limit=100&offset='+offset);
 if(!notes.length)break;offset+=notes.length;
 for(const note of notes){if(processed>=limit)break;
  const file='artifacts/rag-preparation/'+note.id+'.json';let previous;try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
  const prepared=await prepareNote(note,request=>gemini(process.env.NOTE_PREPARATION_MODEL||'gemini-3.5-flash-lite',request),previous);
  // Never publish a stale index if a note changed during preparation.
  if(prepared.contentHash!==note.content_hash)throw Error('Source hash mismatch: '+note.id);
  await fs.writeFile(file,JSON.stringify(prepared,null,2));
  if(apply){
   const rows=[];
   for(const c of prepared.chunks){
    c.embedding??=await embed(c.embeddingInput);
    rows.push({note_id:note.id,owner_id:note.owner_id,content_hash:prepared.contentHash,seq:c.order,heading:c.heading,original_text:c.text,clarified_text:c.clarified,keywords:c.keywords,questions:c.questions,embedding:c.embedding});
    await fs.writeFile(file,JSON.stringify(prepared,null,2));
   }
   await db('aria_prepared_chunks?on_conflict=note_id,content_hash,seq',rows);
  }
  console.log(JSON.stringify({noteId:note.id,chunks:prepared.chunks.length,unclear:prepared.unclear,fallback:prepared.fallback,reused:!!prepared.reused,published:apply}));processed++;
 }
}
