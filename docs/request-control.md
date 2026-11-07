# Model routing and stopping chat work

The default profile uses Gemini for the initial conversation decision, analysis,
and research. GPT-OSS handles smaller personality rewrites. Saved copies of the
old stock Groq routing choice migrate to Gemini when settings load; custom model
choices are preserved. The settings dialog can apply the personality model to
all four stages and disable council calls in one click.

Before sending a Groq stage, the server estimates input size conservatively and
includes the requested output allowance. The default budget is 7,000 estimated
tokens, configurable with `GROQ_REQUEST_TOKEN_BUDGET`. This is a guard, not a
tokenizer or a guarantee of provider acceptance. An oversized stage, or a real
Groq HTTP 413, uses the selected Gemini reasoning model (or the default Gemini
planner) once. It requires the existing Gemini credentials, free-tier
confirmation, and a successful quota reservation. The original request,
instructions, history, and source identifiers are passed unchanged. There is no
new summary pipeline, chunk omission, or repeated Groq 413 retry. Usage records
name the actual model. Without configured Gemini access, the stage fails clearly
with 413 instead of dropping context.

Saving settings invalidates the pending turn's old routing decision and
checkpoint. Resume also checks settings so it cannot silently use an older
model selection. Saved chat messages remain intact.

**Stop all** aborts active browser chat requests, clears queued input, retries,
continuations, and undelivered replies, and calls authenticated `/api/stop`.
The server aborts the owner's active chat/personality controllers. Their database
reads, Gemini/Groq/Claude calls, embeddings, and quota waits inherit cancellation;
later phases cannot start. Disconnects also cancel the original server request.
New messages can start fresh after cancellation completes.

The server registry is process-local: `/api/stop` cancels chat work in the server
instance that receives it, while browser disconnects cancel its own original
requests. This is not a distributed kill switch for other instances/devices,
scheduled reminder workers, or already accepted provider work. Saved actions
are not rolled back. A deployment requiring an account-wide distributed stop
needs shared cancellation state and worker coordination.

Verification: `node --test web/tests/*.test.mjs` (173 passed), plus
`node web/tests/stop-browser.mjs` for stream cancellation, cleared queues,
all-stage model changes, and reload behavior. Provider calls use fixtures in
these tests; live provider limits and quality were not measured.

## Compact personality context and runtime status

Speaking stages retain the full configured personality instructions. Retrieval
planning stages receive retrieval instructions instead of the speaking persona.
The latest message is sent once in `currentMessages`, including reply quotes;
the preceding reply remains in the unchanged conversation history. Factual
drafts and citation maps are preserved.

Runtime personality cards remove repeated, known editorial sections and whole
paragraphs already present in the configured core. Substantive guidance,
examples, source attribution, corrections, hashes, and unknown/custom sections
remain. Shared limitations are stated once. The vault records and retrieval
ranking are unchanged; this is extractive formatting, not an AI summary.

The short debugging fixture fell from approximately 5,775 input tokens to 4,002,
or 4,184 including the new runtime snapshot (UTF-8 byte estimates). Actual model
tokenization, conversation lengths, and retrieved notes vary. This does not
establish a measured improvement in live personality quality.

The server supplies the actual model, phase, selected role models, web/memory/
council settings, and the latest request failure's status/model/phase. Overflow
replaces the model identity with the actual fallback. Recent failures expire
after 30 minutes and are held only in the current server process. No secrets,
raw upstream error bodies, account balances, logs, or hidden reasoning are
provided. Capri should discuss this snapshot when relevant, not recite it.

Failed chat turns display a deterministic conversational error bubble without
making another provider call. Retries update the same bubble; Resume and Stop
remain available. Token details now show per-model input/output totals and
separate personality-reference estimates. These are completed calls for that
reply, not account-wide NVIDIA usage or quota remaining.

Verification for this revision: 177 automated tests passed; the browser test
also passed in-chat errors and Resume, Stop, queue clearing, and model changes.

The reviewed NVIDIA RAG Blueprint suggests hybrid retrieval and optional
reranking as a future measured improvement. Hosted retrieval endpoints can be
used independently of its full deployment. No new NVIDIA embedding/reranking
service, vector database, reflection pass, or multimodal ingestion deployment
was enabled by this revision.
