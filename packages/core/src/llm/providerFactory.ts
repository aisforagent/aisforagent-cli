/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LlmProvider, LlmProviderRegistry } from './LlmProvider.js';
import { GoogleGeminiProvider } from './GoogleGeminiProvider.js';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import { LlmProviderError } from './errorHandling.js';
import { ContentGenerator } from '../core/contentGenerator.js';

/**
 * Configuration for provider factory
 */
export interface ProviderFactoryConfig {
  provider?: string;
  openai?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    transport?: 'sdk' | 'fetch';
  };
  gemini?: {
    contentGenerator: ContentGenerator;
  };
}

/**
 * Environment-based configuration
 */
interface EnvironmentConfig {
  // Primary LLM API selection
  AIFA_DEFAULT_API?: string;
  LLM_PROVIDER?: string;
  LLM_TRANSPORT?: string;
  
  // Google Gemini
  GEMINI_API_KEY?: string;
  
  // OpenAI (and compatible)
  OPENAI_API_KEY?: string;
  OPENAI_API_BASE?: string;
  OPENAI_MODEL?: string;
  
  // AIFA OpenAI-compatible (LM Studio, etc.)
  OPENAI_COMPATIBLE_API_KEY?: string;
  OPENAI_COMPATIBLE_BASE_URL?: string;
}

/**
 * Check if LM Studio is available locally
 */
