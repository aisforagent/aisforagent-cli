/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Type } from '@google/genai';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import { ChatRequest, LlmMessage } from './LlmProvider.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseUrl: 'http://localhost:1234/v1',
      model: 'test-model',
      transport: 'fetch',
    });
    mockFetch.mockClear();
  });

  describe('constructor', () => {
    it('should throw error when API key is missing', () => {
      expect(() => new OpenAICompatibleProvider({
        apiKey: '',
        model: 'test-model',
      })).toThrow('OpenAI API key is required');
    });

    it('should use default baseUrl when not provided', () => {
      const providerWithDefaults = new OpenAICompatibleProvider({
        apiKey: 'test-key',
        model: 'test-model',
      });
      expect(providerWithDefaults.getProviderName()).toBe('openai-compatible');
    });
  });

  describe('chat method', () => {
    it('should handle simple text response', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant' as const,
              content: 'Hello! How can I help you today?',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 9,
          total_tokens: 14,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await provider.chat(request);

      expect(response.text).toBe('Hello! How can I help you today?');
      expect(response.usage).toEqual({
        promptTokens: 5,
        completionTokens: 9,
        totalTokens: 14,
      });

      // Verify request format
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:1234/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hello' }],
            temperature: undefined,
            top_p: undefined,
            max_tokens: undefined,
            stream: undefined,
          }),
        }),
      );
    });

    it('should handle tool call response', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant' as const,
              content: 'I need to search for weather information.',
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function' as const,
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "New York"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'What is the weather in New York?' }],
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_weather',
                description: 'Get weather information',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    location: { type: Type.STRING },
                  },
                },
              },
            ],
          },
        ],
      };

      const response = await provider.chat(request);

      expect(response.text).toBe('I need to search for weather information.');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]).toEqual({
        id: 'call_abc123',
        name: 'get_weather',
        arguments: { location: 'New York' },
      });

      // Verify tools were included in request
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather information',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        },
      ]);
      expect(requestBody.tool_choice).toBe('auto');
    });

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await expect(provider.chat(request)).rejects.toThrow('HTTP 401: Unauthorized');
    });

    describe('streaming', () => {
      it('should handle streaming text response', async () => {
        const mockStreamData = [
          'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n',
          'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"test-model","choices":[{"index":0,"delta":{"content":", how"},"finish_reason":null}]}\n\n',
          'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"test-model","choices":[{"index":0,"delta":{"content":" can I help?"},"finish_reason":null}]}\n\n',
          'data: [DONE]\n\n',
        ];

        const mockResponse = {
          ok: true,
          body: new ReadableStream({
            start(controller) {
              for (const chunk of mockStreamData) {
                controller.enqueue(new TextEncoder().encode(chunk));
              }
              controller.close();
            },
          }),
        };

        mockFetch.mockResolvedValueOnce(mockResponse);

        const request: ChatRequest = {
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        };

        const deltaTexts: string[] = [];
        let finalResponse: any = null;

        await provider.chat(request, {
          onDelta: (delta) => {
            if (delta.text) deltaTexts.push(delta.text);
          },
          onDone: (response) => {
            finalResponse = response;
          },
        });

        expect(deltaTexts).toEqual(['Hello', ', how', ' can I help?']);
        expect(finalResponse.text).toBe('Hello, how can I help?');
      });

      it('should handle streaming tool calls', async () => {
        const mockStreamData = [
          'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"I need to search."},"finish_reason":null}]}\n\n',
          'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"test-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"search"}}]},"finish_reason":null}]}\n\n',
          'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"test-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\""}}]},"finish_reason":null}]}\n\n',
          'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"test-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":": \\"weather\\"}"}}]},"finish_reason":null}]}\n\n',
          'data: [DONE]\n\n',
        ];

        const mockResponse = {
          ok: true,
          body: new ReadableStream({
            start(controller) {
              for (const chunk of mockStreamData) {
                controller.enqueue(new TextEncoder().encode(chunk));
              }
              controller.close();
            },
          }),
        };

        mockFetch.mockResolvedValueOnce(mockResponse);

        const request: ChatRequest = {
          messages: [{ role: 'user', content: 'Search for weather' }],
          stream: true,
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

        const deltaTexts: string[] = [];
        let finalResponse: any = null;

        await provider.chat(request, {
          onDelta: (delta) => {
            if (delta.text) deltaTexts.push(delta.text);
          },
          onDone: (response) => {
            finalResponse = response;
          },
        });

        expect(deltaTexts).toEqual(['I need to search.']);
        expect(finalResponse.toolCalls).toHaveLength(1);
        expect(finalResponse.toolCalls[0]).toEqual({
          id: 'call_123',
          name: 'search',
          arguments: { query: 'weather' },
        });
      });
    });
  });

  describe('listModels method', () => {
    it('should list available models', async () => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            id: 'gpt-3.5-turbo',
            object: 'model',
            created: 1677610602,
            owned_by: 'openai',
          },
          {
            id: 'gpt-4',
            object: 'model',
            created: 1687882411,
            owned_by: 'openai',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const models = await provider.listModels();

      expect(models).toHaveLength(2);
      expect(models[0]).toEqual({
        id: 'gpt-3.5-turbo',
        name: 'gpt-3.5-turbo',
        description: 'Model: gpt-3.5-turbo',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:1234/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Authorization': 'Bearer test-key',
          },
        }),
      );
    });

    it('should handle models API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(provider.listModels()).rejects.toThrow(
        'Failed to list models: HTTP 500: Internal Server Error'
      );
    });
  });

  describe('countTokens method', () => {
    it('should estimate token count', async () => {
      const messages: LlmMessage[] = [
        { role: 'user', content: 'Hello, this is a test message' }, // ~28 chars = ~7 tokens
        { role: 'assistant', content: 'Hi there!' }, // ~9 chars = ~3 tokens
      ];

      const tokenCount = await provider.countTokens(messages);
      expect(tokenCount).toBeGreaterThan(5);
      expect(tokenCount).toBeLessThan(15);
    });
  });

  describe('getProviderName method', () => {
    it('should return correct provider name', () => {
      expect(provider.getProviderName()).toBe('openai-compatible');
    });
  });

  describe('message conversion', () => {
    it('should handle system messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1677652288,
          model: 'test-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Understood.' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const request: ChatRequest = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
      };

      await provider.chat(request);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages).toEqual([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('should handle assistant messages with tool calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1677652288,
          model: 'test-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Processing...' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const request: ChatRequest = {
        messages: [
          {
            role: 'assistant',
            content: 'I need to search.',
            toolCalls: [
              {
                id: 'call_123',
                name: 'search',
                arguments: { query: 'test' },
              },
            ],
          },
        ],
      };

      await provider.chat(request);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages[0].tool_calls).toEqual([
        {
          id: 'call_123',
          type: 'function',
          function: {
            name: 'search',
            arguments: '{"query":"test"}',
          },
        },
      ]);
    });
  });
});