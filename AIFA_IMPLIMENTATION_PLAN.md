A is for Agent CLI (AIFA)

AIFA is a terminal-first, vendor-agnostic AI agent that keeps all the power-user ergonomics of modern dev CLIs while removing cloud lock-in. It runs fully local by default, speaking an OpenAI-compatible API so it can drive models served by LM Studio (or any compatible server), and it preserves a rich tool ecosystem (filesystem, shell, web fetch/search, multi-file reads, memory, sandboxing).

Why this fork exists
	•	Local-first: Use powerful LLMs on your own machine for privacy, speed, and cost control.
	•	No Google auth: All Google/Gemini authentication flows are removed; AIFA talks to a local OpenAI-style endpoint instead.
	•	Same great UX: Keep the TUI, tools, confirmations, and sandboxing you’re used to—just swap the model backend.
	•	TDD from the ground up: Every feature and refactor lands with tests (unit, integration, and mocked end-to-end).

What AIFA does
	•	Chat and agent workflows with function/tool calling.
	•	Streaming outputs (text deltas) with robust streamed tool-call assembly (multi-tool aware).
	•	Rich built-in tools: read/write files, run shell commands (guarded), web fetch/search, read many files, memory notes.
	•	Sandboxing options (Seatbelt/containers) to keep tool execution contained.
	•	Configurable via project/user settings, env vars, and flags.

What changed vs. upstream
	•	✂️ Removed: Google/Gemini auth and direct Gemini API calls.
	•	🔌 Added: OpenAI-compatible provider targeting http://localhost:1234/v1 by default (LM Studio).
	•	🧠 Added: Streamed tool_call accumulation (handles partial JSON over SSE).
	•	🩺 Added: First-run health checks (/v1/models) and a /models command for discoverability.
	•	🛡️ Added: Better error surfacing and auto-truncation of large tool results to protect context.
	•	🪶 Optional: Fetch-only transport (no SDK) for lighter builds.
	•	👁️ Optional: Vision/content mapping to OpenAI content arrays, with graceful degradation.

Audience

Developers, power users, and ops folks who want a fast, local, scriptable agent with strong ergonomics, minimal external dependencies, and clear security boundaries.

Design principles
	•	Local by default; remote optional.
	•	Small surface, sharp edges: explicit confirmations for sensitive tools.
	•	Predictable config: env → project settings → user settings → flags (documented precedence).
	•	TDD discipline: red → green → refactor; tests are non-negotiable.

Non-goals
	•	Cloud account management or remote auth flows.
	•	Feature parity with every proprietary multimodal feature; AIFA favors pragmatic, portable mappings.

Quick start (local)

# Start LM Studio and enable the OpenAI server on port 1234 with a loaded model.
export OPENAI_API_BASE=http://localhost:1234/v1
export OPENAI_API_KEY=lm-studio       # any non-empty string works for LM Studio
export OPENAI_MODEL=<your-model-id>   # e.g., qwen2.5-coder

# Run the CLI (after building/instaling AIFA)
aifa -p "Hello, AIFA!"

Naming & files: This fork uses AIFA throughout. Docs and helper files use AIFA.md (not GEMINI.md), and commands/help text reference “A is for Agent CLI (AIFA)”.

⸻

Epic: A is for Agent CLI - Vendor-agnostic LLM core + Ollama\LM Studio (OpenAI-compatible) backend

High-level milestones
	1.	Baseline & safety net
	2.	Provider abstraction (no behavior change)
	3.	OpenAI-compatible provider (SDK + optional fetch transport)
	4.	Streaming tool-call handling (critical)
	5.	Health checks, API key enforcement, /models command
	6.	Error handling + tool result truncation
	7.	Remove Google auth; CLI polish
	8.	Vision/content mapping (optional)
	9.	E2E coverage (mocked) + docs & release

⸻

0) Baseline & project switches

Branching
	•	feat/provider-abstraction → feat/openai-compatible → feat/stream-toolcalls → feat/health-and-models → feat/errors-and-truncation → feat/remove-google-auth → feat/vision-mapping → qa/e2e.