async function isLMStudioAvailable(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:1234/v1/models', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer lm-studio' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if Ollama is available locally
 */
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Detect available local providers and return the best option
 */
async function detectBestLocalProvider(): Promise<{provider: string, config: any} | null> {
  // Check LM Studio first (port 1234)
  if (await isLMStudioAvailable()) {
    console.log('✓ AIFA detected LM Studio running locally, using as default API provider');
    return {
      provider: 'openai-compatible',
      config: {
        openai: {
          baseUrl: 'http://localhost:1234/v1',
          apiKey: 'lm-studio',
          model: 'default'
        }
      }
    };
  }

  // Check Ollama second (port 11434)
  if (await isOllamaAvailable()) {
    console.log('✓ AIFA detected Ollama running locally, using as default API provider');
    return {
      provider: 'openai-compatible',
      config: {
        openai: {
          baseUrl: 'http://localhost:11434/v1',
          apiKey: 'ollama',
          model: 'default'
        }
      }
    };
  }

  return null;
}

/**
 * Register built-in providers
 */
function registerBuiltinProviders(): void {
  // Register OpenAI-compatible provider
  LlmProviderRegistry.register('openai-compatible', async (config?: Record<string, unknown>) => {
    const openaiConfig = config?.['openai'] as any || {};
    
    // Use environment variables as defaults
    const env: EnvironmentConfig = process.env as any;
    
    // Ensure base URL includes /v1 if not already present
    let baseUrl = openaiConfig.baseUrl || env.OPENAI_COMPATIBLE_BASE_URL || env.OPENAI_API_BASE || 'http://localhost:1234/v1';
    if (!baseUrl.endsWith('/v1')) {
      baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
    }
    
    return new OpenAICompatibleProvider({
      apiKey: openaiConfig.apiKey || env.OPENAI_COMPATIBLE_API_KEY || env.OPENAI_API_KEY || 'lm-studio',
      baseUrl,
      model: openaiConfig.model || env.OPENAI_MODEL || 'qwen2.5-coder',
      transport: openaiConfig.transport || env.LLM_TRANSPORT as 'sdk' | 'fetch' || 'fetch',
    });
  });

  // Register Google Gemini provider
  LlmProviderRegistry.register('google-gemini', async (config?: Record<string, unknown>) => {
    const geminiConfig = config?.['gemini'] as any;
    if (!geminiConfig?.contentGenerator) {
      throw new Error('Google Gemini provider requires a ContentGenerator instance');
    }
    return new GoogleGeminiProvider(geminiConfig.contentGenerator);
  });
}

/**
 * Create an LLM provider based on configuration or environment variables
 * with intelligent fallback to local providers
 */
export async function createLlmProvider(config?: ProviderFactoryConfig): Promise<LlmProvider> {
  // Register built-in providers if not already registered
  if (LlmProviderRegistry.list().length === 0) {
    registerBuiltinProviders();
  }

  const env: EnvironmentConfig = process.env as any;
  let providerName = config?.provider;
  let providerConfig = config;

  // 1. Check for explicit AIFA_DEFAULT_API environment parameter
  if (!providerName && env.AIFA_DEFAULT_API) {
    providerName = env.AIFA_DEFAULT_API.toLowerCase();
    console.log(`Using AIFA_DEFAULT_API provider: ${providerName}`);
  }

  // 2. Fall back to legacy LLM_PROVIDER
  if (!providerName && env.LLM_PROVIDER) {
    providerName = env.LLM_PROVIDER;
    console.log(`Using LLM_PROVIDER: ${providerName}`);
  }

  // 3. Auto-detect local providers if no explicit provider is set
  if (!providerName) {
    const localProvider = await detectBestLocalProvider();
    if (localProvider) {
      providerName = localProvider.provider;
      providerConfig = localProvider.config;
    }
  }

  // 4. Check for existing environment configuration
  if (!providerName) {
    if (env.OPENAI_COMPATIBLE_BASE_URL || env.OPENAI_API_BASE) {
      providerName = 'openai-compatible';
      console.log('Using OpenAI-compatible provider from environment configuration');
    } else if (env.GEMINI_API_KEY) {
      providerName = 'google-gemini';
      console.log('Using Google Gemini provider from environment configuration');
    }
  }

  // 5. Final fallback to Gemini with console notification
  if (!providerName) {
    providerName = 'google-gemini';
    console.log('⚠️  No local LLM providers found and no explicit API configuration detected.');
    console.log('⚠️  Falling back to Google Gemini API - you may need to authenticate.');
    console.log('ℹ️  To use local providers, start LM Studio (http://localhost:1234) or Ollama (http://localhost:11434)');
    console.log('ℹ️  Or set AIFA_DEFAULT_API=openai-compatible with OPENAI_COMPATIBLE_BASE_URL');
  }

  // Skip validation if we're using detected configuration
  if (!providerConfig || providerConfig === config) {
    // Validate environment for selected provider only if using env config
    const errors = validateProviderEnvironment(providerName);
    if (errors.length > 0 && providerName !== 'google-gemini') {
      // For non-Gemini providers, show configuration help
      console.error(`\n❌ Provider ${providerName} configuration errors:`);
      errors.forEach(error => console.error(`   ${error}`));
      console.log('\n' + getProviderConfigurationHelp(providerName));
      
      throw new LlmProviderError(
        `Provider ${providerName} configuration errors: ${errors.join(', ')}`,
        500,
        'Check your environment variables and provider configuration'
      );
    }
  }

  // Create provider with configuration
  return LlmProviderRegistry.create(providerName, (providerConfig || config) as Record<string, unknown>);
}

/**
 * Check if environment is properly configured for the given provider
 * Returns validation errors only for explicit environment configuration
 */
export function validateProviderEnvironment(providerName?: string): string[] {
  const env: EnvironmentConfig = process.env as any;
  const errors: string[] = [];
  const targetProvider = providerName || env.AIFA_DEFAULT_API || env.LLM_PROVIDER || 'openai-compatible';

  switch (targetProvider) {
    case 'openai-compatible':
      // Only require explicit configuration if user has set environment variables
      // Auto-detection will handle local providers without env config
      if (!env.OPENAI_COMPATIBLE_BASE_URL && !env.OPENAI_API_BASE && env.AIFA_DEFAULT_API === 'openai-compatible') {
        errors.push(
          'AIFA_DEFAULT_API is set to openai-compatible but OPENAI_COMPATIBLE_BASE_URL is not configured. ' +
          'Set OPENAI_COMPATIBLE_BASE_URL=http://localhost:1234/v1 for LM Studio or ' +
          'OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1 for Ollama'
        );
      }
      break;

    case 'google-gemini':
      // Google Gemini validation is handled by the existing auth system
      // We don't enforce GEMINI_API_KEY here as auth might be configured differently
      break;

    default:
      errors.push(`Unknown LLM provider: ${targetProvider}. Valid options: openai-compatible, google-gemini`);
  }

  return errors;
}

/**
 * Get configuration help text for the current or specified provider
 */
export function getProviderConfigurationHelp(providerName?: string): string {
  const env: EnvironmentConfig = process.env as any;
  const targetProvider = providerName || env.AIFA_DEFAULT_API || env.LLM_PROVIDER || 'openai-compatible';

  switch (targetProvider) {
    case 'openai-compatible':
      return `
AIFA OpenAI-Compatible Provider (LM Studio, Ollama, etc.)

Primary configuration (recommended):
  export AIFA_DEFAULT_API=openai-compatible       # Set AIFA's default API provider
  export OPENAI_COMPATIBLE_BASE_URL=http://localhost:1234/v1  # LM Studio default
  export OPENAI_COMPATIBLE_API_KEY=lm-studio     # Any non-empty string

Alternative configuration:
  export OPENAI_API_KEY=lm-studio        # Any non-empty string works for LM Studio
  export OPENAI_MODEL=qwen2.5-coder      # Replace with your loaded model ID
  export OPENAI_API_BASE=http://localhost:1234/v1  # Default API endpoint

Optional:
  export LLM_TRANSPORT=fetch             # Transport method (sdk|fetch)

Quick start with LM Studio:
1. Start LM Studio
2. Go to Developer -> Start Server
3. Load a model
4. Set AIFA_DEFAULT_API=openai-compatible
5. Set OPENAI_COMPATIBLE_BASE_URL=http://localhost:1234/v1
6. Run aifa -p "Hello, AIFA!"

Quick start with Ollama:
1. Start Ollama
2. Pull a model: ollama pull llama2
3. Set AIFA_DEFAULT_API=openai-compatible
4. Set OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1
5. Run aifa -p "Hello, AIFA!"

Auto-detection:
AIFA will automatically detect running LM Studio or Ollama instances
if no explicit provider is configured.
      `.trim();

    case 'google-gemini':
      return `
Google Gemini Provider

Configuration:
  export AIFA_DEFAULT_API=google-gemini   # Set AIFA's default API provider
  
This provider uses the existing Google authentication system.
Please use the standard authentication commands for setup.

Fallback behavior:
If no local providers are detected and no explicit configuration
is provided, AIFA will fall back to Google Gemini with a warning.
      `.trim();

    default:
      return `Unknown provider: ${targetProvider}

Available providers:
- openai-compatible: For LM Studio, Ollama, and other OpenAI-compatible APIs
- google-gemini: For Google's Gemini API

Set your preferred provider with:
export AIFA_DEFAULT_API=openai-compatible  # or google-gemini`;
  }
}

/**
 * Get information about the current provider selection process
 */
export function getProviderSelectionInfo(): string {
  const env: EnvironmentConfig = process.env as any;
  
  return `
AIFA LLM Provider Selection Process:

1. AIFA_DEFAULT_API environment variable (highest priority)
   Current: ${env.AIFA_DEFAULT_API || 'not set'}

2. LLM_PROVIDER environment variable (legacy support)
   Current: ${env.LLM_PROVIDER || 'not set'}

3. Auto-detection of local providers:
   • LM Studio (http://localhost:1234/v1)
   • Ollama (http://localhost:11434/v1)

4. Existing environment configuration:
   • OPENAI_COMPATIBLE_BASE_URL: ${env.OPENAI_COMPATIBLE_BASE_URL || 'not set'}
   • OPENAI_API_BASE: ${env.OPENAI_API_BASE || 'not set'}
   • GEMINI_API_KEY: ${env.GEMINI_API_KEY ? 'configured' : 'not set'}

5. Final fallback: Google Gemini (with console warning)

Recommended setup for local development:
export AIFA_DEFAULT_API=openai-compatible
export OPENAI_COMPATIBLE_BASE_URL=http://localhost:1234/v1  # for LM Studio
# or
export OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1  # for Ollama
  `.trim();
}