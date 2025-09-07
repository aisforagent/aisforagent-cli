/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from 'ink';
import { Colors } from '../colors.js';
import { tokenLimit, Config } from '@google/gemini-cli-core';
import { useEffect, useState } from 'react';

export const ContextUsageDisplay = ({
  promptTokenCount,
  model,
  config,
}: {
  promptTokenCount: number;
  model: string;
  config?: Config;
}) => {
  const [dynamicContextLength, setDynamicContextLength] = useState<number | null>(null);
  
  useEffect(() => {
    const fetchContextLength = async () => {
      if (!config) return;
      
      try {
        const modelInfo = await config.getDynamicModelInfo();
        setDynamicContextLength(modelInfo.contextLength || null);
      } catch (error) {
        console.debug('Failed to fetch dynamic context length:', error);
        setDynamicContextLength(null);
      }
    };
    
    fetchContextLength();
  }, [config, model]);

  // Use dynamic context length if available, fallback to tokenLimit
  const contextLimit = dynamicContextLength || tokenLimit(model);
  const percentage = promptTokenCount / contextLimit;

  return (
    <Text color={Colors.Gray}>
      ({((1 - percentage) * 100).toFixed(0)}% context left)
    </Text>
  );
};
