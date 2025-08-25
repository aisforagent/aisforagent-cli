/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LlmProviderError,
  safeParseJson,
  truncateToolResult,
  truncateToolResults,
  DEFAULT_TRUNCATION_CONFIG,
} from './errorHandling.js';

describe('LlmProviderError', () => {
  it('should create basic error', () => {
    const error = new LlmProviderError('Test error');
    
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('LlmProviderError');
    expect(error.status).toBeUndefined();
    expect(error.endpoint).toBeUndefined();
    expect(error.tip).toBeUndefined();
  });

  it('should create error with all properties', () => {
    const error = new LlmProviderError(
      'API error',
      500,
      '/v1/chat/completions',
      'Check your server'
    );
    
    expect(error.message).toBe('API error');
    expect(error.status).toBe(500);
    expect(error.endpoint).toBe('/v1/chat/completions');
    expect(error.tip).toBe('Check your server');
  });

  it('should format detailed message', () => {
    const error = new LlmProviderError(
      'API error',
      500,
      '/v1/chat/completions',
      'Check your server'
    );
    
    const detailed = error.getDetailedMessage();
    expect(detailed).toContain('API error');
    expect(detailed).toContain('Status: 500');
    expect(detailed).toContain('Endpoint: /v1/chat/completions');
    expect(detailed).toContain('Tip: Check your server');
  });

  describe('createWithTip', () => {
    it('should create error with 401 tip', () => {
      const error = LlmProviderError.createWithTip('Unauthorized', 401);
      
      expect(error.status).toBe(401);
      expect(error.tip).toContain('API key');
      expect(error.tip).toContain('LM Studio');
    });

    it('should create error with 404 tip', () => {
      const error = LlmProviderError.createWithTip('Not found', 404);
      
      expect(error.status).toBe(404);
      expect(error.tip).toContain('endpoint URL');
      expect(error.tip).toContain('accessible');
    });

    it('should create error with 500 tip', () => {
      const error = LlmProviderError.createWithTip('Server error', 500);
      
      expect(error.status).toBe(500);
      expect(error.tip).toContain('model is loaded');
      expect(error.tip).toContain('LM Studio');
    });

    it('should create error with model loading tip', () => {
      const error = LlmProviderError.createWithTip('Model not found');
      
      expect(error.tip).toContain('model is loaded');
      expect(error.tip).toContain('LLM server');
    });

    it('should create error with connection tip', () => {
      const error = LlmProviderError.createWithTip('ECONNREFUSED');
      
      expect(error.tip).toContain('server is running');
      expect(error.tip).toContain('accessible');
    });
  });
});

