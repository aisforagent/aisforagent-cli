/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration for tool result truncation
 */
export interface TruncationConfig {
  tokenLimit: number;
  charLimit: number;
}

/**
 * Default truncation limits
 */
export const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
  tokenLimit: parseInt(process.env['TOOL_RESULT_TOKEN_LIMIT'] || '1000'),
  charLimit: parseInt(process.env['TOOL_RESULT_CHAR_LIMIT'] || '4000'),
};

/**
 * Custom error class for LLM provider errors
 */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly endpoint?: string,
    public readonly tip?: string,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }

  /**
   * Create a user-friendly error message with tips
   */
  getDetailedMessage(): string {
    const parts = [this.message];
    
    if (this.status) {
      parts.push(`Status: ${this.status}`);
    }
    
    if (this.endpoint) {
      parts.push(`Endpoint: ${this.endpoint}`);
    }
    
    if (this.tip) {
      parts.push(`Tip: ${this.tip}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Create provider-specific error with helpful tips
   */
  static createWithTip(
    message: string,
    status?: number,
    endpoint?: string,
  ): LlmProviderError {
    let tip: string | undefined;
    
    if (status === 401) {
      tip = 'Check your API key. For LM Studio, ensure the server is running and any non-empty API key is set.';
    } else if (status === 404) {
      tip = 'Verify the API endpoint URL and ensure the server is accessible.';
    } else if (status === 500) {
      tip = 'Server error. For LM Studio, ensure a model is loaded and the server is running properly.';
    } else if (message.includes('model') && message.includes('not')) {
      tip = 'Ensure a model is loaded in your LLM server (e.g., LM Studio).';
    } else if (message.includes('connection') || message.includes('ECONNREFUSED')) {
      tip = 'Check that your LLM server is running and accessible at the configured endpoint.';
    }
    
    return new LlmProviderError(message, status, endpoint, tip);
  }
}

/**
 * Safe JSON parsing with repair attempts
 */
export function safeParseJson<T = unknown>(jsonString: string): T {
  // First try normal parsing
  try {
    return JSON.parse(jsonString) as T;
  } catch (initialError) {
    // Attempt light brace-balancing repair
    const repaired = attemptJsonRepair(jsonString);
    
    try {
      return JSON.parse(repaired) as T;
    } catch (repairError) {
      // Create enriched error message with preview
      const preview = jsonString.length > 100 
        ? jsonString.substring(0, 100) + '...'
        : jsonString;
      
      throw new Error(
        `Failed to parse JSON after repair attempts. ` +
        `Original error: ${initialError instanceof Error ? initialError.message : 'Unknown'}. ` +
        `Preview: "${preview}"`
      );
    }
  }
}

/**
 * Attempt to repair malformed JSON with simple heuristics
 */
function attemptJsonRepair(jsonString: string): string {
  let repaired = jsonString.trim();
  
  // Balance curly braces
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  
  if (openBraces > closeBraces) {
    repaired += '}'.repeat(openBraces - closeBraces);
  }
  
  // Balance square brackets
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  
  if (openBrackets > closeBrackets) {
    repaired += ']'.repeat(openBrackets - closeBrackets);
  }
  
  // Handle trailing commas in objects and arrays
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
  
  // Handle missing quotes around simple property names
  repaired = repaired.replace(/(\{|\s|,)(\w+):/g, '$1"$2":');
  
  return repaired;
}

/**
 * Truncate tool results to stay within limits
 */
export function truncateToolResult(
  result: string,
  config: TruncationConfig = DEFAULT_TRUNCATION_CONFIG,
): string {
  if (!result) return result;
  
  // Simple token estimation: ~4 characters per token
  const estimatedTokens = Math.ceil(result.length / 4);
  
  if (result.length <= config.charLimit && estimatedTokens <= config.tokenLimit) {
    return result;
  }
  
  // Calculate truncation point
  const maxChars = Math.min(config.charLimit, config.tokenLimit * 4);
  
  if (result.length <= maxChars) {
    return result;
  }
  
  // Truncate with annotation
  const truncated = result.substring(0, maxChars);
  const truncatedChars = result.length - maxChars;
  const truncatedTokens = Math.ceil(truncatedChars / 4);
  
  return `${truncated}\n\n[...truncated ${truncatedChars} characters (~${truncatedTokens} tokens)]`;
}

/**
 * Truncate tool results in a tool execution context
 */
export function truncateToolResults(results: { name: string; result: string }[]): { name: string; result: string }[] {
  return results.map(({ name, result }) => ({
    name,
    result: truncateToolResult(result),
  }));
}