#!/usr/bin/env node

// Simple test to check if LM Studio model supports function calling at all
import fetch from 'node-fetch';

const testFunctionCalling = async () => {
  console.log('🧪 Testing basic function calling with LM Studio...');
  
  const requestBody = {
    model: 'openai/gpt-oss-120b',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant. You have access to the get_weather function. Use it when asked about weather.'
      },
      {
        role: 'user',
        content: 'What is the weather like in London? Please use the get_weather function.'
      }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather information for a location',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'The city name'
              }
            },
            required: ['location']
          }
        }
      }
    ],
    tool_choice: 'auto',
    temperature: 0.1
  };
  
  try {
    console.log('📤 Sending request to LM Studio...');
    const response = await fetch('http://localhost:1234/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer lm-studio'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('📥 Response received:');
    console.log(JSON.stringify(data, null, 2));
    
    const message = data.choices?.[0]?.message;
    if (message?.tool_calls && message.tool_calls.length > 0) {
      console.log('✅ SUCCESS: Model made function calls!');
      console.log('🔧 Function calls:', message.tool_calls.map(call => ({
        name: call.function?.name,
        args: call.function?.arguments
      })));
    } else {
      console.log('❌ ISSUE: Model did not make function calls');
      console.log('💬 Model response:', message?.content);
    }
    
  } catch (error) {
    console.error('❌ Error testing function calling:', error);
  }
};

testFunctionCalling();