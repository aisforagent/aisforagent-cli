#!/usr/bin/env node

/**
 * Direct test of OpenAI provider with tools to bypass CLI config issues
 */

import { createLlmProvider } from './packages/core/src/llm/providerFactory.js';

async function testOpenAIProviderWithTools() {
  console.log('🧪 Testing OpenAI provider with tools directly...');
  
  try {
    // Create the OpenAI provider
    const provider = await createLlmProvider();
    console.log('✅ Provider created:', provider.getProviderName());
    
    // Test basic model listing
    const models = await provider.listModels();
    console.log('✅ Models available:', models.length);
    if (models.length > 0) {
      console.log('First model:', models[0].name || models[0].id);
    }
    
    // Test chat with tools
    const tools = [
      {
        name: 'google_web_search',
        description: 'Search the web using Google',
        functionDeclarations: [{
          name: 'google_web_search',
          description: 'Search the web using Google',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query'
              }
            },
            required: ['query']
          }
        }]
      }
    ];
    
    console.log('🔧 Testing chat with tools...');
    console.log('Tools being passed:', tools.length);
    
    const response = await provider.chat({
      messages: [{ role: 'user', content: 'Search for restaurants in Perth' }],
      model: models[0]?.id || 'openai/gpt-oss-120b',
      tools: tools
    });
    
    console.log('✅ Chat response received');
    console.log('Response text:', response.text?.substring(0, 200) + '...');
    console.log('Tool calls:', response.toolCalls?.length || 0);
    
    if (response.toolCalls && response.toolCalls.length > 0) {
      console.log('🎉 SUCCESS: Tool calls detected!');
      response.toolCalls.forEach((call, index) => {
        console.log(`Tool call ${index + 1}:`, call.name, call.arguments);
      });
    } else {
      console.log('⚠️  No tool calls detected in response');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testOpenAIProviderWithTools();