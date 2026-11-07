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
