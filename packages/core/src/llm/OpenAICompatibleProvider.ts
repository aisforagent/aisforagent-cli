/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  LlmProvider,
  LlmMessage,
  LlmResponse,
  ChatRequest,
  StreamingHandlers,
  ModelInfo,
} from './LlmProvider.js';
import { Part } from '@google/genai';
import { LlmProviderError, safeParseJson } from './errorHandling.js';

/**
 * OpenAI content part for multimodal messages
 */
interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

/**
 * OpenAI API compatible message format
 */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/**
 * OpenAI API tool call format
 */
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * OpenAI API tool format
 */
interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * OpenAI API chat completion request
 */
interface ChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
}

/**
 * OpenAI API chat completion response
 */
interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: 'assistant';
      content?: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI API streaming response chunk
 */
interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
    };
    finish_reason?: string;
  }[];
}

/**
 * Models API response
 */
interface ModelsResponse {
  object: 'list';
  data: {
    id: string;
    object: 'model';
    created?: number;
    owned_by?: string;
  }[];
}

/**
 * Configuration for OpenAI-compatible provider
 */
export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  transport?: 'sdk' | 'fetch';
}

/**
 * Tool call accumulator for streaming
 */
interface ToolCallAccumulator {
  id?: string;
  name?: string;
  argsSrc: string;
}

/**
 * OpenAI-compatible provider that can talk to LM Studio and other OpenAI API servers
 */
