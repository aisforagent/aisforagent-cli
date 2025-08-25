/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { modelsCommand } from './modelsCommand.js';
import { CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

// Mock the core functions
vi.mock('@google/gemini-cli-core', () => ({
  createLlmProvider: vi.fn(),
  validateProviderEnvironment: vi.fn(),
  getProviderConfigurationHelp: vi.fn(),
}));

import {
  createLlmProvider,
  validateProviderEnvironment,
  getProviderConfigurationHelp,
} from '@google/gemini-cli-core';

const mockCreateLlmProvider = createLlmProvider as any;
const mockValidateProviderEnvironment = validateProviderEnvironment as any;
const mockGetProviderConfigurationHelp = getProviderConfigurationHelp as any;

describe('modelsCommand', () => {
  let context: CommandContext;
  const originalEnv = process.env;

  beforeEach(() => {
    context = createMockCommandContext();
    process.env = { ...originalEnv };
    
    // Reset mocks
    mockCreateLlmProvider.mockReset();
    mockValidateProviderEnvironment.mockReset();
    mockGetProviderConfigurationHelp.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('main command', () => {
    it('should have correct name and description', () => {
      expect(modelsCommand.name).toBe('models');
      expect(modelsCommand.description).toContain('list available models');
      expect(modelsCommand.subCommands).toHaveLength(3);
    });

    it('should list models by default', async () => {
      const mockProvider = {
        getProviderName: () => 'openai-compatible',
        listModels: () => Promise.resolve([
          { id: 'model-1', name: 'Model 1', description: 'First model' },
          { id: 'model-2', name: 'Model 2', description: 'Second model' },
        ]),
      };

      process.env['OPENAI_MODEL'] = 'model-1';
      mockValidateProviderEnvironment.mockReturnValue([]);
      mockCreateLlmProvider.mockResolvedValue(mockProvider);

      await modelsCommand.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: expect.stringContaining('openai-compatible'),
        }),
        expect.any(Number)
      );

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('model-1 (current)'),
        }),
        expect.any(Number)
      );
    });

    it('should show configuration errors when environment is invalid', async () => {
      mockValidateProviderEnvironment.mockReturnValue([
        'OPENAI_API_KEY is required',
        'OPENAI_MODEL is required',
      ]);

      await modelsCommand.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: expect.stringContaining('OPENAI_API_KEY is required'),
        }),
        expect.any(Number)
      );

      expect(mockCreateLlmProvider).not.toHaveBeenCalled();
    });

    it('should handle provider errors gracefully', async () => {
      mockValidateProviderEnvironment.mockReturnValue([]);
      mockCreateLlmProvider.mockRejectedValue(new Error('Provider failed'));

      await modelsCommand.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: expect.stringContaining('Failed to list models: Provider failed'),
        }),
        expect.any(Number)
      );
    });

    it('should handle set model command', async () => {
      await modelsCommand.action!(context, 'set test-model');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: expect.stringContaining('test-model'),
        }),
        expect.any(Number)
      );
    });

    it('should handle help command', async () => {
      mockGetProviderConfigurationHelp.mockReturnValue('Mock configuration help');

      await modelsCommand.action!(context, 'help');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          title: 'Model Configuration',
          content: expect.stringContaining('Mock configuration help'),
        }),
        expect.any(Number)
      );
    });
  });

  describe('list subcommand', () => {
    it('should list models', async () => {
      const mockProvider = {
        getProviderName: () => 'test-provider',
        listModels: () => Promise.resolve([
          { id: 'test-model', name: 'Test Model' },
        ]),
      };

      mockValidateProviderEnvironment.mockReturnValue([]);
      mockCreateLlmProvider.mockResolvedValue(mockProvider);

      const listCommand = modelsCommand.subCommands!.find(cmd => cmd.name === 'list');
      await listCommand!.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: expect.stringContaining('test-provider'),
        }),
        expect.any(Number)
      );
    });
  });

  describe('set subcommand', () => {
    it('should provide instructions for setting model', async () => {
      const setCommand = modelsCommand.subCommands!.find(cmd => cmd.name === 'set');
      await setCommand!.action!(context, 'new-model');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: expect.stringContaining('export OPENAI_MODEL=new-model'),
        }),
        expect.any(Number)
      );
    });

    it('should return error for empty model ID', async () => {
      const setCommand = modelsCommand.subCommands!.find(cmd => cmd.name === 'set');
      const result = await setCommand!.action!(context, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Model ID is required'),
      });
    });
  });

  describe('help subcommand', () => {
    it('should show configuration help', async () => {
      mockGetProviderConfigurationHelp.mockReturnValue('Detailed help content');

      const helpCommand = modelsCommand.subCommands!.find(cmd => cmd.name === 'help');
      await helpCommand!.action!(context, '');

      expect(mockGetProviderConfigurationHelp).toHaveBeenCalled();
      expect(context.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: expect.stringContaining('Detailed help content'),
        }),
        expect.any(Number)
      );
    });
  });
});