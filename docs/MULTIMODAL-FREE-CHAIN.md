# Free multimodal chain: pictures, camera/screen and voice

*Status: implemented · November 2026 · zero-budget constraint (`CAPRI_FREE_ONLY=true`)*

After OpenRouter retired the `z-ai/glm-5.3-flash:free` variant, the everyday
free chain moved to NVIDIA NIM — and gained a full multimodal leg so Capri can
see pictures, accept camera/screen snapshots and take voice messages without
spending the scarce Gemini quota.

## Model map (all free)

| Role | Model id | Notes |
| --- | --- | --- |
| Text core (personality) | `nim:nvidia/nemotron-3-ultra-550b-a55b` | 550B-A55B agentic MoE; free NIM endpoint, ~40 RPM, no token billing |
| Text overflow | `nim:nvidia/nemotron-3-super-120b-a12b` | Same family, smaller; absorbs Ultra queues |
| Vision (pictures, camera/screen) | `nim:nvidia/nemotron-3.5-super-vl-120b-a12b` | VLM with ~1M context |
| Vision overflow | `openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | OpenRouter free endpoint; no card needed |
| Audio understanding | `nim:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | Images + video + speech + text in one loop |
| Voice transcription (primary) | Groq `whisper-large-v3-turbo` | Free tier: ~20 RPM, 14.4k requests/day, 28.8k audio-seconds/day |
| Last resort | Gemini (existing quota guard) | Only reached when every free hop fails |

Z.ai's genuinely free multimodal model (`glm-4.6v-flash`) remains available as
a manual selection; it is not part of the automatic chains because its text
quality trails the Nemotron family for the persona voice.

## Request flow

**Text turn:** selected external model (default `nim:nvidia/nemotron-3-ultra-550b-a55b`)
→ on failure/queue/429/402 → `nim:nvidia/nemotron-3-super-120b-a12b` → Gemini.

**Attachment turn (any inline image):** if the selected model cannot see, the
whole turn moves to the vision chain with the persona instructions intact:
`nim:nvidia/nemotron-3.5-super-vl-120b-a12b` → OpenRouter free Nano Omni →
Gemini. The pipeline view announces every hop.

**Voice message:** browser `MediaRecorder` (opus @ 24 kbps, ≤ 4 min) →
`POST /api/transcribe` → Groq `whisper-large-v3-turbo`; if Groq is down, wav/mp3
recordings fall back to NIM Nano Omni with an `input_audio` part. The
transcript lands in the composer text so it can be reviewed or edited before
sending; the persona turn itself stays a normal text turn (works with every
chat model, even text-only ones).

**Camera/screen:** `getUserMedia` / `getDisplayMedia` → single JPEG frame
(≤1600 px) → the normal attachment queue → the vision chain. "Live" is
frame-by-frame by design: free hosted APIs have no streaming video channel,
and the companion persona (not a perception sub-agent) must answer.

## Adapter changes (`web/lib/multi-provider.js`)

- Registry entries carry `vision` / `audio` flags; `supportsVision(id)` and
  `supportsAudio(id)` are exported for validators and stage routing.
- `externalGenerate` converts Gemini-style `inlineData` parts to
  OpenAI-compatible multimodal parts: images become `image_url` data URIs,
  wav/mp3 audio becomes `input_audio`. Text-only models keep plain string
  content and still reject media with a clear 400; PDFs remain Gemini-only.

## Chain changes (`web/api/index.js`)

- `TEXT_PRIMARY` / `TEXT_OVERFLOW` / `VISION_PRIMARY` / `VISION_OVERFLOW`
  replace the retired `FREE_GLM` / `NIM_GLM` constants.
- `externalStage` picks the vision chain automatically for attachment turns
  when the selected model is text only (progress message included).
- Free-hop failover accepts 429/402 in addition to `failoverUpstream`, exactly
  like the previous GLM chain; Gemini stays quota-guarded behind both hops.

## Settings defaults (`web/lib/core-settings.js`)

The default personality model is now `nim:nvidia/nemotron-3-ultra-550b-a55b`.
Router/reasoning/analyzing stay on `gemini-3.5-flash-lite`: those stages emit
strict JSON and run several times per turn, so they should not consume the
40-RPM NIM budget. Existing saved settings are untouched; switch in
**CORE SETTINGS** once.

## Environment

- `NVIDIA_API_KEY` + `NVIDIA_FREE_ACCESS_CONFIRMED=true` — drives both NIM chains.
- `GROQ_API_KEY` + `GROQ_FREE_TIER_CONFIRMED=true` — drives voice transcription.
- `OPENROUTER_API_KEY` — only the vision overflow hop; the key needs no card.

## Limits to keep in mind

- NIM free tier: ~40 requests/minute per account (largest model, most queue-prone).
- The `/api/transcribe` body caps audio at about 3 MB (Vercel serverless body
  limit); 24 kbps opus ≈ 20 minutes inside that envelope.
- Groq whisper: ~20 RPM / 14.4k RPD / 28.8k audio-seconds per day.
- OpenRouter free variants can be retired at any time; the vision overflow is
  optional and its failure simply hands the turn to Gemini.

## Tests

`web/tests/multimodal-chain.test.mjs` covers: capability flags, image →
`image_url` conversion, wav → `input_audio` on omni models only, text-only
rejection (no network call), quick-chat attachment validation, Groq
transcription, the NIM Omni fallback, and the clean 503/400/413 paths.
