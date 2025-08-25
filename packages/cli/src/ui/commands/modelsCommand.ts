/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createLlmProvider,
  validateProviderEnvironment,
  getProviderConfigurationHelp,
} from '@google/gemini-cli-core';
import { CommandKind, SlashCommand, MessageActionReturn } from './types.js';
import { MessageType, type HistoryItemInfo } from '../types.js';

export const modelsCommand: SlashCommand = {
  name: 'models',
  description: 'list available models or configure model settings',
  kind: CommandKind.BUILT_IN,
  action: async (context, args): Promise<void | MessageActionReturn> => {
    const trimmedArgs = args.trim();
    
    // Handle subcommands
    if (trimmedArgs.startsWith('set ')) {
      return handleSetModel(context, trimmedArgs.slice(4).trim());
    }
    
    if (trimmedArgs === 'help') {
      return handleModelsHelp(context);
    }

    // Default: list available models
    return handleListModels(context);
  },
  subCommands: [
    {
      name: 'list',
      description: 'list available models',
      kind: CommandKind.BUILT_IN,
      action: async (context) => handleListModels(context),
    },
    {
      name: 'set',
      description: 'set the current model',
      kind: CommandKind.BUILT_IN,
      action: async (context, args) => handleSetModel(context, args.trim()),
    },
    {
      name: 'help',
      description: 'show configuration help',
      kind: CommandKind.BUILT_IN,
      action: async (context) => handleModelsHelp(context),
    },
  ],
};

async function handleListModels(context: any): Promise<void | MessageActionReturn> {
  try {
    // First validate the environment
    const errors = validateProviderEnvironment();
    if (errors.length > 0) {
      const errorMessage = [
        'Configuration issues detected:',
        ...errors.map(err => `• ${err}`),
        '',
        'Run `/models help` for configuration guidance.',
      ].join('\n');

      const infoItem: Omit<HistoryItemInfo, 'id'> = {
        type: MessageType.INFO,
        text: errorMessage,
      };
      context.ui.addItem(infoItem, Date.now());
      return;
    }

    // Create provider and list models
    const provider = await createLlmProvider();
    const models = await provider.listModels();
    
    const currentModel = process.env['OPENAI_MODEL'] || 'not set';
    const providerName = provider.getProviderName();
    
    const modelList = models
      .map(model => {
        const marker = model.id === currentModel ? ' (current)' : '';
        const description = model.description ? ` - ${model.description}` : '';
        return `• ${model.id}${marker}${description}`;
      })
      .join('\n');

    const content = [
      `**Provider**: ${providerName}`,
      `**Current Model**: ${currentModel}`,
      '',
      '**Available Models**:',
      modelList,
      '',
      'Use `/models set <model-id>` to change the current model.',
      'Use `/models help` for configuration guidance.',
    ].join('\n');

    const infoItem: Omit<HistoryItemInfo, 'id'> = {
      type: MessageType.INFO,
      text: content,
    };
    context.ui.addItem(infoItem, Date.now());
    
  } catch (error) {
    const errorMessage = `Failed to list models: ${error instanceof Error ? error.message : 'Unknown error'}`;
    
    const infoItem: Omit<HistoryItemInfo, 'id'> = {
      type: MessageType.INFO,
      text: errorMessage + '\n\nRun `/models help` for configuration guidance.',
    };
    context.ui.addItem(infoItem, Date.now());
  }
}

async function handleSetModel(context: any, modelId: string): Promise<void | MessageActionReturn> {
  if (!modelId) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Model ID is required. Usage: /models set <model-id>',
    };
  }

  try {
    // For now, we'll just show how to set the environment variable
    // In a full implementation, this could persist to settings
    const content = [
      `To set the model to **${modelId}**:`,
      '',
      '**For current session**:',
      `\`export OPENAI_MODEL=${modelId}\``,
      '',
      '**Permanent (add to ~/.bashrc or ~/.zshrc)**:',
      `\`echo "export OPENAI_MODEL=${modelId}" >> ~/.bashrc\``,
      '',
      'Then restart the CLI or run `/models` to verify the change.',
    ].join('\n');

    const infoItem: Omit<HistoryItemInfo, 'id'> = {
      type: MessageType.INFO,
      text: content,
    };
    context.ui.addItem(infoItem, Date.now());
    
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to set model: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function handleModelsHelp(context: any): Promise<void> {
  const helpContent = getProviderConfigurationHelp();
  
  const content = [
    '# Model Configuration Help',
    '',
    helpContent,
    '',
    '**Commands**:',
    '• `/models` or `/models list` - List available models',
    '• `/models set <model-id>` - Get instructions to set a model',
    '• `/models help` - Show this help',
  ].join('\n');

  const infoItem: Omit<HistoryItemInfo, 'id'> = {
    type: MessageType.INFO,
    text: content,
  };
  context.ui.addItem(infoItem, Date.now());
}