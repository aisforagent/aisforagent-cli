#!/usr/bin/env node

// Set environment variables
process.env['AIFA_DEFAULT_API'] = 'openai-compatible';
process.env['OPENAI_COMPATIBLE_BASE_URL'] = 'http://localhost:1234/v1';
process.env['AIFA_SKIP_AUTH'] = 'true';

// Just test the raw provider
import { OpenAICompatibleProvider } from './packages/core/dist/llm/OpenAICompatibleProvider.js';

async function testToolCalling() {
  console.log('🔧 Testing OpenAI tool calling directly...');
  
  try {
    // Create provider
    const provider = new OpenAICompatibleProvider({
      apiKey: 'lm-studio',
      baseUrl: 'http://localhost:1234/v1',
      model: 'openai/gpt-oss-120b'
    });
    
    // Test basic chat without tools first
    console.log('🚀 Testing basic chat...');
    const basicResponse = await provider.chat({
      messages: [{ role: 'user', content: 'Hello! Just say hi back.' }]
    });
    
    console.log('✅ Basic response:', basicResponse);
    
    // Now test with a simple tool
    const simpleTools = [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather information',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' }
          },
          required: ['location']
        }
      }
    }];
    
    console.log('🛠️ Testing with tools...');
    const toolResponse = await provider.chat({
      messages: [{ 
        role: 'user', 
        content: 'Get the weather for London. Use the get_weather function.' 
      }],
      tools: simpleTools,
      systemInstruction: 'You are a helpful assistant. When asked about weather, use the get_weather function.'
    });
    
    console.log('✅ Tool response:', JSON.stringify(toolResponse, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testToolCalling();