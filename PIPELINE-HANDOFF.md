# Pipeline changes and rollout

Local changes, not deployed. No production database migration was applied.

## Audit and implementation

| Area | Before | Current |
|---|---|---|
| CORE AI | Two routing paths; conversational routing included personality and its passages | Compact routing inputs; personality isolated from routing; malformed decisions fall back; CORE AI labels in UI/logs. Legacy `router` settings key retained for compatibility |
| History | Up to 160k characters | Server-side configurable `max_history_tokens`, default 3000; oldest messages removed; research gets history only on request; research CORE AI can request a summary |
| Caching | Runtime snapshot appended to system prompt | Runtime snapshot moved to trailing content; static system prefix preserved |
| Conditional retrieval | Routing and signed follow-up cache already existed | Preserved; final personality stage no longer starts factual retrieval or receives raw notes |
| Storage/search | Separate chunks, optional pgvector, keyword search, reranking already existed | Preserved; optional prepared chunk index added behind `ENABLE_PREPARED_SEARCH=true` |
| Note preparation | Missing | Windowed JSON preparation, exact-source/coverage/number checks, retry, fallback, content-hash reuse, unclear counts, resumable embedding tool |
| Evidence limits | 18k characters plus omitted-source metadata | Serialized evidence capped at approximately 2500 tokens, max eight chunks; exact duplicates removed; citations retain IDs |
| Logging | Per-call usage already existed | CORE AI decisions and per-chunk estimates added |
| Visualizer | Missing | Per-message Pipeline view in token menu; saved call path, models, components, totals, Replay and speed control |

## Verification

- Full automated suite: 180 passing before final provider recovery adjustment; focused provider/budget/reminder checks: 15 passing.
- Prepared-index SQL compiled using PGlite with pgvector.
- Browser check passed for persisted pipeline stages and replay speed.
- Older workspace browser fixture stalled at loading overlay; full application browser verification is not complete.
- Procedure lookup fixture: evidence decreased from **4460 to 2134 estimated tokens**, four chunks. UTF-8 bytes / 4 estimate, not measured provider billing. This is evidence payload, not total multi-call consumption or a reproduction of the reported 20–70k request.
- Live three-note preparation pilot could not start: Google rejected the local Gemini API key. No claim of reviewed AI preparation quality or successful re-embedding.

## SQL and re-embedding

Run `web/supabase/migrations/20261108032735_prepared_chunks.sql` once in the Supabase SQL editor. It creates a separate owner-protected prepared index; it does not modify original notes or legacy chunks.

Set a valid `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and a current owner `SUPABASE_ACCESS_TOKEN` in the local environment. The last is the signed-in user's access token, not a service-role key. Never commit credentials.

Preview five notes without publishing embeddings:

```powershell
node --env-file=web/.env.local tools/prepare-rag-notes.mjs --limit=5
```

Review ignored local `artifacts/rag-preparation/*.json`: original/clarified pairs, every number, omitted/added meaning, fallback and unclear flags. Once quality is acceptable:

```powershell
node --env-file=web/.env.local tools/prepare-rag-notes.mjs --apply --limit=100000
```

Repeated runs reuse unchanged preparation and saved embeddings. Edited notes require rerunning this tool; automatic background preparation on every save is not installed. Enable `ENABLE_PREPARED_SEARCH=true` and `ENABLE_SEMANTIC_SEARCH=true` only after indexing the desired notes. Prepared search returns no weak vector match below 0.5. Before then leave the flags off to preserve legacy search. Roll back by disabling the prepared-search flag; original notes and old chunks remain.

## Provider/reminder findings

- Live Supabase reminder functions and authenticated EXECUTE permissions exist. Historical `aria_reminder_save` requests returned HTTP 400; the precise original validation message is unavailable. The old generic migration error concealed it.
- Database errors now expose safe validation reasons or HTTP/code diagnostics. Saving reminders no longer waits on notification generation, avoiding a model-delay race for near-term reminders. Notification text now uses the reminder itself.
- NIM model catalog confirmed `deepseek-ai/deepseek-v4.1-flash` and `z-ai/glm-5.3-flash`. GLM passed a live completion (HTTP 200, 107 tokens); first DeepSeek probe timed out after 45 seconds, but the final app-adapter probe succeeded with OK and 53 tokens after explicitly enabling the existing free-access gate for that probe. Both models are reachable; intermittent provider latency remains possible.
- Provider errors include model/status, redacted error detail and Retry-After. Empty length-limited responses now reach bounded output recovery rather than immediately failing. Both NIM IDs are available without successful catalog discovery. Z.AI credential saving now accepts the provider shown in the UI.
- Local server NIM key exists but `NVIDIA_FREE_ACCESS_CONFIRMED` was not enabled; browser-saved credentials have their own confirmation. Check this when using the server key. No paid fallback was silently enabled.
- Direct DeepSeek alternative: `deepseek:deepseek-flash` is documented as V4.1-Flash-1017. Requires a DeepSeek key and paid access enabled (`CAPRI_FREE_ONLY=false`). Z.AI is another independent provider for GLM, with its own key/plan; exact availability depends on that account.

## Remaining gaps (do not treat these as finished)

- Live preparation quality review, full re-embedding, deployed end-to-end measurements and rollout remain pending.
- Near-duplicate semantic deduplication, adjacent-chunk merging, and agent-controlled neighbor fetching are not wired into the new prepared search. Legacy section expansion exists separately.
- CORE AI does not yet execute a general multi-agent task DAG; replay visualizes observed calls and route decisions, not hidden reasoning or a full task decomposition.
- Long-input summarization is limited by existing 4000-character message validation and capped supplied history. The conversational routing path's summary flags are not yet used to perform a second context-expansion pass.
- Local estimates are not model-specific tokenizer counts. Existing reranker/hybrid behavior was retained rather than rebuilt; no new extractor or summary index was added.

Deferring additional reranking, metadata filters, extractors and summary indexes is sensible until measured retrieval accuracy warrants them. Chunking and strict payload budgets should be evaluated first.
