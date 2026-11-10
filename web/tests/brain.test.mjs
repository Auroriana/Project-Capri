import assert from 'node:assert/strict';
// Importing brain.js in Node must work without any DOM: only pure helpers run.
import {redact,modelShort,boltPoints,boltWidth,slotPoint,aggregateMeters,STAGE_LABELS,mountBrain} from '../public/brain.js';

// ---------- redaction: personal data is masked by default ----------
assert.equal(redact('trace 3f2b8a10-4c1d-4e2a-9b3c-1a2b3c4d5e6f end'),'trace ‹id› end');
assert.equal(redact('mail me at capri@example.com now'),'mail me at ‹email› now');
assert.equal(redact('card 4111 1111 1111 1111 ok'),'card ‹card› ok');
assert.equal(redact('account 09171234567 active'),'account ‹#› active');
assert.equal(redact('token sk-QwErTyUiOpAsDfGhJkLzXcVb1234'),'token ‹key›');
// Years, dates and small numbers survive.
assert.equal(redact('on 2026-11-08 at 21:30, 3 passages'), 'on 2026-11-08 at 21:30, 3 passages');
assert.equal(redact(undefined),'');

// ---------- display names ----------
assert.equal(modelShort('nim:nvidia/nemotron-3-ultra-550b-a55b'),'nemotron-3-ultra-550b-a55b');
assert.equal(modelShort('openrouter:nvidia/nemotron-3-ultra-550b-a55b:free'),'nemotron-3-ultra-550b-a55b (free)');
assert.equal(modelShort('gemini-3.5-flash-lite'),'gemini-3.5-flash-lite');

// ---------- bolt geometry ----------
{
  const pts=boltPoints(500,235,500,65,7);
  assert.equal(pts.length,10);
  assert.deepEqual(pts[0],[500,235]);
  assert.deepEqual(pts.at(-1),[500,65]);
  for(const [x,y] of pts){assert.ok(Math.abs(x-500)<=10,'jitter stays near the line');assert.ok(y>=60&&y<=240);}
}
assert.ok(boltWidth(0)>1.1&&boltWidth(0)<3.5,'zero-token bolts still use the default thickness');
assert.equal(boltWidth(undefined),1.1+120/500*2.4);
assert.ok(boltWidth(5000)>3&&boltWidth(5000)<=3.6,'thickness clamps');

// ---------- fixed slots: no overlap, inside the map ----------
{
  const seen=new Set();
  for(let i=0;i<6;i++){
    const [x,y]=slotPoint(i);
    assert.ok(x>180&&x<820&&y>20&&y<450,'slot '+i+' inside viewBox');
    seen.add(Math.round(x)+':'+Math.round(y));
  }
  assert.equal(seen.size,6);
}

// ---------- meter aggregation ----------
{
  const t0=1000;
  const log=[
    {stage:'routing',agent:'core',event_type:'decision',tokens_in:210,tokens_out:38,t_start:t0,t_end:t0+400},
    {stage:'search',agent:'retrieval',event_type:'prompt',text:'kw'},           // no tokens → ignored
    {stage:'planning',agent:'planner',event_type:'output',tokens_in:1450,tokens_out:92,t_start:t0+500,t_end:t0+980},
    {stage:'planning',agent:'planner',event_type:'output',tokens_in:100,tokens_out:10,t_start:t0+1200,t_end:t0+1300},
    {stage:'nonsense',agent:'x',event_type:'output',tokens_in:5,tokens_out:5,t_start:t0,t_end:t0+10}, // → answering
    {stage:'personality',agent:'personality',event_type:'merge',tokens_in:3800,tokens_out:520,t_start:t0+3000,t_end:t0+4100},
  ];
  const agg=aggregateMeters(log);
  const byStage=Object.fromEntries(agg.rows.map(r=>[r.stage,r]));
  assert.equal(byStage.routing.tin,210);assert.equal(byStage.routing.tout,38);assert.equal(byStage.routing.latency,400);
  assert.equal(byStage.planning.tin,1550);assert.equal(byStage.planning.tout,102);
  assert.equal(byStage.answering.tin,5,'unknown stages fall back to answering');
  assert.ok(agg.rows.map(r=>r.stage).join(',').startsWith('routing'),'rows follow STAGE_ORDER');
  assert.equal(agg.total.tin,210+1550+5+3800);
  assert.equal(agg.total.tout,38+102+5+520);
  assert.equal(agg.total.latency,400+580+10+1100);
  assert.deepEqual(aggregateMeters([]).rows,[]);
}

// ---------- stage vocabulary ----------
for(const s of ['routing','scope','search','evidence','planning','answering','verifying','council','personality','web'])assert.ok(STAGE_LABELS[s],s+' has a meter label');

// ---------- mountBrain exists as a browser entry point ----------
assert.equal(typeof mountBrain,'function');

console.log('PASS: brain pure helpers — redaction, names, bolt geometry, fixed slots, meter aggregation');
