/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  executeToolCall,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  parseAndFormatApiError,
} from '@google/gemini-cli-core';
import { Content, Part } from '@google/genai';

import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
): Promise<void> {
  console.log('📞📞📞 runNonInteractive called! 📞📞📞');
  console.debug('[Debug] runNonInteractive called with input:', input?.substring(0, 50));
  const consolePatcher = new ConsolePatcher({
    stderr: true,
    debugMode: config.getDebugMode(),
  });

  try {
    consolePatcher.patch();
    // Handle EPIPE errors when the output is piped to a command that closes early.
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Exit gracefully if the pipe is closed.
        process.exit(0);
      }
    });

    // Initialize the config to create the GeminiClient
    console.debug('[Debug] Initializing config...');
    try {
      await config.initialize();
      console.debug('[Debug] Config initialized, getting GeminiClient...');
    } catch (error) {
      if ((error as Error).message === 'Config was already initialized') {
        console.debug('[Debug] Config was already initialized, continuing...');
      } else {
        throw error; // Re-throw unexpected errors
      }
    }
    const geminiClient = config.getGeminiClient();
    console.debug('[Debug] GeminiClient obtained:', !!geminiClient);
    console.debug('[Debug] About to call handleAtCommand...');

    const abortController = new AbortController();

    const { processedQuery, shouldProceed } = await handleAtCommand({
      query: input,
      config,
      addItem: (_item, _timestamp) => 0,
      onDebugMessage: () => {},
      messageId: Date.now(),
      signal: abortController.signal,
    });

    console.debug('[Debug] handleAtCommand completed. shouldProceed:', shouldProceed, 'processedQuery length:', Array.isArray(processedQuery) ? processedQuery.length : (processedQuery ? 1 : 0));
    
    if (!shouldProceed || !processedQuery) {
      // An error occurred during @include processing (e.g., file not found).
      // The error message is already logged by handleAtCommand.
      console.error('Exiting due to an error processing the @ command.');
      process.exit(1);
    }

    let currentMessages: Content[] = [
      { role: 'user', parts: processedQuery as Part[] },
    ];

    let turnCount = 0;
    while (true) {
      turnCount++;
      if (
        config.getMaxSessionTurns() >= 0 &&
        turnCount > config.getMaxSessionTurns()
      ) {
        console.error(
          '\n Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
        );
        return;
      }
      const toolCallRequests: ToolCallRequestInfo[] = [];

      console.debug('[Debug] About to call geminiClient.sendMessageStream...');
      console.debug('[Debug] Current messages:', currentMessages.length);
      console.debug('[Debug] Parts count:', currentMessages[0]?.parts?.length || 0);
      
      const responseStream = geminiClient.sendMessageStream(
        currentMessages[0]?.parts || [],
        abortController.signal,
        prompt_id,
      );
      
      console.debug('[Debug] geminiClient.sendMessageStream completed, processing stream...');

      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        if (event.type === GeminiEventType.Content) {
          process.stdout.write(event.value);
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          toolCallRequests.push(event.value);
        }
      }

      if (toolCallRequests.length > 0) {
        const toolResponseParts: Part[] = [];
        for (const requestInfo of toolCallRequests) {
          const toolResponse = await executeToolCall(
            config,
            requestInfo,
            abortController.signal,
          );

          if (toolResponse.error) {
            console.error(
              `Error executing tool ${requestInfo.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
            );
          }

          if (toolResponse.responseParts) {
            toolResponseParts.push(...toolResponse.responseParts);
          }
        }
        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        process.stdout.write('\n'); // Ensure a final newline
        return;
      }
    }
  } catch (error) {
    console.error(
      parseAndFormatApiError(
        error,
        config.getContentGeneratorConfig()?.authType,
      ),
    );
    process.exit(1);
  } finally {
    consolePatcher.cleanup();
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(config);
    }
  }
}
