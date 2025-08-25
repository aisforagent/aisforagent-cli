/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Type } from '@google/genai';
import {
  LlmProvider,
  LlmProviderRegistry,
  ChatRequest,
  LlmResponse,
  ModelInfo,
  LlmMessage,
} from './LlmProvider.js';

class FakeProvider extends LlmProvider {
  private responses: LlmResponse[] = [];
  private responseIndex = 0;

  constructor(responses: LlmResponse[] = []) {
    super();
    this.responses = responses;
  }

  setResponses(responses: LlmResponse[]) {
    this.responses = responses;
    this.responseIndex = 0;
  }

  async chat(request: ChatRequest): Promise<LlmResponse> {
    if (this.responseIndex >= this.responses.length) {
      throw new Error('No more responses available');
    }
    return this.responses[this.responseIndex++];
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'fake-model-1', name: 'Fake Model 1' },
      { id: 'fake-model-2', name: 'Fake Model 2' },
    ];
  }

  async countTokens(messages: LlmMessage[]): Promise<number> {
    // Simple token estimation: ~4 characters per token
    return messages.reduce((total, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return total + Math.ceil(content.length / 4);
    }, 0);
  }

  getProviderName(): string {
    return 'fake';
  }
}

describe('LlmProvider', () => {
  describe('FakeProvider for testing', () => {
    let provider: FakeProvider;

    beforeEach(() => {
      provider = new FakeProvider();
    });

    it('should handle simple text response', async () => {
      const expectedResponse: LlmResponse = { text: 'Hello, world!' };
      provider.setResponses([expectedResponse]);

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await provider.chat(request);
      expect(response).toEqual(expectedResponse);
    });

    it('should handle tool call response', async () => {
      const expectedResponse: LlmResponse = {
        text: 'I need to search for information.',
        toolCalls: [
          {
            id: 'call_123',
            name: 'search',
            arguments: { query: 'weather' },
          },
        ],
      };
      provider.setResponses([expectedResponse]);

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            functionDeclarations: [
              {
                name: 'search',
                description: 'Search for information',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    query: { type: Type.STRING },
                  },
                },
              },
            ],
          },
        ],
      };

      const response = await provider.chat(request);
      expect(response).toEqual(expectedResponse);
    });

    it('should list models', async () => {
      const models = await provider.listModels();
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('fake-model-1');
      expect(models[1].id).toBe('fake-model-2');
    });

    it('should count tokens approximately', async () => {
      const messages: LlmMessage[] = [
        { role: 'user', content: 'Hello' }, // ~5 chars = ~2 tokens
        { role: 'assistant', content: 'Hi there!' }, // ~9 chars = ~3 tokens
      ];

      const tokenCount = await provider.countTokens(messages);
      expect(tokenCount).toBeGreaterThan(0);
      expect(tokenCount).toBeLessThan(20); // Should be reasonable
    });

    it('should return provider name', () => {
      expect(provider.getProviderName()).toBe('fake');
    });
  });

  describe('LlmProviderRegistry', () => {
    beforeEach(() => {
      // Clear registry before each test
      (LlmProviderRegistry as any).factories.clear();
    });

    it('should register and create providers', async () => {
      const factory = async () => new FakeProvider([{ text: 'Test response' }]);
      
      LlmProviderRegistry.register('test', factory);
      
      const provider = await LlmProviderRegistry.create('test');
      expect(provider).toBeInstanceOf(FakeProvider);
      expect(provider.getProviderName()).toBe('fake');
    });

    it('should list registered providers', () => {
      const factory1 = async () => new FakeProvider();
      const factory2 = async () => new FakeProvider();
      
      LlmProviderRegistry.register('provider1', factory1);
      LlmProviderRegistry.register('provider2', factory2);
      
      const providers = LlmProviderRegistry.list();
      expect(providers).toEqual(['provider1', 'provider2']);
    });

    it('should throw error for unknown provider', async () => {
      await expect(LlmProviderRegistry.create('nonexistent')).rejects.toThrow(
        'Unknown LLM provider: nonexistent'
      );
    });

    it('should pass config to factory', async () => {
      const factory = async (config?: Record<string, unknown>) => {
        const provider = new FakeProvider();
        // Store config for verification
        (provider as any).config = config;
        return provider;
      };
      
      LlmProviderRegistry.register('configurable', factory);
      
      const config = { apiKey: 'test-key', model: 'test-model' };
      const provider = await LlmProviderRegistry.create('configurable', config);
      
      expect((provider as any).config).toEqual(config);
    });
  });
});