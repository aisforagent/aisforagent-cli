#!/usr/bin/env node

/**
 * Test script to verify multimodal content mapping
 * Tests conversion of Gemini Part[] format to OpenAI multimodal format
 */

import { createLlmProvider } from './packages/core/dist/src/llm/providerFactory.js';

async function testMultimodal() {
  console.log('🖼️  Testing AIFA multimodal content mapping...\n');

  try {
    const provider = await createLlmProvider();
    console.log(`✅ Provider created: ${provider.getProviderName()}`);

    // Create a test message with multimodal content (simulating image data)
    const testImageParts = [
      { text: "What do you see in this image?" },
      {
        inlineData: {
          mimeType: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" // 1x1 red pixel
        }
      }
    ];

    const models = await provider.listModels();
    if (models.length > 0) {
      console.log(`🧠 Testing multimodal chat with model: ${models[0].id}`);
      
      const response = await provider.chat({
        messages: [{ 
          role: 'user', 
          content: testImageParts // Using Part[] format
        }],
        model: models[0].id,
        maxTokens: 100
      });

      console.log(`✅ Multimodal response: "${response.text?.substring(0, 100)}..."`);
      console.log('✅ Successfully processed multimodal content!');
      
      // Also test with simple text for comparison
      const textResponse = await provider.chat({
        messages: [{ 
          role: 'user', 
          content: 'Say hello in exactly 3 words.' // Simple string format
        }],
        model: models[0].id,
        maxTokens: 20
      });
      
      console.log(`✅ Text-only response: "${textResponse.text}"`);
      
    } else {
      console.log('❌ No models available for testing');
    }
  } catch (error) {
    console.log(`❌ Multimodal test failed: ${error.message}`);
    console.log('\nNote: This test requires a vision-capable model in LM Studio');
    console.log('Many local models don\'t support vision, which is expected');
  }
}

testMultimodal().catch(console.error);