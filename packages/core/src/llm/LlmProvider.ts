/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tool, Part } from '@google/genai';

/**
 * Unified message format for LLM providers
 */
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | Part[];
  toolCalls?: LlmToolCall[];
  toolCallId?: string;
}

/**
 * Tool call representation
 */
export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Streaming response handlers
 */
export interface StreamingHandlers {
  onDelta?: (delta: { text?: string }) => void;
  onDone?: (response: LlmResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * LLM response format
 */
export interface LlmResponse {
  text?: string;
  toolCalls?: LlmToolCall[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Chat request parameters
 */
export interface ChatRequest {
  messages: LlmMessage[];
  model?: string;
  tools?: Tool[];
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
}

/**
 * Abstract interface for LLM providers
 */
export abstract class LlmProvider {
  /**
   * Send a chat completion request
   */
  abstract chat(request: ChatRequest, handlers?: StreamingHandlers): Promise<LlmResponse>;

  /**
   * List available models
   */
  abstract listModels(): Promise<ModelInfo[]>;

  /**
   * Count tokens for the given messages
   */
  abstract countTokens(messages: LlmMessage[]): Promise<number>;

  /**
   * Get the provider name
   */
  abstract getProviderName(): string;
}

/**
 * Factory function type for creating LLM providers
 */
export type LlmProviderFactory = (config?: Record<string, unknown>) => Promise<LlmProvider>;

/**
 * Registry of provider factories
 */
export class LlmProviderRegistry {
  private static factories = new Map<string, LlmProviderFactory>();

  static register(name: string, factory: LlmProviderFactory): void {
    this.factories.set(name, factory);
  }

  static async create(name: string, config?: Record<string, unknown>): Promise<LlmProvider> {
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`Unknown LLM provider: ${name}`);
    }
    return factory(config);
  }

  static list(): string[] {
    return Array.from(this.factories.keys());
  }
}