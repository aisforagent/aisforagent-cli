/**
 * End-to-end tests for AIFA LLM provider system
 * Tests both live LM Studio integration and mocked responses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLlmProvider } from './providerFactory.js';
import { LlmProvider } from './LlmProvider.js';
import { LlmProviderError } from './errorHandling.js';
import { Type } from '@google/genai';

describe('AIFA E2E Tests', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Provider Creation', () => {
    it('should create GoogleGeminiProvider when GEMINI_API_KEY is set', async () => {
      process.env['GEMINI_API_KEY'] = 'test-key';
      delete process.env['OPENAI_COMPATIBLE_BASE_URL'];

      const provider = await createLlmProvider();
      expect(provider.getProviderName()).toBe('google-gemini');
    });

    it('should create OpenAICompatibleProvider when OPENAI_COMPATIBLE_BASE_URL is set', async () => {
      delete process.env['GEMINI_API_KEY'];
      process.env['OPENAI_COMPATIBLE_BASE_URL'] = 'http://127.0.0.1:1234';

      const provider = await createLlmProvider();
      expect(provider.getProviderName()).toBe('openai-compatible');
    });

    it('should throw error when no provider configuration is found', async () => {
      delete process.env['GEMINI_API_KEY'];
      delete process.env['OPENAI_COMPATIBLE_BASE_URL'];

      await expect(createLlmProvider()).rejects.toThrow(LlmProviderError);
    });
  });

  describe('Live LM Studio Integration', () => {
    let provider: LlmProvider;

    beforeEach(async () => {
      // Only run these tests if LM Studio URL is available
      if (!process.env['OPENAI_COMPATIBLE_BASE_URL']) {
        process.env['OPENAI_COMPATIBLE_BASE_URL'] = 'http://127.0.0.1:1234';
      }

      try {
        provider = await createLlmProvider();
      } catch (error) {
        // Skip live tests if LM Studio is not available
        if (error instanceof Error && error.message.includes('connection')) {
          console.log('⚠️ Skipping live LM Studio tests - server not available');
          return;
        }
        throw error;
      }
    });

    it('should connect to LM Studio and list models', async () => {
      if (!provider) return; // Skip if LM Studio not available

      const models = await provider.listModels();
      expect(Array.isArray(models)).toBe(true);
      
      if (models.length > 0) {
        expect(models[0]).toHaveProperty('id');
        expect(typeof models[0].id).toBe('string');
      }
    }, 10000);

    it('should complete a simple chat request', async () => {
      if (!provider) return; // Skip if LM Studio not available

      const models = await provider.listModels();
      if (models.length === 0) return; // Skip if no models available

      const response = await provider.chat({
        messages: [{ role: 'user', content: 'Say "test" and nothing else.' }],
        model: models[0].id,
        maxTokens: 10
      });

      expect(response).toHaveProperty('text');
      expect(typeof response.text).toBe('string');
      expect(response.text!.length).toBeGreaterThan(0);
    }, 15000);

    it('should handle streaming responses', async () => {
      if (!provider) return; // Skip if LM Studio not available

      const models = await provider.listModels();
      if (models.length === 0) return; // Skip if no models available

      let deltaCount = 0;
      let finalResponse: any;

      const response = await provider.chat({
        messages: [{ role: 'user', content: 'Count: 1, 2, 3' }],
        model: models[0].id,
        maxTokens: 20
      }, {
        onDelta: (delta) => {
          deltaCount++;
          expect(delta).toHaveProperty('text');
        },
        onDone: (response) => {
          finalResponse = response;
        }
      });

      expect(deltaCount).toBeGreaterThan(0);
      expect(response).toHaveProperty('text');
      expect(finalResponse).toBeDefined();
    }, 15000);

    it('should count tokens approximately', async () => {
      if (!provider) return; // Skip if LM Studio not available

      const tokenCount = await provider.countTokens([
        { role: 'user', content: 'This is a test message' },
        { role: 'assistant', content: 'This is a response' }
      ]);

      expect(typeof tokenCount).toBe('number');
      expect(tokenCount).toBeGreaterThan(0);
      expect(tokenCount).toBeLessThan(100); // Reasonable upper bound
    });
  });

  describe('Mocked Response Tests', () => {
    let provider: LlmProvider;

    beforeEach(async () => {
      process.env['OPENAI_COMPATIBLE_BASE_URL'] = 'http://mock-server:1234';
      
      // Mock fetch to simulate LM Studio responses
      global.fetch = vi.fn();
    });

    it('should handle mocked model list response', async () => {
      const mockModels = {
        data: [
          { id: 'test-model-1', object: 'model' },
          { id: 'test-model-2', object: 'model' }
        ]
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockModels),
        status: 200
      } as Response);

      provider = await createLlmProvider();
      const models = await provider.listModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('test-model-1');
      expect(models[1].id).toBe('test-model-2');
    });

    it('should handle mocked chat completion response', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'Mocked response from AI',
            role: 'assistant'
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15
        }
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        status: 200
      } as Response);

      provider = await createLlmProvider();
      
      const response = await provider.chat({
        messages: [{ role: 'user', content: 'Test message' }],
        model: 'test-model'
      });

      expect(response.text).toBe('Mocked response from AI');
      expect(response.usage?.totalTokens).toBe(15);
    });

    it('should handle mocked streaming response', async () => {
      const streamData = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
        'data: [DONE]\n\n'
      ];

      const mockStream = new ReadableStream({
        start(controller) {
          streamData.forEach(data => {
            controller.enqueue(new TextEncoder().encode(data));
          });
          controller.close();
        }
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        body: mockStream,
        status: 200,
        json: () => Promise.resolve({})
      } as Response);

      provider = await createLlmProvider();
      
      let receivedText = '';
      await provider.chat({
        messages: [{ role: 'user', content: 'Test' }],
        model: 'test-model'
      }, {
        onDelta: (delta) => {
          if (delta.text) {
            receivedText += delta.text;
          }
        }
      });

      expect(receivedText).toBe('Hello world!');
    });

    it('should handle mocked multimodal content', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'I can see an image with a red pixel.',
            role: 'assistant'
          }
        }]
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        status: 200
      } as Response);

      provider = await createLlmProvider();

      const multimodalMessage = [
        { text: "What do you see?" },
        {
          inlineData: {
            mimeType: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
          }
        }
      ];

      const response = await provider.chat({
        messages: [{ role: 'user', content: multimodalMessage }],
        model: 'vision-model'
      });

      expect(response.text).toContain('red pixel');
      
      // Verify the request was made with OpenAI multimodal format
      const fetchCall = vi.mocked(global.fetch).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1]?.body as string);
      expect(requestBody.messages[0].content).toBeInstanceOf(Array);
      expect(requestBody.messages[0].content[1].type).toBe('image_url');
    });

    it('should handle mocked error responses', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response);

      provider = await createLlmProvider();

      await expect(
        provider.chat({
          messages: [{ role: 'user', content: 'Test' }],
          model: 'test-model'
        })
      ).rejects.toThrow('Internal Server Error');
    });
  });

  describe('Tool Call Integration', () => {
    it('should handle mocked tool call responses', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: null,
            role: 'assistant',
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location": "New York"}'
              }
            }]
          }
        }]
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        status: 200
      } as Response);

      process.env['OPENAI_COMPATIBLE_BASE_URL'] = 'http://mock-server:1234';
      const provider = await createLlmProvider();

      const response = await provider.chat({
        messages: [{ role: 'user', content: 'What is the weather in New York?' }],
        model: 'test-model',
        tools: [{
          functionDeclarations: [{
            name: 'get_weather',
            description: 'Get weather information',
            parameters: {
              type: Type.OBJECT,
              properties: {
                location: { type: Type.STRING }
              },
              required: ['location']
            }
          }]
        }]
      });

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe('get_weather');
      expect(response.toolCalls![0].arguments).toEqual({ location: 'New York' });
    });
  });
});