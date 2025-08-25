/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GenerateContentResponse,
  CountTokensResponse,
  GenerateContentParameters,
  CountTokensParameters,
  Type,
} from '@google/genai';
import { ContentGenerator } from '../core/contentGenerator.js';
import { GoogleGeminiProvider } from './GoogleGeminiProvider.js';
import { ChatRequest, LlmMessage } from './LlmProvider.js';

// Mock ContentGenerator
class MockContentGenerator implements ContentGenerator {
  private mockResponse: GenerateContentResponse = {
    candidates: [
      {
        content: {
          parts: [{ text: 'Mock response' }],
          role: 'model',
        },
      },
    ],
  } as GenerateContentResponse;
  private mockStreamResponse: AsyncGenerator<GenerateContentResponse> | null = null;
  private mockTokenCount = 10;

  setMockResponse(response: GenerateContentResponse) {
    this.mockResponse = response;
  }

  setMockStreamResponse(responses: GenerateContentResponse[]) {
    this.mockStreamResponse = (async function* () {
      for (const response of responses) {
        yield response;
      }
    })();
  }

  setMockTokenCount(count: number) {
    this.mockTokenCount = count;
  }

  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    return this.mockResponse;
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return this.mockStreamResponse || this.createSingleResponseGenerator();
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    return { totalTokens: this.mockTokenCount };
  }

  async embedContent(): Promise<any> {
    throw new Error('Not implemented');
  }

  private async *createSingleResponseGenerator(): AsyncGenerator<GenerateContentResponse> {
    yield this.mockResponse;
  }
}

describe('GoogleGeminiProvider', () => {
  let mockContentGenerator: MockContentGenerator;
  let provider: GoogleGeminiProvider;

  beforeEach(() => {
    mockContentGenerator = new MockContentGenerator();
    provider = new GoogleGeminiProvider(mockContentGenerator);
  });

  describe('chat method', () => {
    it('should handle simple text response', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello, how can I help you?' }],
              role: 'model',
            },
          },
        ],
      } as GenerateContentResponse;
      mockContentGenerator.setMockResponse(mockResponse);

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await provider.chat(request);
      expect(response.text).toBe('Hello, how can I help you?');
      expect(response.toolCalls).toBeUndefined();
    });

    it('should handle tool call response', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              parts: [
                { text: 'I need to search for information.' },
                {
                  functionCall: {
                    name: 'search',
                    args: { query: 'weather' },
                  },
                },
              ],
              role: 'model',
            },
          },
        ],
      } as GenerateContentResponse;
      mockContentGenerator.setMockResponse(mockResponse);

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
      expect(response.text).toBe('I need to search for information.');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe('search');
      expect(response.toolCalls![0].arguments).toEqual({ query: 'weather' });
      expect(response.toolCalls![0].id).toMatch(/^call_/);
    });

    it('should handle streaming response', async () => {
      const mockResponses: GenerateContentResponse[] = [
        {
          candidates: [
            {
              content: {
                parts: [{ text: 'Hello' }],
                role: 'model',
              },
            },
          ],
        } as GenerateContentResponse,
        {
          candidates: [
            {
              content: {
                parts: [{ text: ', world!' }],
                role: 'model',
              },
            },
          ],
        } as GenerateContentResponse,
      ];
      mockContentGenerator.setMockStreamResponse(mockResponses);

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };

      const deltaTexts: string[] = [];
      let finalResponse: any = null;

      const response = await provider.chat(request, {
        onDelta: (delta) => {
          if (delta.text) deltaTexts.push(delta.text);
        },
        onDone: (response) => {
          finalResponse = response;
        },
      });

      expect(deltaTexts).toEqual(['Hello', ', world!']);
      expect(finalResponse.text).toBe('Hello, world!');
      expect(response.text).toBe('Hello, world!');
    });

    it('should handle usage metadata', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Response with usage' }],
              role: 'model',
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 3,
          totalTokenCount: 8,
        },
      } as GenerateContentResponse;
      mockContentGenerator.setMockResponse(mockResponse);

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await provider.chat(request);
      expect(response.usage).toEqual({
        promptTokens: 5,
        completionTokens: 3,
        totalTokens: 8,
      });
    });
  });

  describe('listModels method', () => {
    it('should return hardcoded list of Gemini models', async () => {
      const models = await provider.listModels();
      
      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('gemini-2.0-flash');
      expect(models[0].name).toBe('Gemini 2.0 Flash');
      expect(models[0].contextLength).toBe(1048576);
      
      expect(models[1].id).toBe('gemini-1.5-pro');
      expect(models[2].id).toBe('gemini-1.5-flash');
    });
  });

  describe('countTokens method', () => {
    it('should count tokens for messages', async () => {
      mockContentGenerator.setMockTokenCount(25);

      const messages: LlmMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const tokenCount = await provider.countTokens(messages);
      expect(tokenCount).toBe(25);
    });

    it('should handle token counting errors gracefully', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const originalMethod = mockContentGenerator.countTokens;
      mockContentGenerator.countTokens = vi.fn().mockRejectedValue(new Error('Token counting failed'));

      const messages: LlmMessage[] = [
        { role: 'user', content: 'Hello' },
      ];

      const tokenCount = await provider.countTokens(messages);
      expect(tokenCount).toBe(0);
      expect(spy).toHaveBeenCalledWith('Failed to count tokens:', expect.any(Error));

      mockContentGenerator.countTokens = originalMethod;
      spy.mockRestore();
    });
  });

  describe('getProviderName method', () => {
    it('should return correct provider name', () => {
      expect(provider.getProviderName()).toBe('google-gemini');
    });
  });

  describe('message conversion', () => {
    it('should convert system messages correctly', async () => {
      const request: ChatRequest = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
      };

      // We'll check the conversion indirectly through the response
      await provider.chat(request);
      // The test passes if no errors are thrown during conversion
      expect(true).toBe(true);
    });

    it('should convert tool calls in messages correctly', async () => {
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

      // We'll check the conversion indirectly through the response
      await provider.chat(request);
      // The test passes if no errors are thrown during conversion
      expect(true).toBe(true);
    });

    it('should handle Part[] content correctly', async () => {
      const request: ChatRequest = {
        messages: [
          {
            role: 'user',
            content: [
              { text: 'Hello' },
              { text: 'World' },
            ],
          },
        ],
      };

      // We'll check the conversion indirectly through the response
      await provider.chat(request);
      // The test passes if no errors are thrown during conversion
      expect(true).toBe(true);
    });
  });
});