Ground rules
	•	Tests first (red → green → refactor).
	•	Keep commits small and reversible.
	•	Gate every milestone with acceptance criteria.

Initial tasks
	•	Fork/clone.
	•	Run the repo’s existing tests; add two smoke tests for the CLI:
	•	REPL banner snapshot.
	•	/help snapshot.

⸻

1) Provider abstraction (no behavior change)

Goal: decouple Core from any vendor.

Code
	•	Add packages/core/src/llm/LlmProvider.ts with a simple chat() contract (supports messages, tools, streaming hooks).
	•	Implement GoogleGeminiProvider adapter that wraps the current implementation (temporary).
	•	In Core, replace direct calls to Gemini with LlmProvider.chat().

Tests (write first)
	•	Unit: Core tool loop using a FakeProvider that:
	•	turn 1 → returns a toolCall; after tool response is appended,
	•	turn 2 → returns final text.
	•	Unit: GoogleGeminiProvider adapter returns the unified { text, toolCalls } shape (mock Gemini transport).

Done
	•	All existing behavior intact; green tests.

⸻

2) OpenAI-compatible provider (LM Studio)

Goal: talk to http://localhost:1234/v1 with OpenAI-style API.

Code
	•	OpenAICompatibleProvider (SDK transport). Env:
	•	OPENAI_API_BASE=http://localhost:1234/v1 (default),
	•	OPENAI_API_KEY=lm-studio (required),
	•	OPENAI_MODEL=<model-id>.
	•	providerFactory chooses provider by LLM_PROVIDER=openai-compatible (default).

Tests (first)
	•	Unit: builds correct messages[], tools[], tool_choice and sends headers (Authorization).
	•	Unit: parses non-stream response (message.content, message.tool_calls).

Done
	•	Core can switch providers via env; no CLI changes yet.

⸻

3) Critical: full streaming tool-call handling

Goal: handle text deltas and streamed tool_call fragments.

Code
	•	In OpenAICompatibleProvider, for streaming:
	•	Maintain textBuf.
	•	Maintain a per-index accumulator { id?, name?, argsSrc }.
	•	For each SSE chunk:
	•	append delta.content → emit onDelta({text}).
	•	append delta.tool_calls[n].function.arguments to that index’s argsSrc; update id/name if present.
	•	On EOS: parse each argsSrc into JSON; return { text, toolCalls } via onDone.

Core
	•	If stream ends with toolCalls, stop rendering, execute tools, append tool messages, then call provider again for the final assistant message.

Tests (first)
	•	Unit: interleaved text + two tool calls streamed across many chunks → finalizes both with correct JSON.
	•	Unit: ensures order by tool index.

Done
	•	Multi-tool streaming works without “incomplete JSON” errors.

⸻

4) High: health checks, API key enforcement, /models

Goal: great first-run UX.

Code
	•	Enforce OPENAI_API_KEY at provider init (dummy values allowed).
	•	Add listModels() in provider (GET /v1/models).
	•	CLI bootstrap: on first run (unless --no-check), call listModels():
	•	If none found → print friendly guide (“Start LM Studio → Developer → Start Server; load a model”).
	•	Show top 5 models and highlight OPENAI_MODEL if set.
	•	Add /models command to list models; optionally /model set <id> to persist.

Tests (first)
	•	Unit: models 200 → IDs returned; 401/404/500 → helpful errors.
	•	CLI: /models snapshot; /model set updates setting.

Done
	•	Users can discover and select models easily; missing key/server is obvious.

⸻

5) High: error handling & truncation

Goal: resilience against malformed tool args, big tool outputs, server hiccups.

Code
	•	safeParseJson() with light “brace-balancing” repair and enriched error messages (include a truncated source preview).
	•	Tool result truncation before sending back to the model:
	•	TOOL_RESULT_TOKEN_LIMIT=1000 (≈ char heuristic *4).
	•	TOOL_RESULT_CHAR_LIMIT=4000.
	•	Annotate: "[...truncated N chars]".
	•	Uniform LlmProviderError carrying status, endpoint, and a tip (e.g., “Ensure a model is loaded”).

