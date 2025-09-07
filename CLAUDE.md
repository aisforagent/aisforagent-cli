# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Build and Development
- `npm run build` - Build the entire project
- `npm run build:packages` - Build all workspace packages
- `npm run bundle` - Generate and bundle the CLI (includes git commit info)
- `npm run start` - Start the CLI in development mode
- `npm run debug` - Start with debugging enabled

### Testing
- `npm test` - Run all tests across workspaces
- `npm run test:ci` - Run CI tests (includes script tests)
- `npm run test:e2e` - Run end-to-end integration tests
- `npm run test:integration:sandbox:none` - Run integration tests without sandbox
- `OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:1234 npm test -- e2e.test.ts --reporter=verbose` - Test with local LLM server

### Code Quality
- `npm run lint` - Lint TypeScript files
- `npm run lint:fix` - Auto-fix linting issues
- `npm run typecheck` - Type check all packages
- `npm run format` - Format code with Prettier

### Project Management
- `npm run clean` - Clean build artifacts
- `npm run preflight` - Full validation (clean, install, format, lint, build, typecheck, test)

## Architecture Overview

AIFA CLI is a vendor-agnostic AI agent system built on top of Google's Gemini CLI, structured as a monorepo with three main packages:

### Core Packages

1. **`packages/cli/`** - User-facing CLI interface
   - Terminal UI components (React-based)
   - Command processing and input handling
   - Theme system and display rendering
   - Configuration management

2. **`packages/core/`** - Backend processing engine
   - LLM provider abstraction system
   - Tool registration and execution
   - API client management
   - Conversation state handling

3. **`packages/vscode-ide-companion/`** - VS Code integration
   - Extension for IDE integration
   - File diff management
   - Server communication

### Key Architectural Components

#### LLM Provider System (`packages/core/src/llm/`)
- **LlmProvider.ts** - Abstract base class for all providers
- **GoogleGeminiProvider.ts** - Wrapper for existing Gemini functionality
- **OpenAICompatibleProvider.ts** - Full OpenAI-compatible server support
- **providerFactory.ts** - Auto-detection and provider creation

#### Tool System (`packages/core/src/tools/`)
Extensible tool modules for:
- File system operations (read, write, edit, glob, grep)
- Shell command execution
- Web fetching and search
- Memory management
- MCP (Model Context Protocol) client

#### Configuration
Environment variables for provider selection:
- `OPENAI_COMPATIBLE_BASE_URL` - Local LLM server URL (e.g., LM Studio)
- `GEMINI_API_KEY` - Google Gemini API key
- `LLM_PROVIDER` - Force specific provider

## Development Workflow

### Provider Auto-Detection Logic
1. If `GEMINI_API_KEY` is set → GoogleGeminiProvider
2. If `OPENAI_COMPATIBLE_BASE_URL` is set → OpenAICompatibleProvider
3. Default → OpenAICompatibleProvider with localhost

### Testing with Local LLM Servers
The codebase includes comprehensive E2E tests that work with:
- LM Studio (http://127.0.0.1:1234)
- Ollama and other OpenAI-compatible servers
- Mocked responses for CI/CD

### Key Features
- **Streaming responses** with delta callbacks
- **Tool call accumulation** across streaming chunks
- **Multimodal content support** (text, images, files)
- **JSON repair** for malformed streaming responses
- **Error handling** with contextual tips

## Project Structure Notes

- Built with TypeScript and React (for CLI UI)
- Uses esbuild for bundling
- Vitest for testing
- ESLint + Prettier for code quality
- Workspace-based monorepo structure
- Sandboxing support for secure tool execution

## Binary Location
The built CLI binary is available at `bundle/aifa.js`