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
 */
export async function createLlmProvider(config?: ProviderFactoryConfig): Promise<LlmProvider> {
  // Register built-in providers if not already registered
  if (LlmProviderRegistry.list().length === 0) {
    registerBuiltinProviders();
  }

  // Determine provider name based on available configuration
  const env: EnvironmentConfig = process.env as any;
  let providerName = config?.provider || env.LLM_PROVIDER;

  // Auto-detect provider based on environment if not explicitly set
  if (!providerName) {
    if (env.GEMINI_API_KEY) {
      providerName = 'google-gemini';
    } else if (env.OPENAI_COMPATIBLE_BASE_URL) {
      providerName = 'openai-compatible';
    } else {
      // Default to openai-compatible for backward compatibility
      providerName = 'openai-compatible';
    }
  }

  // Validate environment for selected provider
  const errors = validateProviderEnvironment(providerName);
  if (errors.length > 0) {
    throw new LlmProviderError(
      `Provider ${providerName} configuration errors: ${errors.join(', ')}`,
      500,
      'Check your environment variables and provider configuration'
    );
  }

  // Create provider with configuration
  return LlmProviderRegistry.create(providerName, config as Record<string, unknown>);
}

/**
 * Check if environment is properly configured for the given provider
 */
export function validateProviderEnvironment(providerName?: string): string[] {
  const env: EnvironmentConfig = process.env as any;
  const errors: string[] = [];
  const targetProvider = providerName || env.LLM_PROVIDER || 'openai-compatible';

  switch (targetProvider) {
    case 'openai-compatible':
      if (!env.OPENAI_COMPATIBLE_BASE_URL && !env.OPENAI_API_BASE) {
        errors.push(
          'OpenAI-compatible provider requires OPENAI_COMPATIBLE_BASE_URL environment variable. ' +
          'For LM Studio, use: export OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:1234'
        );
      }
      break;

    case 'google-gemini':
      // Google Gemini validation would go here
      // For now, we assume it's handled by the existing auth system
      break;

    default:
      errors.push(`Unknown LLM provider: ${targetProvider}`);
  }

  return errors;
}

/**
 * Get configuration help text for the current or specified provider
 */
export function getProviderConfigurationHelp(providerName?: string): string {
  const env: EnvironmentConfig = process.env as any;
  const targetProvider = providerName || env.LLM_PROVIDER || 'openai-compatible';

  switch (targetProvider) {
    case 'openai-compatible':
      return `
OpenAI-Compatible Provider (LM Studio, Ollama, etc.)

Required environment variables:
  export OPENAI_API_KEY=lm-studio        # Any non-empty string works for LM Studio
  export OPENAI_MODEL=qwen2.5-coder      # Replace with your loaded model ID

Optional environment variables:
  export OPENAI_API_BASE=http://localhost:1234/v1  # Default API endpoint
  export LLM_TRANSPORT=fetch             # Transport method (sdk|fetch)

Quick start with LM Studio:
1. Start LM Studio
2. Go to Developer -> Start Server
3. Load a model
4. Set the environment variables above
5. Run aifa -p "Hello, AIFA!"
      `.trim();

    case 'google-gemini':
      return `
Google Gemini Provider

This provider uses the existing Google authentication system.
Please use the standard authentication commands for setup.
      `.trim();

    default:
      return `Unknown provider: ${targetProvider}`;
  }
}