/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  FinishReason,
} from '@google/genai';
import { ContentGenerator } from './contentGenerator.js';
import { LlmProvider, LlmMessage, LlmResponse } from '../llm/LlmProvider.js';
import { Config } from '../config/config.js';
import { Tool } from '@google/genai';

/**
 * Adapter that bridges LlmProvider interface with ContentGenerator interface
 * This allows our new LLM provider system to work with the existing CLI infrastructure
 */
export class LlmProviderContentGeneratorAdapter implements ContentGenerator {
  constructor(
    private llmProvider: LlmProvider,
    private config: Config
  ) {
    console.log('🔧🔧🔧 LlmProviderAdapter constructor called! 🔧🔧🔧');
    console.log('Provider type:', llmProvider.getProviderName());
  }

  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    // Convert Gemini format to LLM provider format
    const messages = this.convertToLlmMessages(request.contents);
    const model = request.model || this.config.getModel();
    
    console.log('[LlmProviderAdapter] generateContent called with tools:', request.config?.tools?.length || 0);
    console.log('[LlmProviderAdapter] SystemInstruction length:', 
      this.convertSystemInstruction(request.config?.systemInstruction)?.length || 0);
    
    const convertedTools = this.convertTools(request.config?.tools);
    if (convertedTools && convertedTools.length > 0) {
      console.log('[LlmProviderAdapter] Tool names being passed:', 
        convertedTools.map(t => t.functionDeclarations?.[0]?.name).filter(Boolean));
      console.log('[LlmProviderAdapter] First converted tool:', JSON.stringify(convertedTools[0], null, 2));
    }
    
    const response = await this.llmProvider.chat({
      messages,
      model,
      systemInstruction: this.convertSystemInstruction(request.config?.systemInstruction),
      maxTokens: request.config?.maxOutputTokens,
      temperature: request.config?.temperature,
      topP: request.config?.topP,
      tools: this.convertTools(request.config?.tools),
    });

    return this.convertToGeminiResponse(response);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    console.log('🌊🌊🌊 LlmProviderAdapter.generateContentStream called! 🌊🌊🌊');
    console.log('[LlmProviderAdapter] STREAMING - Tools count:', request.config?.tools?.length || 0);
    
    const self = this;
    
    // For now, let's use the non-streaming version and convert it to a generator
    // This will fix the immediate streaming issue while we can refine streaming later
    return (async function* () {
      const response = await self.generateContent(request, userPromptId);
      yield response;
    })();
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    const messages = this.convertToLlmMessages(request.contents);
    const tokenCount = await this.llmProvider.countTokens(messages);
    
    return {
      totalTokens: tokenCount
    };
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    throw new Error('Embedding is not currently supported by OpenAI-compatible providers');
  }

  private convertToLlmMessages(contents: any): LlmMessage[] {
    // Handle both array and single content formats
    const contentArray = Array.isArray(contents) ? contents : [contents];
    
    // If it's a string, wrap it in a user message
    if (typeof contents === 'string') {
      return [{ role: 'user', content: contents }];
    }
    return contentArray.map((content: any) => {
      const role = content.role === 'model' ? 'assistant' : content.role as 'user' | 'system';
      
      // Handle multimodal content
      if (Array.isArray(content.parts)) {
        // Check if this is multimodal (has both text and inline data)
        const textParts = content.parts.filter((part: any) => 'text' in part);
        const imageParts = content.parts.filter((part: any) => 'inlineData' in part);
        
        if (imageParts.length > 0) {
          // Convert to multimodal format
          const multimodalContent = content.parts.map((part: any) => {
            if ('text' in part) {
              return { text: part.text };
            } else if ('inlineData' in part && part.inlineData) {
              return {
                inlineData: {
                  mimeType: part.inlineData.mimeType,
                  data: part.inlineData.data
                }
              };
            }
            return part;
          });
          
          return { role, content: multimodalContent };
        } else if (textParts.length > 0) {
          // Text only
          const text = textParts.map((part: any) => part.text).join(' ');
          return { role, content: text };
        }
      }
      
      return { role, content: '' };
    });
  }

  private convertSystemInstruction(systemInstruction?: any): string | undefined {
    if (!systemInstruction) {
      return undefined;
    }
    
    // If it's already a string, return it
    if (typeof systemInstruction === 'string') {
      return systemInstruction;
    }
    
    // If it's a Content object, extract the text from parts
    if (systemInstruction.parts && Array.isArray(systemInstruction.parts)) {
      return systemInstruction.parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join(' ');
    }
    
    // If it has a text property directly
    if (systemInstruction.text) {
      return systemInstruction.text;
    }
    
    // Fallback to string representation
    return String(systemInstruction);
  }

  private convertTools(tools?: any): Tool[] | undefined {
    if (!tools) {
      return undefined;
    }
    
    // If it's already an array of Tools, return as-is
    if (Array.isArray(tools)) {
      return tools as Tool[];
    }
    
    // If it's a single Tool, wrap in array
    return [tools as Tool];
  }

  private convertToGeminiResponse(
    response: LlmResponse, 
    accumulatedText?: string,
    finishReason?: string
  ): GenerateContentResponse {
    const text = accumulatedText || response.text || '';
    
    // Create a new GenerateContentResponse instance
    const geminiResponse = new GenerateContentResponse();
    
    // Set the basic properties
    geminiResponse.candidates = [{
      content: {
        parts: [{ text }],
        role: 'model'
      },
      finishReason: FinishReason.STOP,
      index: 0
    }];
    
    if (response.usage) {
      geminiResponse.usageMetadata = {
        promptTokenCount: response.usage.promptTokens || 0,
        candidatesTokenCount: response.usage.completionTokens || 0,
        totalTokenCount: response.usage.totalTokens || 0,
      };
    }

    // Handle tool calls
    if (response.toolCalls && response.toolCalls.length > 0 && geminiResponse.candidates?.[0]?.content) {
      geminiResponse.candidates[0].content.parts = response.toolCalls.map((toolCall: any) => ({
        functionCall: {
          name: toolCall.name,
          args: toolCall.arguments
        }
      }));
    }

    return geminiResponse;
  }
}