export class OpenAICompatibleProvider extends LlmProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private transport: 'sdk' | 'fetch';

  constructor(config: OpenAICompatibleConfig) {
    super();
    console.log('🚀🚀🚀 OpenAICompatibleProvider constructor called! 🚀🚀🚀');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'http://localhost:1234/v1';
    this.model = config.model;
    this.transport = config.transport || 'sdk';

    if (!this.apiKey) {
      throw new LlmProviderError(
        'OpenAI API key is required',
        undefined,
        undefined,
        'Set OPENAI_API_KEY environment variable. For LM Studio, use any non-empty string like "lm-studio".'
      );
    }
  }

  async chat(request: ChatRequest, handlers?: StreamingHandlers): Promise<LlmResponse> {
    console.log('[OpenAI Debug] chat() called with tools:', request.tools?.length || 0);
    console.log('[OpenAI Debug] systemInstruction provided:', !!request.systemInstruction);
    if (request.tools && request.tools.length > 0) {
      console.log('[OpenAI Debug] Tool names:', request.tools.map(t => t.functionDeclarations?.[0]?.name || 'unknown'));
    }
    try {
      const openaiRequest = this.convertToOpenAIRequest(request);

      if (request.stream && handlers) {
        return await this.handleStreamingRequest(openaiRequest, handlers);
      } else {
        const response = await this.sendRequest<ChatCompletionResponse>(
          '/chat/completions',
          openaiRequest,
        );
        return this.convertOpenAIResponse(response);
      }
    } catch (error) {
      handlers?.onError?.(error as Error);
      throw error;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.sendRequest<ModelsResponse>('/models', {}, 'GET');
      return response.data.map(model => ({
        id: model.id,
        name: model.id,
        description: `Model: ${model.id}`,
      }));
    } catch (error) {
      if (error instanceof LlmProviderError) {
        throw error;
      }
      throw LlmProviderError.createWithTip(
        `Failed to list models: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        '/models'
      );
    }
  }

  async countTokens(messages: LlmMessage[]): Promise<number> {
    // Simple estimation: ~4 characters per token
    return messages.reduce((total, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return total + Math.ceil(content.length / 4);
    }, 0);
  }

  getProviderName(): string {
    return 'openai-compatible';
  }

  /**
   * Handle streaming request with tool call accumulation
   */
  private async handleStreamingRequest(
    request: ChatCompletionRequest,
    handlers: StreamingHandlers,
  ): Promise<LlmResponse> {
    request.stream = true;

    const textBuf: string[] = [];
    const toolCallAccumulators = new Map<number, ToolCallAccumulator>();
    let streamFinished = false;
    let finishReason: string | undefined;

    try {
      const stream = await this.sendStreamingRequest(request);

      for await (const chunk of stream) {
        if (!chunk.choices?.[0]) continue;

        const choice = chunk.choices[0];
        const delta = choice.delta;

        // Check for stream completion
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
          streamFinished = true;
          // Continue processing this chunk but mark stream as finished
        }

        // Handle text content
        if (delta?.content) {
          textBuf.push(delta.content);
          handlers.onDelta?.({ text: delta.content });
        }

        // Handle tool calls
        if (delta?.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index;
            if (!toolCallAccumulators.has(index)) {
              toolCallAccumulators.set(index, { argsSrc: '' });
            }

            const accumulator = toolCallAccumulators.get(index)!;

            if (toolCallDelta.id) {
              accumulator.id = toolCallDelta.id;
            }
            if (toolCallDelta.function?.name) {
              accumulator.name = toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              accumulator.argsSrc += toolCallDelta.function.arguments;
            }
          }
        }

        // Break if stream is finished and this chunk is processed
        if (streamFinished) {
          break;
        }
      }

      // Build final response
      const finalResponse: LlmResponse = {};

      if (textBuf.length > 0) {
        finalResponse.text = textBuf.join('');
      }

      if (toolCallAccumulators.size > 0) {
        finalResponse.toolCalls = Array.from(toolCallAccumulators.entries())
          .sort(([a], [b]) => a - b)
          .map(([, accumulator]) => {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = safeParseJson(accumulator.argsSrc || '{}');
            } catch (error) {
              console.warn('Failed to parse tool call arguments after repair attempts:', {
                source: accumulator.argsSrc,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
              parsedArgs = {}; // Fallback to empty args
            }

            const toolCall = {
              id: accumulator.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              name: accumulator.name || 'unknown',
              arguments: parsedArgs,
            };
            
            console.log('[OpenAI Debug] Streaming tool call result:', JSON.stringify({
              accumulator: accumulator,
              finalToolCall: toolCall
            }, null, 2));
            
            return toolCall;
          });
      }

      // Log completion status for debugging
      if (process.env['AIFA_DEBUG_STREAMING'] === 'true') {
        console.debug('[OpenAI-Compatible Provider] Stream completed:', {
          streamFinished,
          finishReason,
          textLength: textBuf.length,
          toolCallCount: toolCallAccumulators.size,
        });
      }

      handlers.onDone?.(finalResponse);
      return finalResponse;
    } catch (error) {
      if (process.env['AIFA_DEBUG_STREAMING'] === 'true') {
        console.debug('[OpenAI-Compatible Provider] Stream error:', error);
      }
      handlers.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Send streaming request and return async generator
   */
  private async sendStreamingRequest(request: ChatCompletionRequest): Promise<AsyncGenerator<ChatCompletionChunk>> {
    if (this.transport === 'fetch') {
      return this.sendStreamingRequestWithFetch(request);
    } else {
      // For now, we'll implement fetch-based streaming
      // In a full implementation, we would use the OpenAI SDK here
      return this.sendStreamingRequestWithFetch(request);
    }
  }

  /**
   * Send streaming request using fetch
   */
  private async *sendStreamingRequestWithFetch(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw LlmProviderError.createWithTip(
        response.statusText || `HTTP error ${response.status}`,
        response.status,
        `${this.baseUrl}/chat/completions`
      );
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          if (line.trim() === '' || !line.startsWith('data: ')) continue;
          
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            if (process.env['AIFA_DEBUG_STREAMING'] === 'true') {
              console.debug('[OpenAI-Compatible Provider] Received [DONE] signal, ending stream');
            }
            return;
          }

          try {
            const chunk: ChatCompletionChunk = safeParseJson(data);
            if (process.env['AIFA_DEBUG_STREAMING'] === 'true') {
              console.debug('[OpenAI-Compatible Provider] Processing chunk:', {
                hasChoice: !!chunk.choices?.[0],
                finishReason: chunk.choices?.[0]?.finish_reason,
                hasContent: !!chunk.choices?.[0]?.delta?.content,
                hasToolCalls: !!chunk.choices?.[0]?.delta?.tool_calls,
              });
            }
            yield chunk;
          } catch (error) {
            if (process.env['AIFA_DEBUG_STREAMING'] === 'true') {
              console.debug('[OpenAI-Compatible Provider] Failed to parse SSE chunk:', {
                data,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            } else {
              console.warn('Failed to parse SSE chunk after repair attempts:', {
                data,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }
        }
      }
      // Process any remaining data in buffer
      if (buffer.trim()) {
        const remainingLines = buffer.trim().split('\n');
        for (const line of remainingLines) {
          if (line.trim() === '' || !line.startsWith('data: ')) continue;
          
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            if (process.env['AIFA_DEBUG_STREAMING'] === 'true') {
              console.debug('[OpenAI-Compatible Provider] Received [DONE] signal in final buffer, ending stream');
            }
            return;
          }

          try {
            const chunk: ChatCompletionChunk = safeParseJson(data);
            if (process.env['AIFA_DEBUG_STREAMING'] === 'true') {
              console.debug('[OpenAI-Compatible Provider] Processing final chunk:', {
                hasChoice: !!chunk.choices?.[0],
                finishReason: chunk.choices?.[0]?.finish_reason,
              });
            }
            yield chunk;
          } catch (error) {
            if (process.env['AIFA_DEBUG_STREAMING'] === 'true') {
              console.debug('[OpenAI-Compatible Provider] Failed to parse final SSE chunk:', {
                data,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Send non-streaming request
   */
  private async sendRequest<T>(
    endpoint: string,
    body: Record<string, unknown> | ChatCompletionRequest,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw LlmProviderError.createWithTip(
        response.statusText || `HTTP error ${response.status}`,
        response.status,
        `${this.baseUrl}${endpoint}`
      );
    }

    return await response.json() as T;
  }

  /**
   * Convert content (string or Part[]) to OpenAI format
   */
  private convertContent(content: string | Part[]): string | OpenAIContentPart[] {
    if (typeof content === 'string') {
      return content;
    }

    // Convert Gemini Part[] to OpenAI multimodal format
    const openaiContent: OpenAIContentPart[] = [];
    
    for (const part of content) {
      if (part.text) {
        openaiContent.push({
          type: 'text',
          text: part.text
        });
      } else if (part.inlineData) {
        // Convert Gemini's inline data format to OpenAI's image format
        const mimeType = part.inlineData.mimeType;
        const base64Data = part.inlineData.data;
        
        if (mimeType && mimeType.startsWith('image/')) {
          openaiContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Data}`,
              detail: 'auto'
            }
          });
        } else {
          // For non-image content, convert to text representation
          openaiContent.push({
            type: 'text',
            text: `[File: ${mimeType || 'unknown type'}, ${base64Data?.length || 0} bytes]`
          });
        }
      } else if (part.fileData) {
        // Handle file data format
        openaiContent.push({
          type: 'text',
          text: `[File: ${part.fileData.mimeType || 'unknown type'}, ${part.fileData.fileUri}]`
        });
      }
    }

    return openaiContent.length > 0 ? openaiContent : [{ type: 'text', text: '[Empty content]' }];
  }

  /**
   * Convert unified request to OpenAI format
   */
  private convertToOpenAIRequest(request: ChatRequest): ChatCompletionRequest {
    const messages: OpenAIMessage[] = request.messages.map(msg => {
      const openaiMsg: OpenAIMessage = {
        role: msg.role === 'assistant' ? 'assistant' : msg.role,
        content: this.convertContent(msg.content),
      };

      if (msg.toolCalls) {
        openaiMsg.tool_calls = msg.toolCalls.map(call => ({
          id: call.id,
          type: 'function' as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        }));
      }

      if (msg.toolCallId) {
        openaiMsg.tool_call_id = msg.toolCallId;
      }

      return openaiMsg;
    });

    const result: ChatCompletionRequest = {
      model: this.model,
      messages,
      temperature: request.temperature,
      top_p: request.topP,
      max_tokens: request.maxTokens,
      stream: request.stream,
    };

    console.log('🟢 CRITICAL: Request tools check:', {
      hasTools: !!request.tools,
      toolsLength: request.tools?.length || 0,
      toolsType: typeof request.tools,
      toolsArray: Array.isArray(request.tools)
    });
    
    if (request.tools && request.tools.length > 0) {
      console.log('[OpenAI Debug] Processing tools:', JSON.stringify(request.tools, null, 2));
      result.tools = request.tools.map((tool, index) => {
        console.log(`[OpenAI Debug] Tool ${index}:`, JSON.stringify(tool, null, 2));
        console.log(`[OpenAI Debug] functionDeclarations exists:`, !!tool.functionDeclarations);
        console.log(`[OpenAI Debug] functionDeclarations length:`, tool.functionDeclarations?.length);
        if (tool.functionDeclarations?.[0]) {
          console.log(`[OpenAI Debug] First function:`, JSON.stringify(tool.functionDeclarations[0], null, 2));
        }
        
        const functionName = tool.functionDeclarations?.[0]?.name || 'unknown';
        console.log(`[OpenAI Debug] Final function name:`, functionName);
        
        return {
          type: 'function' as const,
          function: {
            name: functionName,
            description: tool.functionDeclarations?.[0]?.description,
            parameters: tool.functionDeclarations?.[0]?.parameters as Record<string, unknown>,
          },
        };
      });
      result.tool_choice = 'auto';
      console.log('🔧 SENDING TOOLS TO LM STUDIO:', result.tools?.length || 0);
    } else {
      console.log('❌ NO TOOLS IN REQUEST - LM Studio will receive no functions');
    }

    console.log('📤 Final request to LM Studio has tools:', !!result.tools);
    return result;
  }

  /**
   * Convert OpenAI response to unified format
   */
  private convertOpenAIResponse(response: ChatCompletionResponse): LlmResponse {
    const result: LlmResponse = {};

    if (response.choices?.[0]?.message) {
      const message = response.choices[0].message;

      if (message.content) {
        result.text = message.content;
      }

      if (message.tool_calls) {
        console.log('[OpenAI Debug] Raw tool_calls from LM Studio:', JSON.stringify(message.tool_calls, null, 2));
        result.toolCalls = message.tool_calls.map(call => {
          console.log('[OpenAI Debug] Processing tool call:', JSON.stringify(call, null, 2));
          return {
            id: call.id,
            name: call.function.name,
            arguments: safeParseJson(call.function.arguments || '{}'),
          };
        });
        console.log('[OpenAI Debug] Final converted tool calls:', JSON.stringify(result.toolCalls, null, 2));
      }
    }

    if (response.usage) {
      result.usage = {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      };
    }

    return result;
  }
}