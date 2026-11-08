# NVIDIA NIM latency and timeout fix

Symptom: chat turns using NIM models (GLM-5.3 Flash, DeepSeek V4.1 Flash, Nemotron 3) hang for a long time, then fail with "I couldn't finish that request. Your progress is saved. I'll retry shortly." The browser network panel shows the `personality` POST finishing with a small error payload after roughly 20-25 seconds.

## Root cause

Three layers stack on top of each other.

1. **Provider side (real, and partly outside our control).** The hosted NIM endpoint (`integrate.api.nvidia.com`) on the free tier is rate limited to roughly 40 requests per minute per key, is subject to per-model queueing and cold starts, and has documented instability windows with slow time-to-first-token, hanging requests and 429s even at low request volume (NVIDIA developer forums, June-September 2026 threads). No free-tier rate-limit increase is available; higher limits require a paid deployment.
2. **App side, request shape.** `externalGenerate` called every provider with `stream: false` and a flat 120-second timeout. A queued or cold-starting NIM request produces zero bytes until the entire completion is done, so the app sat blind for up to two minutes and then failed the whole turn. Gemini already had a streaming path with idle detection (`geminiStream`); external providers did not.
3. **App side, failure handling.** `generateWithOverflow` only moved work to Gemini when a Groq stage exceeded its request budget (413). A NIM timeout, 5xx, or dropped connection failed the turn outright, and the browser's automatic retry (up to five attempts) re-ran the entire pipeline, spending more of the 40 RPM budget and making the delays worse.

Also note that a single chat turn is not one NIM call. With all stages synced to a NIM model, a casual turn is at minimum the CORE AI routing call plus the personality rewrite call, and MIR depth, verification passes, or a model council add more. At 40 RPM that ceiling is hit quickly.

## What changed

- `web/lib/multi-provider.js` — `externalGenerate` now requests OpenAI-style SSE streaming (`stream: true`, `stream_options: {include_usage: true}`) for all OpenAI-compatible providers (NIM, Groq, DeepSeek, OpenRouter, Z.ai) and assembles the answer from `delta.content` chunks.
  - A **first-token watchdog** aborts a request that produces no SSE output in time, instead of hanging for the full timeout. Any live SSE event (including reasoning-only deltas) clears the watchdog, since it proves the provider accepted the request.
  - An **idle timer** catches streams that die mid-answer; a **total timer** caps the stage.
  - Timeout and abort failures now surface as clean HTTP 504 errors with the provider and model named, instead of a status-less `TimeoutError` that rendered as a generic 500.
  - Providers that reject `stream_options` with HTTP 400 are retried once without streaming; providers that answer with a complete JSON body are still handled (previous behavior).
  - Claude requests are unchanged.
- `web/lib/provider-routing.js` — a NIM (or other external) stage that fails with a timeout, connection failure, 413, 502, 503 or 504 now moves to the configured Gemini fallback with the full context preserved, instead of failing the turn. HTTP 429 is deliberately **not** included: rate limits should surface so the browser backoff handles them, rather than silently spending the much smaller Gemini daily quota.
- `web/api/index.js` — the streaming chat/personality connection now reports progress: when an external model starts producing output (`NIM / z-ai/glm-5.3-flash started typing.`) and when a step fails over (`NIM is slow or unreachable right now. Switching this step to Gemini; the full context is preserved.`).
- `web/tests/external-failover.test.mjs` — new coverage: SSE assembly and usage accounting, first-token watchdog, mid-stream idle timeout, non-streaming retry, Gemini failover, original-error surfacing without a fallback, 429 pass-through, and the unchanged Groq budget path.

## New environment variables

All optional; defaults in parentheses.

| Variable | Purpose |
| --- | --- |
| `EXTERNAL_FIRST_TOKEN_MS` (45000) | Abort a provider request that has produced no stream output within this time. Raise it if you would rather wait longer for cold-starting NIM models than fail over to Gemini. |
| `EXTERNAL_IDLE_MS` (45000) | Abort a stream that stops sending output mid-answer. |
| `EXTERNAL_TOTAL_MS` (120000) | Overall cap per provider call. Keep the default: one turn can chain several calls, and the /api/chat deadline is 270 seconds. |
| `EXTERNAL_STREAM` (true) | Set `false` to restore non-streaming provider requests everywhere. |

## Settings advice

- Keep **CORE AI** (the router) on `gemini-3.5-flash-lite`. It is a tiny JSON classification call; putting it on NIM doubles NIM latency per turn and doubles RPM consumption with no quality gain. Use "USE PERSONALITY MODEL" only if you accept that trade.
- With the personality layer on NIM and the router on Gemini, one casual turn costs one NIM call. At 40 RPM that is already plenty for personal use; council reviews and MIR verification are the multipliers to watch.
- The NIM reranker (`CAPRI_NVIDIA_RERANK`) has its own 8-second timeout and local fallback, so it cannot cause these delays; it requires `NVIDIA_FREE_ACCESS_CONFIRMED=true` (or a browser-saved key with free access confirmed) to run at all.

## If the limit itself is the blocker