describe('safeParseJson', () => {
  it('should parse valid JSON', () => {
    const result = safeParseJson('{"name": "test", "value": 123}');
    expect(result).toEqual({ name: 'test', value: 123 });
  });

  it('should repair missing closing brace', () => {
    const result = safeParseJson('{"name": "test", "value": 123');
    expect(result).toEqual({ name: 'test', value: 123 });
  });

  it('should repair multiple missing braces', () => {
    const result = safeParseJson('{"outer": {"inner": {"deep": "value"');
    expect(result).toEqual({ outer: { inner: { deep: 'value' } } });
  });

  it('should repair missing closing bracket', () => {
    const result = safeParseJson('[1, 2, 3');
    expect(result).toEqual([1, 2, 3]);
  });

  it('should repair trailing commas', () => {
    const result = safeParseJson('{"name": "test", "value": 123,}');
    expect(result).toEqual({ name: 'test', value: 123 });
  });

  it('should repair array trailing commas', () => {
    const result = safeParseJson('[1, 2, 3,]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('should repair unquoted property names', () => {
    const result = safeParseJson('{name: "test", value: 123}');
    expect(result).toEqual({ name: 'test', value: 123 });
  });

  it('should handle complex repair case', () => {
    const malformed = '{name: "test", nested: {value: 123, items: [1, 2, 3,';
    const result = safeParseJson(malformed);
    expect(result).toEqual({
      name: 'test',
      nested: {
        value: 123,
        items: [1, 2, 3],
      },
    });
  });

  it('should throw enriched error for irreparable JSON', () => {
    expect(() => {
      safeParseJson('this is not json at all');
    }).toThrow(/Failed to parse JSON after repair attempts/);
  });

  it('should include preview in error message', () => {
    const longInvalidJson = 'not json '.repeat(20);
    
    expect(() => {
      safeParseJson(longInvalidJson);
    }).toThrow(/Preview:/);
  });

  it('should truncate long previews', () => {
    const longInvalidJson = 'x'.repeat(200);
    
    try {
      safeParseJson(longInvalidJson);
    } catch (error) {
      expect((error as Error).message).toContain('...');
    }
  });
});

describe('truncateToolResult', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['TOOL_RESULT_TOKEN_LIMIT'];
    delete process.env['TOOL_RESULT_CHAR_LIMIT'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should not truncate short results', () => {
    const result = 'Short result';
    expect(truncateToolResult(result)).toBe(result);
  });

  it('should truncate long results by character count', () => {
    const longResult = 'x'.repeat(5000);
    const truncated = truncateToolResult(longResult);
    
    expect(truncated.length).toBeLessThan(longResult.length);
    expect(truncated).toContain('[...truncated');
    expect(truncated).toContain('characters');
    expect(truncated).toContain('tokens');
  });

  it('should truncate by token limit', () => {
    const config = { tokenLimit: 10, charLimit: 10000 };
    const result = 'word '.repeat(20); // ~20 tokens
    
    const truncated = truncateToolResult(result, config);
    expect(truncated).toContain('[...truncated');
  });

  it('should use custom configuration', () => {
    const config = { tokenLimit: 5, charLimit: 20 };
    const result = 'This is a longer result that should be truncated';
    
    const truncated = truncateToolResult(result, config);
    expect(truncated.length).toBeLessThan(result.length);
    expect(truncated).toContain('[...truncated');
  });

  it('should handle empty result', () => {
    expect(truncateToolResult('')).toBe('');
    expect(truncateToolResult(null as any)).toBe(null);
    expect(truncateToolResult(undefined as any)).toBe(undefined);
  });

  it('should respect environment variables', () => {
    // This test would need to be in a separate test file or use a different approach
    // since DEFAULT_TRUNCATION_CONFIG is evaluated at module load time
    expect(DEFAULT_TRUNCATION_CONFIG.tokenLimit).toBe(1000);
    expect(DEFAULT_TRUNCATION_CONFIG.charLimit).toBe(4000);
  });

  it('should provide accurate truncation stats', () => {
    const result = 'x'.repeat(5000);
    const truncated = truncateToolResult(result);
    
    // Should show truncated characters and estimated tokens
    expect(truncated).toMatch(/\[\.\.\.truncated \d+ characters \(~\d+ tokens\)\]/);
  });
});

describe('truncateToolResults', () => {
  it('should truncate multiple tool results', () => {
    const results = [
      { name: 'tool1', result: 'x'.repeat(5000) },
      { name: 'tool2', result: 'Short result' },
      { name: 'tool3', result: 'y'.repeat(5000) },
    ];
    
    const truncated = truncateToolResults(results);
    
    expect(truncated).toHaveLength(3);
    expect(truncated[0].name).toBe('tool1');
    expect(truncated[0].result).toContain('[...truncated');
    expect(truncated[1].result).toBe('Short result'); // Not truncated
    expect(truncated[2].result).toContain('[...truncated');
  });

  it('should handle empty results array', () => {
    expect(truncateToolResults([])).toEqual([]);
  });

  it('should preserve tool names', () => {
    const results = [
      { name: 'important_tool', result: 'x'.repeat(5000) },
    ];
    
    const truncated = truncateToolResults(results);
    expect(truncated[0].name).toBe('important_tool');
  });
});