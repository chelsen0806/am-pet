'use strict';

const assert = require('assert');
const {
  getChatCompletionsUrl,
  normalizeBaseUrl,
  normalizeMessages,
  chatCompletion,
  testAiConnection
} = require('../src/ai-provider');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload || {}))
  };
}

async function expectError(fn, pattern) {
  let error = null;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  assert(error, 'Expected an error');
  assert.match(error.message, pattern);
}

async function main() {
  assert.strictEqual(normalizeBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
  assert.strictEqual(getChatCompletionsUrl('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
  assert.strictEqual(
    getChatCompletionsUrl('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1/chat/completions'
  );

  const messages = normalizeMessages([
    { role: 'system', content: ' system ' },
    { role: 'user', content: 'hello' },
    { role: 'tool', content: 'ignored' },
    { role: 'assistant', content: 'hi' }
  ]);
  assert.deepStrictEqual(messages, [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' }
  ]);

  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return response(200, {
      model: 'test-model',
      choices: [{ message: { content: '你好，我是小猫。' } }],
      usage: { total_tokens: 12 }
    });
  };

  const result = await chatCompletion({
    config: {
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      systemPrompt: '你是测试桌宠。',
      temperature: 0.2,
      maxTokens: 128,
      timeoutMs: 5000
    },
    apiKey: 'secret-key',
    messages: [{ role: 'user', content: '你好' }],
    fetchImpl
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.content, '你好，我是小猫。');
  assert.strictEqual(captured.url, 'https://api.example.com/v1/chat/completions');
  assert.strictEqual(captured.options.method, 'POST');
  assert.strictEqual(captured.options.headers.Authorization, 'Bearer secret-key');
  const requestBody = JSON.parse(captured.options.body);
  assert.strictEqual(requestBody.stream, false);
  assert.strictEqual(requestBody.messages[0].role, 'system');
  assert.strictEqual(requestBody.messages[0].content, '你是测试桌宠。');
  assert.strictEqual(requestBody.messages[1].content, '你好');

  let noKeyHeaders = null;
  await chatCompletion({
    config: { baseUrl: 'http://localhost:11434/v1', model: 'llama3', systemPrompt: '' },
    messages: [{ role: 'user', content: 'hello' }],
    fetchImpl: async (_url, options) => {
      noKeyHeaders = options.headers;
      return response(200, { choices: [{ message: { content: 'ok' } }] });
    }
  });
  assert.strictEqual(noKeyHeaders.Authorization, undefined);

  await expectError(() => chatCompletion({
    config: { baseUrl: 'https://api.example.com/v1', model: 'test-model' },
    apiKey: 'bad',
    messages: [{ role: 'user', content: 'hello' }],
    fetchImpl: async () => response(401, { error: { message: 'invalid key' } })
  }), /API Key 无效/);

  await expectError(() => chatCompletion({
    config: { baseUrl: 'https://api.example.com/v1', model: 'test-model' },
    messages: [{ role: 'user', content: 'hello' }],
    fetchImpl: async () => response(429, { error: { message: 'quota' } })
  }), /请求过于频繁|额度不足/);

  await expectError(() => chatCompletion({
    config: { baseUrl: 'https://api.example.com/v1', model: 'test-model' },
    messages: [{ role: 'user', content: 'hello' }],
    fetchImpl: async () => response(500, { error: { message: 'server' } })
  }), /AI 服务暂时不可用/);

  const tested = await testAiConnection({
    config: { baseUrl: 'https://api.example.com/v1', model: 'test-model' },
    fetchImpl: async () => response(200, { choices: [{ message: { content: 'OK' } }] })
  });
  assert.strictEqual(tested.ok, true);
  assert.strictEqual(tested.reply, 'OK');

  console.log('AI provider tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});