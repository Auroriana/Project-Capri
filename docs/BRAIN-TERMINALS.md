# BRAIN / TERMINALS — implementation notes

The Terminal tab is now a permanent **BRAIN** view: a neural map of every request
(CORE soma + sub-model nodes), the CORE and per-model speech panels, per-stage
token meters, a replay engine, and stacked RAG log panes. This file documents
what changed, how to trigger a visible run, and how to test the completion
sequence by hand.

## What changed

**New files**
- `web/public/brain.js` — the visualizer. Ingests the structured event log,
  spawns dendrites/nodes in fixed ring slots, fires jittered two-layer bolts at
  ~30 fps, runs the typewriter HUDs, the Blackwall glitch + triple pulse +
  photo-reveal completion sequence, the pause/step/speed replay engine, and the
  masked detail drawer. Pure helpers (`redact`, `aggregateMeters`, `boltPoints`,
  `modelShort`, …) are exported and unit-tested in Node without a DOM.
- `web/public/capri.png` — 480×480 portrait revealed in the core after a turn
  completes (converted from `capri-profile.avif`).
- `web/tests/brain.test.mjs` — unit tests for the pure helpers + import safety.

**Changed files**
- `web/public/index.html` — permanent `#tt` BRAIN tab (replaces the old hidden
  `#pt` toggle), the `#terminals-view` section (brain SVG, dialogue row, token
  meters, replay bar, `#rag-logs`), old `<aside id="terminals">` removed.
- `web/public/shell.js` — mounts `brain`, forwards `stage:'pipeline'` NDJSON
  events from both `/api/chat` and `/api/personality` into `brain.ingest`,
  calls `brain.begin/end/fail` around each turn, stores `pipeline` on saved
  messages and adds a "Replay in Brain" action to the message menu, tab()
  handles the `terminals` view, the "model started typing" error popups are gone.
- `web/public/terminals.js` — rewritten: floating windows are now stacked
  `.log-pane` entries in `#rag-logs` (READING / DONE / SKIPPED states), with an
  `active(stage)` hook the Brain uses to highlight the pane for the running stage.
- `web/public/scan-path.js` — scan-flight targets `#tt` instead of the removed `#pt`.
- `web/public/core-settings.js` — CORE MODULES now shows one labelled select per
  pipeline stage (CORE AI // ROUTING, ANSWERER // FINAL ANSWER, PLANNER // GAP
  SEARCH, VERIFIER // FACT CHECK, PERSONALITY LAYER // VOICE) plus the existing
  web-search model — labels match the BRAIN tab stages 1:1.
- `web/api/index.js` — emits the structured event log: every model call becomes
  `prompt` → throttled `stream` (≥350 ms apart) → `output` events with
  `request_id, seq, stage, agent, parent_stage, event_type, text, tokens_in,
  tokens_out, t_start, t_end, model`; stage progress events are mirrored into
  pipeline events; the whole log ships in every result payload (`result.pipeline`)
  including checkpoint continuations. The free failover chains are deeper:
  - text: NIM Nemotron 3 Ultra → NIM Super 120B → **OpenRouter Nemotron 3 Ultra
    :free** → Gemini (guarded last resort)
  - vision: NIM Nemotron 3.5 Super VL → **OpenRouter Super VL :free** →
    OpenRouter Nano Omni :free → Gemini
- `web/lib/multi-provider.js` — registered the live-verified (Nov 2026) OpenRouter
  free mirrors: `nvidia/nemotron-3-ultra-550b-a55b:free` (text, same 550B model),
  `nvidia/nemotron-3.5-lightning:free` (fast spare text),
  `nvidia/nemotron-3.5-super-vl:free` (vision).
- `web/lib/core-settings.js` — new `verifying` stage setting ('' = follow the
  answerer), validated like the other stage models; the verify phase uses it.
- `web/tests/conversation-browser.mjs`, `web/tests/chat-refinement-browser.mjs`
  — updated for the permanent BRAIN tab, stacked panes, and the new settings UI
  (these two tests had also rotted against the delivery-pacing and settings
  changes that landed after their last update; they now pass end-to-end).

**Unchanged on purpose**: Chat/Notes behaviour, `token-usage.js`,
`chat-stream.js`, `pipeline-view.js` (still renders the per-call token table for
older messages), `sw.js` (no asset caching, so no new entries needed).

## How to trigger a visible run

1. Sign in, send any message (e.g. `What did I save in my notes about the morning commute?` in vault mode).
2. Click **BRAIN** in the top nav at any time — RAG fetches never auto-open or
   auto-focus the tab, and all animations pause while the tab is hidden or the
   browser tab is in the background.
3. While the turn runs you'll see: CORE breathing faster, dendrites growing to
   PLANNER / ANSWERER / VERIFIER / PERSONA nodes, red bolts riding the dendrites
   (outbound = prompt, inbound dashed = reply + impact sparks), the CORE speech
   panel showing routing/scope decisions and outgoing prompts, per-model streams
   in the dialogue row, token meters filling per stage, and the matching RAG log
   pane highlighted while its stage runs.
4. When the personality pass merges, the Blackwall glitch tears across the brain
   panel (~1.5 s), the core pulses inward three times, then one strong outward
   shockwave reveals Capri's photo in the core. It stays until your next message.

## Manual completion-sequence trigger (no server needed)

In the browser console:

```js
window.brain.demo()   // scripted pipeline + full glitch/pulse/photo sequence
// or, without selecting anything first:
document.getElementById('terminals-view').dispatchEvent(new Event('capri:brain-demo'))
```

## Replay of a finished turn

Open any model message's `•••` menu → **Replay in Brain**. The saved structured
log re-renders step by step — no model is ever re-called. Controls: REPLAY,
PAUSE, ◀| / |▶ step, 0.25×–2× speed. Replay auto-pauses at every
`decision` event; step forward to continue. Details: click any node, the CORE
speech, or a log pane — the drawer shows the full text with IDs/emails/card
numbers masked; **REVEAL** toggles the raw text.

## OpenRouter (recommended while NIM misbehaves)

1. Create an OpenRouter key → Settings → **PROVIDER UPLINK** → provider
   `OPENROUTER`, paste the key, tick the free-tier confirmation, SAVE KEY.
2. Nothing else is required: the text and vision chains above now hop to the
   OpenRouter free Nemotron mirrors automatically whenever NIM rate-limits,
   cold-starts or times out. To pin a stage to OpenRouter instead, pick e.g.
   "OpenRouter / Nemotron 3 Ultra 550B (free)" in the PERSONALITY LAYER select.
3. Free-model IDs can flip to paid without notice (the GLM `:free` lesson) —
   the registered mirrors were verified live on 2026-11-08.

## Test results

- `npm test` — 200 tests: **199 pass**, 1 pre-existing failure
  (`capricorn.test.mjs` embeds literal `\r` escapes and only matches the CRLF
  files on Windows; it passes on your machine).
- `npm run test:conversation:browser` and `npm run test:chat:browser` — PASS
  (verified headless in Chromium; they had silently rotted before this change).
