/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createLlmProvider,
  validateProviderEnvironment,
  getProviderConfigurationHelp,
} from './providerFactory.js';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import { GoogleGeminiProvider } from './GoogleGeminiProvider.js';
import { LlmProviderRegistry } from './LlmProvider.js';
import { ContentGenerator } from '../core/contentGenerator.js';

// Mock ContentGenerator
class MockContentGenerator implements ContentGenerator {
  async generateContent(): Promise<any> {
    return { candidates: [{ content: { parts: [{ text: 'mock' }], role: 'model' } }] };
  }
  async generateContentStream(): Promise<any> {
    return (async function* () {
      yield { candidates: [{ content: { parts: [{ text: 'mock' }], role: 'model' } }] };
    })();
  }
  async countTokens(): Promise<any> {
    return { totalTokens: 10 };
  }
  async embedContent(): Promise<any> {
    throw new Error('Not implemented');
  }
}

describe('providerFactory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear the registry before each test
    (LlmProviderRegistry as any).factories.clear();
    
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env['LLM_PROVIDER'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_BASE'];
    delete process.env['OPENAI_MODEL'];
    delete process.env['LLM_TRANSPORT'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createLlmProvider', () => {
    it('should create OpenAI-compatible provider by default', async () => {
      process.env['OPENAI_API_KEY'] = 'test-key';
      process.env['OPENAI_MODEL'] = 'test-model';

      const provider = await createLlmProvider();

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider.getProviderName()).toBe('openai-compatible');
    });

    it('should use environment variables for OpenAI provider configuration', async () => {
      process.env['OPENAI_API_KEY'] = 'env-key';
      process.env['OPENAI_API_BASE'] = 'http://custom:8080/v1';
      process.env['OPENAI_MODEL'] = 'env-model';
      process.env['LLM_TRANSPORT'] = 'sdk';

      const provider = await createLlmProvider();

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    });

    it('should create provider based on LLM_PROVIDER environment variable', async () => {
      process.env['LLM_PROVIDER'] = 'openai-compatible';
      process.env['OPENAI_API_KEY'] = 'test-key';
      process.env['OPENAI_MODEL'] = 'test-model';

      const provider = await createLlmProvider();

      expect(provider.getProviderName()).toBe('openai-compatible');
    });

    it('should create provider based on config parameter', async () => {
      const config = {
        provider: 'openai-compatible',
        openai: {
          apiKey: 'config-key',
          baseUrl: 'http://config:9000/v1',
          model: 'config-model',
          transport: 'fetch' as const,
        },
      };

      const provider = await createLlmProvider(config);

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    });

    it('should create Google Gemini provider when configured', async () => {
      const mockContentGenerator = new MockContentGenerator();
      
      const config = {
        provider: 'google-gemini',
        gemini: {
          contentGenerator: mockContentGenerator,
        },
      };

      const provider = await createLlmProvider(config);

      expect(provider).toBeInstanceOf(GoogleGeminiProvider);
      expect(provider.getProviderName()).toBe('google-gemini');
    });

    it('should throw error for Google Gemini provider without ContentGenerator', async () => {
      const config = {
        provider: 'google-gemini',
      };

      await expect(createLlmProvider(config)).rejects.toThrow(
        'Google Gemini provider requires a ContentGenerator instance'
      );
    });

    it('should throw error for unknown provider', async () => {
      const config = {
        provider: 'unknown-provider',
      };

      await expect(createLlmProvider(config)).rejects.toThrow(
        'Unknown LLM provider: unknown-provider'
      );
    });
  });

  describe('validateProviderEnvironment', () => {
    it('should validate OpenAI-compatible provider environment', () => {
      process.env['OPENAI_API_KEY'] = 'test-key';
      process.env['OPENAI_MODEL'] = 'test-model';

      const errors = validateProviderEnvironment('openai-compatible');
      expect(errors).toHaveLength(0);
    });

    it('should return errors for missing OpenAI environment variables', () => {
      const errors = validateProviderEnvironment('openai-compatible');
      
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('OPENAI_API_KEY');
      expect(errors[1]).toContain('OPENAI_MODEL');
    });

    it('should validate based on LLM_PROVIDER environment variable', () => {
      process.env['LLM_PROVIDER'] = 'openai-compatible';
      
      const errors = validateProviderEnvironment();
      
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(err => err.includes('OPENAI_API_KEY'))).toBe(true);
    });

    it('should return no errors for Google Gemini provider', () => {
      const errors = validateProviderEnvironment('google-gemini');
      expect(errors).toHaveLength(0);
    });

    it('should return error for unknown provider', () => {
      const errors = validateProviderEnvironment('unknown-provider');
      
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Unknown LLM provider: unknown-provider');
    });

    it('should default to openai-compatible when no provider specified', () => {
      const errors = validateProviderEnvironment();
      
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(err => err.includes('OPENAI_API_KEY'))).toBe(true);
    });
  });

  describe('getProviderConfigurationHelp', () => {
    it('should return help for OpenAI-compatible provider', () => {
      const help = getProviderConfigurationHelp('openai-compatible');
      
      expect(help).toContain('OpenAI-Compatible Provider');
      expect(help).toContain('OPENAI_API_KEY=lm-studio');
      expect(help).toContain('OPENAI_MODEL=qwen2.5-coder');
      expect(help).toContain('LM Studio');
    });

    it('should return help for Google Gemini provider', () => {
      const help = getProviderConfigurationHelp('google-gemini');
      
      expect(help).toContain('Google Gemini Provider');
      expect(help).toContain('authentication');
    });

    it('should return help based on LLM_PROVIDER environment variable', () => {
      process.env['LLM_PROVIDER'] = 'google-gemini';
      
      const help = getProviderConfigurationHelp();
      
      expect(help).toContain('Google Gemini Provider');
    });

    it('should return error message for unknown provider', () => {
      const help = getProviderConfigurationHelp('unknown-provider');
      
      expect(help).toContain('Unknown provider: unknown-provider');
    });

    it('should default to OpenAI-compatible help when no provider specified', () => {
      const help = getProviderConfigurationHelp();
      
      expect(help).toContain('OpenAI-Compatible Provider');
    });
  });
});