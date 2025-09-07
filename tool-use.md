Absolutely—here’s a side-by-side of what the model’s own output looks like when it decides to call a tool, plus what you send back.

OpenAI ⇄ your app

Model emits a tool call (Chat Completions / Responses style):

{
  "role": "assistant",
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "get_weather",
        "arguments": "{\"city\":\"Perth\",\"unit\":\"c\"}"
      }
    }
  ]
}

	•	Note the arguments is a JSON string, often streamed in chunks you concatenate.  ￼

You return the tool result to the model:

{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "{\"temp_c\":18.2}"
}

	•	The reply is a tool message keyed by tool_call_id. (Same idea applies in the newer Responses/Conversations flow, which stores tool calls/outputs as items.)  ￼

Google Gemini ⇄ your app

Model emits a function call inside content parts:

{
  "candidates": [{
    "content": {
      "parts": [{
        "functionCall": {
          "name": "get_weather",
          "args": { "city": "Perth", "unit": "c" }
        }
      }]
    }
  }]
}

	•	Here args is a structured object (not a JSON string).  ￼

You return the function result as a part:

{
  "role": "user",
  "parts": [{
    "functionResponse": {
      "name": "get_weather",
      "response": { "temp_c": 18.2 }
    }
  }]
}

	•	Gemini uses a functionResponse part, typically appended after the model’s functionCall; JS/Live examples show wrapping it in a role: "user" turn.  ￼

What’s different “in-line”?
	•	Arguments encoding
	•	OpenAI: function.arguments is a JSON string you must parse/validate. Streaming sends partial substrings.  ￼
	•	Gemini: functionCall.args is already a typed object.  ￼
	•	Where the call appears
	•	OpenAI: In a message’s tool_calls array (one or many). You answer with a role: "tool" message referencing tool_call_id.  ￼
	•	Gemini: In content.parts[].functionCall. You answer with a functionResponse part (name + response); no call ID.  ￼
	•	Forcing calls / schema guarantees (config)
	•	OpenAI: tool_choice controls whether/which tools can be called; parallel calls supported.  ￼
	•	Gemini: function_calling_config.mode = AUTO | ANY | NONE; ANY forces a call and (per docs) guarantees schema adherence; you can also limit with allowed_function_names.  ￼

Here are copy-paste Node.js snippets that show the full function/tool-calling loop for OpenAI and Gemini, including how to parse the model’s call, run your code, and feed the result back.

⸻

OpenAI (Chat Completions, Node)

import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 1) Declare your tool (JSON Schema)
const tools = [{
  type: "function",
  function: {
    name: "get_weather",
    description: "Get current temperature",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string" },
        unit: { type: "string", enum: ["c", "f"], default: "c" },
      },
      required: ["city"]
    }
  }
}];

// Example function your app actually runs
async function get_weather({ city, unit = "c" }) {
  return { city, unit, temp: 18.2 }; // mock
}

// 2) Ask the model; let it decide to call tools
const messages = [
  { role: "system", content: "Be concise." },
  { role: "user", content: "Weather in Perth in c?" }
];

const first = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
  tools,
  tool_choice: "auto",            // "none" | "auto" | "required" | { type:"function", function:{name:"..."} }
  parallel_tool_calls: true        // allow multiple tool calls
});

// 3) Detect tool calls, run them, return results to the model
const toolCalls = first.choices[0].message.tool_calls ?? [];
for (const call of toolCalls) {
  if (call.type === "function" && call.function?.name === "get_weather") {
    const args = JSON.parse(call.function.arguments || "{}"); // NOTE: args is a JSON STRING
    const result = await get_weather(args);
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(result)
    });
  }
}

// 4) Ask again for the final, user-friendly answer
const final = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
  tools
});

console.log(final.choices[0].message.content);

	•	OpenAI places calls in message.tool_calls[]; you reply with a role: "tool" message that includes the original tool_call_id. Also, function.arguments arrives as a JSON string, so JSON.parse it.  ￼

(Optional) Streaming: reconstructing arguments

const stream = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages,
  tools,
  stream: true
});

const ids = {};
const names = {};
const argBuf = {}; // index -> string buffer

for await (const chunk of stream) {
  const delta = chunk.choices?.[0]?.delta;
  if (!delta) continue;

  // Tool call deltas arrive as partial strings
  for (const [i, tc] of (delta.tool_calls ?? []).entries()) {
    if (tc.id) ids[i] = tc.id;
    if (tc.function?.name) names[i] = tc.function.name;
    if (tc.function?.arguments) argBuf[i] = (argBuf[i] || "") + tc.function.arguments;
  }
}

// When stream ends, parse:
const calls = Object.keys(argBuf).map(i => ({
  id: ids[i],
  name: names[i],
  args: JSON.parse(argBuf[i] || "{}")
}));

OpenAI streams function-call arguments as incremental substrings; buffer then JSON.parse.  ￼

⸻

Google Gemini (JS with @google/genai)

import { GoogleGenAI, Type, FunctionCallingConfigMode } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// 1) Function declaration (OpenAPI-style subset)
const getWeatherDecl = {
  name: "get_weather",
  description: "Get current temperature",
  parameters: {
    type: Type.OBJECT,
    properties: {
      city: { type: Type.STRING },
      unit: { type: Type.STRING, enum: ["c", "f"] }
    },
    required: ["city"]
  }
};
const tools = [{ functionDeclarations: [getWeatherDecl] }];

async function get_weather({ city, unit = "c" }) {
  return { city, unit, temp: 18.2 }; // mock
}

// 2) Ask the model (you can force calls with ANY; limit names if you like)
const config = {
  tools,
  toolConfig: {
    functionCallingConfig: {
      mode: FunctionCallingConfigMode.AUTO,          // AUTO | ANY | NONE
      // allowedFunctionNames: ["get_weather"],      // optional limit
    }
  }
};

let contents = [
  { role: "user", parts: [{ text: "Weather in Perth in c?" }] }
];

const first = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents,
  config
});

// 3) Read function calls (args are already OBJECTS), run them
const calls = first.functionCalls ?? [];
const results = await Promise.all(
  calls.map(c => get_weather(c.args))
);

// 4) Append the model turn + your functionResponse parts (same order!)
contents.push(first.candidates[0].content);
for (let i = 0; i < calls.length; i++) {
  contents.push({
    role: "user",
    parts: [{ functionResponse: { name: calls[i].name, response: results[i] } }]
  });
}

// 5) Final response
const final = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents,
  config
});
console.log(final.text);

	•	Gemini returns calls as response.functionCalls[] with structured args objects (no JSON-string parsing). You feed results back as a functionResponse part and should include them in the same order they were requested. You can control behavior with functionCallingConfig.mode = AUTO | ANY | NONE and optionally allowedFunctionNames.  ￼

⸻

Key diffs to remember
	•	Arguments encoding: OpenAI → string you must parse (and reconstruct when streaming). Gemini → plain object.  ￼ ￼
	•	Reply shape: OpenAI → role:"tool" + tool_call_id. Gemini → parts: [{ functionResponse: { name, response } }].  ￼ ￼
	•	Control knobs: OpenAI tool_choice + parallel_tool_calls; Gemini functionCallingConfig.mode (AUTO/ANY/NONE) + allowedFunctionNames.  ￼ ￼