'use strict';

const OpenAI = require('openai');
const logger = require('../utils/logger');

let openaiClient;

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

/**
 * Call OpenAI GPT-4o-mini with JSON mode.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} [options]
 * @param {number} [options.temperature=0.4]
 * @param {number} [options.maxTokens=2000]
 * @returns {Promise<object>} Parsed JSON response.
 */
async function callGPT(systemPrompt, userPrompt, options = {}) {
  const { temperature = 0.4, maxTokens = 2000 } = options;

  const client = getOpenAIClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  return JSON.parse(content);
}

module.exports = { callGPT, getOpenAIClient };
