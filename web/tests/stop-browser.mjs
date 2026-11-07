import {externalModels} from '../lib/multi-provider.js';
import {chromium} from 'playwright-core';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {defaults,coreModels} from '../lib/core-settings.js';
let stopped=0,closed=0,hold=true;const requests=[];
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
 let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};let data={ok:true};
 switch(url.pathname){
 case '/api/status':data={configured:true,geminiReady:true,models:[{id:'gemini-3.5-flash-lite',name:'Flash'}]};break;
 case '/api/session':data={email:'stop@example.com'};break;
 case '/api/core-settings':data={defaults,models:[...coreModels,...externalModels]};break;
 case '/api/messages':data={messages:[],hasMore:false};break;
 case '/api/messages-save':data={messages:body.messages.map(m=>({id:m.id,seq:1}))};break;
 case '/api/welcome':data={lines:['Ready.']};break;
 case '/api/agenda':data={reminders:[]};break;
 case '/api/stop':stopped++;data={stopped:1};break;
 case '/api/personality':requests.push(body);if(hold){res.setHeader('Content-Type','application/x-ndjson');res.write(JSON.stringify({type:'heartbeat'})+'\n');res.on('close',()=>closed++);return;}data={route:'reply',answer:'Fresh reply.'};break;
 default:data={vaults:[],notes:[]};
 }
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;
 }
 try{const name=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(new URL('../public/'+name,import.meta.url)));}catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#capri-loading').waitFor({state:'hidden'});
 const send=async text=>{await page.locator('#q').fill(text);await page.locator('#send').click();};
 await send('First request');await page.waitForFunction(()=>document.querySelector('[data-pending]'));
 await send('Queued request');await page.getByRole('button',{name:'Stop all',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('#aria-settings').disabled);await page.waitForTimeout(600);
 assert.equal(stopped,1);assert.equal(closed,1);assert.equal(requests.length,1);assert.equal(await page.locator('[data-pending]').count(),0);assert.equal(await page.locator('#resume-chat').isHidden(),true);
 await page.locator('#aria-settings').click();await page.locator('[name=personality]').selectOption('gemini-3.5-flash-lite');await page.locator('[data-all-model]').click();await page.getByRole('button',{name:'Save settings',exact:true}).click();
 hold=false;await send('New request');await page.getByText('Fresh reply.',{exact:true}).waitFor();assert.equal(requests.length,2);for(const k of ['router','reasoning','analyzing','personality'])assert.equal(requests[1].settings[k],'gemini-3.5-flash-lite');
 await page.reload();await page.locator('#capri-loading').waitFor({state:'hidden'});await page.waitForTimeout(600);assert.equal(requests.length,2);assert.deepEqual(errors,[]);
 console.log('PASS: hard stop disconnects active stream, clears queued work, prevents reload retries, and all-stage settings apply to the next turn.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
