import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {settingsOf,defaults,legacyPersonalities} from '../lib/core-settings.js';
import {CAPRI_CORE} from '../lib/capricorn-core.js';
import {notes} from '../public/capricorn-vault-data.js';
import {personalize} from '../lib/personality.js';
test('Capri core is generated from the editable vault and stock settings migrate',async()=>{
 const file=await readFile(new URL('../../personality/Capricorn/01 Core/Always present.md',import.meta.url),'utf8');
 assert.equal(CAPRI_CORE,file.split('<!-- runtime -->')[1].trim());
 for(const p of legacyPersonalities)assert.equal(settingsOf({enabled:false,prompts:{personality:p}}).prompts.personality,CAPRI_CORE);
 assert.equal(settingsOf({enabled:false}).enabled,true);
 assert.equal(defaults.personality,'nim:nvidia/nemotron-3-ultra-550b-a55b');
 assert.equal(settingsOf({prompts:{personality:'My custom instructions'}}).prompts.personality,'My custom instructions');
});
test('personality catalog preserves provenance and corrected ending',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../../personality/Capricorn/retrieval-catalog.json',import.meta.url),'utf8'));
 assert.equal(catalog.embeddingStatus,'not-generated');
 assert.ok(catalog.records.length>=91);
 assert.equal(new Set(catalog.records.map(r=>r.id)).size,catalog.records.length);
 assert.ok(catalog.records.every(r=>r.contentHash.length===64&&r.text.includes('ai_enabled: false')));
 assert.equal(catalog.records.filter(r=>r.sourceId==='T2-user-correction').length,7);
 assert.ok(!catalog.records.some(r=>r.id==='capri.transcript.t1-c46'));
 const scream=catalog.records.find(r=>r.id==='capri.transcript.t2-e01');
 assert.match(scream.text,/boot command to Other Character/);
 assert.match(catalog.records.find(r=>r.id==='capri.transcript.t2-e04').text,/latest correction confirms this is Capri/);
 for(const record of catalog.records){const visible=notes.find(n=>n.path===record.path);if(record.kind==='owner-calibration')assert.equal(visible,undefined);else assert.equal(visible.text,record.text);}
});
test('empty personality responses remain retryable failures',async()=>{
 await assert.rejects(personalize({body:{action:'rewrite',message:'Hi',answer:'Hello',settings:{memory:false,web:'off'}},generate:async request=>{assert.match(request.systemInstruction.parts[0].text,/preferred conversational name is Capri/);return {answer:'  '};}}),/empty response/);
});
