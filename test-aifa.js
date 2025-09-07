#!/usr/bin/env node

/**
 * AIFA Connection Test Script
 * Tests your LLM provider configuration and basic functionality
 */

import { createLlmProvider, getProviderConfigurationHelp } from './packages/core/dist/src/llm/providerFactory.js';

async function main() {
  console.log('🤖 AIFA Connection Test\n');

  try {

    console.log('📋 Current Configuration:');
    console.log(`   AIFA_DEFAULT_API: ${process.env.AIFA_DEFAULT_API || 'not set (auto-detect)'}`);
    console.log(`   OPENAI_COMPATIBLE_BASE_URL: ${process.env.OPENAI_COMPATIBLE_BASE_URL || 'not set'}`);
    console.log(`   GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'configured' : 'not set'}`);
    console.log('');

    console.log('🔌 Creating LLM provider...');
    const provider = await createLlmProvider();
    console.log(`✅ Provider created successfully: ${provider.getProviderName()}`);
    console.log('');

    console.log('📖 Listing available models...');
    try {
      const models = await provider.listModels();
      console.log(`✅ Found ${models.length} models:`);
      models.slice(0, 5).forEach((model, i) => {
        console.log(`   ${i + 1}. ${model.name || model.id} ${model.contextLength ? `(${model.contextLength.toLocaleString()} tokens)` : ''}`);
      });
      if (models.length > 5) {
        console.log(`   ... and ${models.length - 5} more models`);
      }
      console.log('');

      if (models.length > 0) {
        console.log('💬 Testing chat completion...');
        const testModel = models[0];
        
        const response = await provider.chat({
          messages: [{ 
            role: 'user', 
            content: 'Say "Hello from AIFA!" and nothing else.' 
          }],
          model: testModel.id || testModel.name,
          maxTokens: 50
        });

        if (response.text) {
          console.log(`✅ Chat test successful!`);
          console.log(`   Model: ${testModel.name || testModel.id}`);
          console.log(`   Response: ${response.text.trim()}`);
          if (response.usage) {
            console.log(`   Tokens: ${response.usage.totalTokens || 'unknown'}`);
          }
        } else {
          console.log('⚠️  Chat test completed but no text response received');
        }

        console.log('');
        console.log('🎉 AIFA is working correctly with your LLM provider!');
        
      } else {
        console.log('⚠️  No models found. Check your provider configuration.');
      }

    } catch (modelError) {
      console.log(`❌ Model listing failed: ${modelError.message}`);
      console.log('');
      console.log('💡 Troubleshooting suggestions:');
      
      if (process.env.AIFA_DEFAULT_API === 'openai-compatible' || !process.env.AIFA_DEFAULT_API) {
        console.log('   • Ensure LM Studio is running at http://localhost:1234');
        console.log('   • Or ensure Ollama is running at http://localhost:11434');
        console.log('   • Check that a model is loaded in your local server');
        console.log('   • Try: curl http://localhost:1234/v1/models');
      } else if (process.env.AIFA_DEFAULT_API === 'google-gemini') {
        console.log('   • Check your GEMINI_API_KEY is valid');
        console.log('   • Try setting AIFA_SKIP_AUTH=true for testing');
      }
      
      console.log('');
      console.log('🔧 Configuration help:');
      console.log(getProviderConfigurationHelp());
    }

  } catch (error) {
    console.log(`❌ Connection test failed: ${error.message}`);
    console.log('');
    console.log('🔧 Setup Help:');
    
    console.log('');
    console.log('For LM Studio:');
    console.log('   export AIFA_DEFAULT_API=openai-compatible');
    console.log('   export OPENAI_COMPATIBLE_BASE_URL=http://localhost:1234/v1');
    console.log('   # Then start LM Studio and load a model');
    
    console.log('');
    console.log('For Ollama:');
    console.log('   export AIFA_DEFAULT_API=openai-compatible');
    console.log('   export OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1');
    console.log('   # Then: ollama serve & ollama pull llama3.2');
    
    console.log('');
    console.log('For Google Gemini:');
    console.log('   export AIFA_DEFAULT_API=google-gemini');
    console.log('   export GEMINI_API_KEY=your-api-key');
    
    console.log('');
    console.log('For auto-detection (zero config):');
    console.log('   # Just start LM Studio or Ollama - AIFA will find it!');

    process.exit(1);
  }
}

// Handle async main
main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});