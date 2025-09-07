# AIFA CLI OpenAI Function Calling Debug Summary

## Original Problem
The AIFA CLI fails to pass tools/functions to LM Studio when using the OpenAI-compatible provider. Tools like `GoogleSearch` and `WebFetch` should be available but aren't being sent to the LM Studio model, resulting in the model not being able to make function calls.

**User's Evidence:**
- LM Studio logs show no function definitions are received by the model
- Model reasoning indicates it knows it needs tools but has none available
- Commands like `Search google for restaurants in Perth` fail to trigger tool usage

## Key Discoveries

### 1. **OpenAI Provider IS Being Used**
- ✅ `OpenAICompatibleProvider` constructor is called successfully
- ✅ `LlmProviderContentGeneratorAdapter` is created correctly  
- ✅ LM Studio model is detected and set: `openai/gpt-oss-120b`
- ✅ Provider creation happens during config initialization

### 2. **Config Initialization Error Blocks Execution**
- ❌ CLI fails with `[API Error: Config was already initialized]` 
- ❌ This prevents `runNonInteractive()` from being reached
- ❌ No actual tool requests are made to LM Studio because execution stops

### 3. **Execution Path Analysis**
When using `-p "prompt"` flag:
1. Main `gemini.tsx` calls `config.initialize()` (line 263)
2. OpenAI provider setup happens successfully
3. **ERROR OCCURS HERE** - Config already initialized error
4. `runNonInteractive()` is never called
5. No tools are passed because no requests are made

### 4. **Debug Logging Added Throughout Pipeline**
- ✅ Added debug logs to `OpenAICompatibleProvider.chat()` method
- ✅ Added debug logs to `LlmProviderAdapter.generateContent()` 
- ✅ Added debug logs to `GeminiChat.sendMessageStream()`
- ✅ Added debug logs to `Turn.run()` and `Client.sendMessageStream()`
- ❌ None of these debug messages appear because execution stops early

## Attempted Fixes

### 1. **Made config.initialize() Idempotent**
```typescript
// Changed from throwing error to returning early
async initialize(): Promise<void> {
  if (this.initialized) {
    console.debug('[Config] Already initialized, skipping');
    return; // Instead of throwing error
  }
  // ... rest of initialization
}
```
**Result:** Error persists, suggesting another source

### 2. **Skip refreshAuth for OpenAI when AIFA_SKIP_AUTH=true**
```typescript
if (process.env['AIFA_SKIP_AUTH'] !== 'true') {
  await config.refreshAuth(AuthType.USE_OPENAI_COMPATIBLE);
}
```
**Result:** Error still occurs before this code is reached

### 3. **Enhanced Error Handling in nonInteractiveCli**
- Added try-catch around `config.initialize()` call
- Fixed TypeScript type issues with `PartListUnion`
**Result:** Never reaches `runNonInteractive()` execution

## Current State

### Working Components:
- ✅ OpenAI provider creation and initialization
- ✅ LM Studio model detection and setup
- ✅ Tool definitions exist in codebase
- ✅ LM Studio server supports function calling (verified with standalone test)

### Blocking Issue:
- ❌ `[API Error: Config was already initialized]` prevents CLI execution
- ❌ Error source unclear - not found in current codebase after fixes
- ❌ Tools never reach LM Studio because no requests are made

## Debug Execution Pattern
```
🔌 Using OpenAI-compatible provider from AIFA_DEFAULT_API environment variable
🎯🎯🎯 createContentGenerator called!
🚀🚀🚀 OpenAICompatibleProvider constructor called!
🔧🔧🔧 LlmProviderAdapter constructor called!
🚀🚀🚀 OpenAICompatibleProvider constructor called! (second time)
🎯 Using LM Studio model: openai/gpt-oss-120b
[API Error: Config was already initialized]
```

**Missing Messages (never appear):**
- Main config initialization debug messages from `gemini.tsx`
- `runNonInteractive` entry messages
- Any actual tool passing or LM Studio request logs

## Recommended Next Steps

### Immediate Priority
1. **Identify the true source of "Config was already initialized" error**
   - Error persists despite making `config.initialize()` idempotent
   - May be coming from different component or cached/compiled code
   - Use `test-openai-tools.js` to test provider directly

2. **Alternative approaches to bypass config issue:**
   - Test OpenAI provider functionality outside CLI context
   - Use interactive mode instead of `-p` flag
   - Investigate different auth setup that avoids double initialization

### Tool Integration Verification
3. **Once execution reaches nonInteractiveCli, verify:**
   - Tools are included in `SendMessageParameters.config.tools`
   - `LlmProviderAdapter.convertTools()` properly converts tool format
   - `OpenAICompatibleProvider.convertToOpenAIRequest()` includes functions
   - Actual OpenAI request contains `functions` array

### Key Files Modified
- `/packages/core/src/core/llmProviderAdapter.ts` - Tool conversion logic
- `/packages/core/src/llm/OpenAICompatibleProvider.ts` - Debug logging
- `/packages/core/src/core/contentGenerator.ts` - Provider selection
- `/packages/core/src/config/config.ts` - Made initialize() idempotent
- `/packages/cli/src/gemini.tsx` - Skip refreshAuth for AIFA_SKIP_AUTH
- `/packages/cli/src/nonInteractiveCli.ts` - Enhanced error handling

## Test Commands Used
```bash
# Main test command
AIFA_DEFAULT_API=openai-compatible OPENAI_COMPATIBLE_BASE_URL=http://localhost:1234/v1 AIFA_SKIP_AUTH=true ./bundle/aifa.js -p "Search google for restaurants in Perth"

# Build command
npm run build
```

## Architecture Notes
The tool passing flow should be:
1. **CLI Entry** (`gemini.tsx`) → `runNonInteractive()` 
2. **nonInteractiveCli.ts** → `geminiClient.sendMessageStream()`
3. **Client** → `Turn.run()` → `GeminiChat.sendMessageStream()`
4. **GeminiChat** → `contentGenerator.generateContentStream()`
5. **LlmProviderAdapter** → `OpenAICompatibleProvider.chat()`
6. **Provider** → HTTP request to LM Studio with tools

**Current failure point:** Step 1 - never reaches `runNonInteractive()`

## Success Criteria
- [ ] CLI execution completes without config error
- [ ] Debug messages show tools being passed to OpenAI provider
- [ ] LM Studio logs show function definitions received
- [ ] Model makes function calls in response to tool-requiring prompts