- **GLM-5.3 Flash has a zero-cost path via OpenRouter** (`openrouter:z-ai/glm-5.3-flash:free`): implemented and wired as the everyday free GLM chain — see the next section. `OPENROUTER_API_KEY` needs no card, and `:free` models pass `freeAllowed()` without any extra confirmation flag.
- **GLM-5.3 Flash via Z.ai directly** (`zai:glm-5.3-flash`) is the same model on a different host, but it is **paid** (roughly $0.08/$0.25 per million input/output tokens, prepaid balance required). The 5.x "-Flash" suffix no longer means free; Z.ai's genuinely free API models are GLM-4.7-Flash, GLM-4.5-Flash and GLM-4.6V-Flash. Use the Z.ai path only if you accept a (small) balance top-up, and keep `ZAI_FREE_ACCESS_CONFIRMED` honest — it attests the account is on a non-billing tier.
- **DeepSeek V4.1 Flash** can run through DeepSeek's own API (`deepseek:deepseek-flash`); that provider is paid, so it requires `CAPRI_FREE_ONLY=false` plus a DeepSeek key.
- **Nemotron 3 Ultra** has no first-party alternative in the current adapter set; on the free NIM tier it will remain the most queue-prone choice (largest model). The first-token watchdog plus Gemini failover is the practical mitigation.
- A free-tier NIM rate-limit increase is not available; NVIDIA's guidance is a paid deployment for higher limits.

## Follow-up: free everyday GLM via OpenRouter

For a zero-budget setup, the everyday GLM no longer has to touch NIM (or Z.ai billing) at all.

**Setup:** set `OPENROUTER_API_KEY` in the environment (free to create, no card), keep `CAPRI_FREE_ONLY=true`, then pick **OpenRouter / GLM 5.3 Flash (free)** for the personality layer in Capri's settings. The model id is `openrouter:z-ai/glm-5.3-flash:free` — it passes the free-only gate by id, with no extra confirmation variable. With a key present, model discovery also imports the rest of OpenRouter's `:free` catalog automatically.

**Overflow chain** (in `externalStage`, `web/api/index.js`):

1. `openrouter:z-ai/glm-5.3-flash:free` — the everyday hop.
2. `nim:z-ai/glm-5.3-flash` — taken over automatically when OpenRouter fails, **including 429/402**. OpenRouter free endpoints share their quota with every other app on the platform, so rate limits there are routine, not emergencies — and the next hop is free, so overflowing is safe. This is a deliberate exception to the global rule that 429s surface to the browser; that rule stays in force everywhere else to protect the scarce Gemini quota.
3. Gemini fallback — only when both free hops fail, exactly as before, with the quota reserve and runtime-awareness metadata intact.

The NIM hop is conditional: if NIM is not ready (no key or free access unconfirmed), the free GLM falls back to Gemini directly, as before. The pipeline view says which hop answered (`started typing` progress) and why a switch happened.

**Rate-limit caveat:** OpenRouter's free endpoints are per-minute and per-day capped per account. One chat turn is several model calls (router, personality, optional MIR/council), so a day of heavy MIR-depth use can exhaust a free daily allowance faster than expected. When that happens the chain above absorbs it, but if free-GLM answers start consistently coming from NIM, that is the signal — either pace the deep modes or move the everyday GLM to a paid provider.

**What changed:**

- `web/lib/multi-provider.js` — `openrouter:z-ai/glm-5.3-flash:free` added to the hardcoded external model list (with a plain-language name); discovery already handled OpenRouter.
- `web/lib/provider-routing.js` — `generateWithOverflow` accepts a per-stage `failoverOn` predicate (default unchanged: `failoverUpstream`); `failoverUpstream` is exported.
- `web/api/index.js` — `externalStage` chains OpenRouter free GLM → NIM GLM → Gemini, with chain-aware progress messages.
- `web/.env.example` — documents the `:free` behavior next to `OPENROUTER_API_KEY`.
- `web/tests/external-failover.test.mjs` — new coverage: free-only gating for the new id, the 429 opt-in behavior, and the full three-hop chain in both the happy and exhausted paths.

## Vercel note

`web/vercel.json` sets `maxDuration: 300`, which requires a **Pro** plan. On the Hobby plan functions cap at 60 seconds regardless of this setting, so a 45-second first-token wait plus a long generation can be killed by the platform mid-turn. On Hobby, set `EXTERNAL_TOTAL_MS` to about 50000 and expect failovers to be more frequent. The 270-second in-app deadline already fits the Pro limit.

## Verification status

- Full `npm test --prefix web` suite: 187 passing, 1 pre-existing failure unrelated to this change ("Capri core is generated from the editable vault and stock settings migrate" — a CRLF/LF mismatch between `personality/Capricorn/01 Core/Always present.md` and the expected fixture; fix by normalizing line endings in that file or regenerating the core).
- No live NIM request was made from this fix: no NIM key is available in this environment. After deploying, verify with one short chat turn per NIM model and watch the pipeline view: you should see the `started typing` progress, and either the answer or an explicit Gemini failover message.

## Follow-up (Nov 2026): OpenRouter retired the free GLM — chains rebuilt on NIM

The `z-ai/glm-5.3-flash:free` variant on OpenRouter now bills tokens, so the
chain above no longer holds. The everyday free chain moved to NVIDIA NIM and
grew a multimodal leg — see **MULTIMODAL-FREE-CHAIN.md** for the full picture:

- **Text turns:** `nim:nvidia/nemotron-3-ultra-550b-a55b` → `nim:nvidia/nemotron-3-super-120b-a12b` → Gemini.
- **Attachment turns:** `nim:nvidia/nemotron-3.5-super-vl-120b-a12b` → `openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` → Gemini.
- The `openrouter:z-ai/glm-5.3-flash:free` entry stays registered (existing setups keep working if the id is still selectable on their account) but nothing depends on it anymore.
