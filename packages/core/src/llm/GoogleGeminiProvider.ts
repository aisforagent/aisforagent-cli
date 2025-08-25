/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Content,
  GenerateContentResponse,
  Part,
  GenerateContentParameters,
  CountTokensParameters,
} from '@google/genai';
import { ContentGenerator } from '../core/contentGenerator.js';
import {
  LlmProvider,
  LlmMessage,
  LlmResponse,
  ChatRequest,
  StreamingHandlers,
  ModelInfo,
  LlmToolCall,
} from './LlmProvider.js';

/**
 * Google Gemini provider that adapts the existing ContentGenerator interface
 * to the unified LlmProvider interface
 */
export class GoogleGeminiProvider extends LlmProvider {
  constructor(private contentGenerator: ContentGenerator) {
    super();
  }

  async chat(request: ChatRequest, handlers?: StreamingHandlers): Promise<LlmResponse> {
    try {
      const geminiRequest = this.convertToGeminiRequest(request);
      const promptId = `gemini-${Date.now()}`;

      if (request.stream && handlers) {
        return await this.handleStreamingRequest(geminiRequest, promptId, handlers);
      } else {
        const response = await this.contentGenerator.generateContent(geminiRequest, promptId);
        return this.convertGeminiResponse(response);
      }
    } catch (error) {
      handlers?.onError?.(error as Error);
      throw error;
    }
  }

  private async handleStreamingRequest(
    geminiRequest: GenerateContentParameters,
    promptId: string,
    handlers: StreamingHandlers,
  ): Promise<LlmResponse> {
    try {
      const stream = await this.contentGenerator.generateContentStream(geminiRequest, promptId);
      let finalResponse: LlmResponse = {};

      for await (const chunk of stream) {
        const converted = this.convertGeminiResponse(chunk);
        if (converted.text) {
          handlers.onDelta?.({ text: converted.text });
        }
        // Accumulate final response
        if (converted.toolCalls) {
          finalResponse.toolCalls = converted.toolCalls;
        }
        if (converted.text) {
          finalResponse.text = (finalResponse.text || '') + converted.text;
        }
      }

      handlers.onDone?.(finalResponse);
      return finalResponse;
    } catch (error) {
      handlers.onError?.(error as Error);
      throw error;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // For now, return hardcoded list of common Gemini models
    // In a full implementation, this would query the actual models API
    return [
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        description: 'Fast and efficient model for most tasks',
        contextLength: 1048576,
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'High-quality model for complex reasoning',
        contextLength: 2097152,
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: 'Fast model for quick responses',
        contextLength: 1048576,
      },
    ];
  }

  async countTokens(messages: LlmMessage[]): Promise<number> {
    const contents = this.convertMessagesToContents(messages);
    const request: CountTokensParameters = { 
      contents,
      model: 'gemini-1.5-flash' // Default model for token counting
    };
    
    try {
      const response = await this.contentGenerator.countTokens(request);
      return response.totalTokens || 0;
    } catch (error) {
      console.warn('Failed to count tokens:', error);
      return 0;
    }
  }

  getProviderName(): string {
    return 'google-gemini';
  }

  /**
   * Convert unified LlmMessage format to Gemini Content format
   */
  private convertMessagesToContents(messages: LlmMessage[]): Content[] {
    return messages.map(msg => {
      if (msg.role === 'system') {
        // System messages need special handling in Gemini
        return {
          role: 'user',
          parts: [{ text: `System: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}` }],
        };
      }

      const role = msg.role === 'assistant' ? 'model' : msg.role;
      
      if (typeof msg.content === 'string') {
        const parts: Part[] = [{ text: msg.content }];
        
        // Add tool calls if present
        if (msg.toolCalls) {
          msg.toolCalls.forEach(toolCall => {
            parts.push({
              functionCall: {
                name: toolCall.name,
                args: toolCall.arguments,
              },
            });
          });
        }

        return { role, parts };
      } else {
        // Content is already Part[]
        return { role, parts: msg.content };
      }
    });
  }

  /**
   * Convert ChatRequest to Gemini GenerateContentParameters
   */
  private convertToGeminiRequest(request: ChatRequest): GenerateContentParameters {
    const contents = this.convertMessagesToContents(request.messages);
    
    const result: any = {
      contents,
      generationConfig: {
        temperature: request.temperature,
        topP: request.topP,
        maxOutputTokens: request.maxTokens,
      },
    };
    
    // Only add tools if they exist
    if (request.tools && request.tools.length > 0) {
      result.tools = request.tools;
    }
    
    return result as GenerateContentParameters;
  }

  /**
   * Convert Gemini response to unified LlmResponse format
   */
  private convertGeminiResponse(response: GenerateContentResponse): LlmResponse {
    const result: LlmResponse = {};

    if (response.candidates?.[0]?.content?.parts) {
      const parts = response.candidates[0].content.parts;
      let text = '';
      const toolCalls: LlmToolCall[] = [];

      for (const part of parts) {
        if (part.text) {
          text += part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: part.functionCall.name || 'unknown',
            arguments: part.functionCall.args || {},
          });
        }
      }

      if (text) result.text = text;
      if (toolCalls.length > 0) result.toolCalls = toolCalls;
    }

    // Add usage information if available
    if (response.usageMetadata) {
      result.usage = {
        promptTokens: response.usageMetadata.promptTokenCount,
        completionTokens: response.usageMetadata.candidatesTokenCount,
        totalTokens: response.usageMetadata.totalTokenCount,
      };
    }

    return result;
  }
}