Tests (first)
	•	Bad JSON fragments → repaired → OK.
	•	Still-bad JSON → throws with preview.
	•	Huge tool output → truncated and annotated.
	•	Non-2xx from /chat → error includes status + tip.

Done
	•	No crashes; context stays bounded.

⸻

6) Medium: optional fetch transport (lighter builds)

Goal: no SDK dependency if desired.

Code
	•	OpenAICompatibleFetchProvider with fetch + manual SSE line parsing (\n\n framed data: lines).
	•	Env: LLM_TRANSPORT=fetch|sdk (default sdk).
	•	Reuse the same accumulation code as in SDK path.

Tests (first)
	•	Parity: request body (messages/tools/tool_choice) matches SDK snapshot.
	•	Streaming: multi-tool case finalizes correctly.

Done
	•	Either transport passes the same suite.

⸻

7) Medium: remove Google auth; CLI polish

Goal: de-Google the UX while keeping all features.

Code
	•	Remove OAuth/Vertex/API-key Gemini code & deps.
	•	/auth command:
	•	Either remove from /help, or keep as a no-op that prints:
“This fork uses a local OpenAI-compatible server. Set OPENAI_API_KEY and (optionally) OPENAI_MODEL. Try /models.”
	•	First-run banner: show base URL, key presence, top 5 models.

Tests (first)
	•	CLI help no longer lists Google auth commands (or shows no-op text).

Done
	•	No Google references remain; first-run is self-explanatory.

⸻

8) Low: vision/content “parts” mapping (optional)

Goal: handle images when available; degrade gracefully otherwise.

Code
	•	Map internal “parts” → OpenAI content arrays:
{type:"text",text} and {type:"image_url", image_url:{url: data:<mime>;base64,<...>}}.
	•	If model/server rejects multimodal, print a gentle hint and fall back to text-only behavior.

Tests (first)
	•	Parts mapping unit tests; degrade-to-text snapshot.

Done
	•	Vision works where models support it; otherwise harmless fallback.

⸻

9) Broad E2E (mocked) + docs & release

Goal: high confidence without requiring a live server in CI.

Code/Tests
	•	Use MSW (or similar) to mock:
	•	GET /v1/models (happy + error).
	•	POST /v1/chat/completions (non-stream & stream fixtures, incl. multi-tool).
	•	E2E scenarios:
	•	“List files then count them” → two tool calls → final assistant summary.
	•	Abort mid-stream (Ctrl-C) → clean cancellation via AbortController.
	•	Parameter passthrough (temperature/top-p) snapshot.

Docs
	•	README quick start (2 steps): Start LM Studio server → run CLI with env.
	•	Troubleshooting table (401/404, “model not loaded”, malformed stream).
	•	Config matrix (env vars, flags, settings.json precedence).

Done
	•	CI green; docs ready; tagged release of your fork.

⸻

Configuration quick sheet

export LLM_PROVIDER=openai-compatible
export LLM_TRANSPORT=sdk            # or fetch
export OPENAI_API_BASE=http://localhost:1234/v1
export OPENAI_API_KEY=lm-studio     # any non-empty string is fine
export OPENAI_MODEL=qwen2.5-coder   # replace with a loaded model id

# Optional safeguards
export TOOL_RESULT_TOKEN_LIMIT=1000
export TOOL_RESULT_CHAR_LIMIT=4000


⸻

Acceptance checklist (copy/paste)
	•	CLI starts without Google auth prompts; health check runs; shows model list.
	•	/models works; /model set <id> (if implemented) persists choice.
	•	Streaming with two+ tool calls completes (no partial JSON).
	•	Oversized tool output is truncated and annotated.
	•	SDK and fetch transports pass the same tests.
	•	Vision parts map or degrade gracefully.
	•	E2E: chat + tools + stream + abort + error branches covered.
	•	Docs: quick start + troubleshooting + config precedence.