Your goal is to help me fully transition this program away from Gemini API usage and over to using LM Studio’s OpenAI-compatible API instead. There are a few specific things that need to be addressed as part of this transition. Please read carefully, as your first task is to produce a clear, itemized implementation plan that can be checked off step by step. Then proceed to implement each item, marking it off as you go.

⸻

✅ Requirements and Adjustments
	1.	Disable Authentication for Now (Don’t Remove It)
	•	Any code related to authentication with Google or Gemini should be disabled but not deleted.
	•	This includes OAuth flows, token validation, and credential handling.
	•	It should be easy to reactivate this code later when needed.
	2.	Update Display of Model Info
	•	On the CLI, instead of defaulting to "Gemini 2.5 Pro" and a hardcoded context percentage:
	•	Dynamically query LM Studio’s API (using /v1/models if available) to retrieve:
	•	Model name (e.g., "TheBloke/Mistral-7B-Instruct-v0.1-GGUF")
	•	Context length (e.g., 4096 tokens)
	•	Display this live information at startup in the UI.
	3.	Rename GEMINI.md to AIFA.md
	•	Rename all instances of GEMINI.md to AIFA.md, including:
	•	Filenames
	•	References in code
	•	Load logic at startup
	•	Ensure the program now looks for AIFA.md on startup.
	4.	Handle Streaming Completion Differences
	•	Analyze and account for differences between Gemini’s streaming behavior and LM Studio’s (OpenAI-compatible) streaming.
	•	Ensure the program:
	•	Correctly detects the end of the stream via finish_reason or stream termination.
	•	Doesn’t cut off completions prematurely.
	•	Works across edge cases like short responses, abrupt ends, or streams with formatting (markdown, newlines, etc.).
	•	Consider adding logging or diagnostic output (even if temporary) to confirm proper stream handling.

⸻

📋 First Task: Create a Fix Plan

Before doing any coding, return a numbered fix implementation plan that:
	•	Covers each of the four areas above
	•	Breaks each into logical implementation steps
	•	Can be checked off as work is completed

Use that list to guide the changes. After the plan is accepted, begin implementation one task at a time, clearly indicating when each task is complete.