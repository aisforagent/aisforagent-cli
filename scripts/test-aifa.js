#!/usr/bin/env node

/**
 * Simple test script to verify AIFA works with LM Studio
 * Usage: OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:1234 node test-aifa.js
 */

import { createLlmProvider } from './packages/core/dist/src/llm/providerFactory.js';

async function testAifa() {
  console.log('🤖 Testing AIFA with local LLM provider...\n');

  // Test provider creation
  try {
    const provider = await createLlmProvider();
    console.log(`✅ Provider created: ${provider.getProviderName()}`);

    // Test model listing
    try {
      const models = await provider.listModels();
      console.log(`✅ Found ${models.length} model(s):`);
      models.forEach(model => {
        console.log(`   - ${model.id} (${model.size || 'unknown size'})`);
      });

      // Test simple chat
      if (models.length > 0) {
        const testModel = models[0].id;
        console.log(`\n🧠 Testing chat with model: ${testModel}`);
        
        const response = await provider.chat({
          messages: [{ role: 'user', content: 'Say "Hello from AIFA!" in exactly 5 words.' }],
          model: testModel,
          maxTokens: 50
        });

        console.log(`✅ Chat response: "${response.text}"`);
        console.log(`📊 Token usage: ${response.usage?.totalTokens || 'unknown'} tokens`);
      }
    } catch (error) {
      console.log(`❌ Model operations failed: ${error.message}`);
    }
  } catch (error) {
    console.log(`❌ Provider creation failed: ${error.message}`);
    console.log('\nMake sure:');
    console.log('1. LM Studio is running at http://127.0.0.1:1234');
    console.log('2. OPENAI_COMPATIBLE_BASE_URL environment variable is set');
    console.log('3. A model is loaded in LM Studio');
  }
}

testAifa().catch(console.error);